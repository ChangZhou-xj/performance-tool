#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A8 工单批量查询脚本
通过 Playwright 自动化登录 A8 系统，依次查询每个工单的处理人信息

用法:
  python3 a8-batch-query.py '{"ticketNos":["KFXQ-CX-xxx"],"baseUrl":"http://...","loginUrl":"http://...","username":"xxx","password":"xxx"}'

抓包模式（只记录网络请求，不提取数据）:
  python3 a8-batch-query.py '{"mode":"capture","ticketNos":["KFXQ-CX-xxx"],"baseUrl":"http://...","loginUrl":"http://...","username":"xxx","password":"xxx"}'

输出:
  RESULT:{"ticketNo":"xxx","info":{"developer":"张三","currentHandler":"李四","currentNode":"开发处理"}}
  RESULT:{"ticketNo":"yyy","info":null}
"""

import sys
import json
import time

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)

TIMEOUT = 30000
NAV_TIMEOUT = 60000


def login_a8(page, login_url, username, password):
    """登录 A8 系统"""
    print(f"INFO: 正在登录 A8...")
    page.goto(login_url, timeout=NAV_TIMEOUT)
    page.wait_for_load_state("networkidle", timeout=TIMEOUT)

    username_input = page.locator('input[name="login_username"], input[id="login_username"], input[placeholder*="用户名"]').first
    password_input = page.locator('input[name="login_password"], input[id="login_password"], input[placeholder*="密码"], input[type="password"]').first

    username_input.fill(username)
    password_input.fill(password)

    login_btn = page.locator('button[id="login_button"], input[type="submit"], button:has-text("登录"), a:has-text("登录")').first
    login_btn.click()
    page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT)
    print("INFO: 登录完成")


def find_and_open_workorder(page, ticket_no):
    """在主页查找包含工单号的链接并双击打开"""
    link = page.locator(f'a:has-text("{ticket_no}")').first
    if not link.is_visible(timeout=5000):
        print(f"WARN: 工单 {ticket_no} 在页面中未找到", file=sys.stderr)
        return False

    link.dblclick()
    page.wait_for_timeout(3000)
    page.wait_for_load_state("networkidle", timeout=TIMEOUT)
    return True


def extract_workorder_info(page, ticket_no):
    """从已打开的工单中提取信息"""
    info = {}

    try:
        # 查找 collab_frame（审批流程）和 form_frame（表单）
        collab_frame = None
        form_frame = None

        for frame in page.frames:
            if "collab" in frame.url or "collaboration" in frame.url:
                collab_frame = frame
            if "form" in frame.url or "formData" in frame.url:
                form_frame = frame

        if not collab_frame:
            collab_frame = page.frame("collab_frame") or page.frame("collaborationFrame")
        if not form_frame:
            form_frame = page.frame("form_frame") or page.frame("formFrame")

        # 从 form_frame 提取开发人员
        if form_frame:
            try:
                dev_input = form_frame.locator(
                    'tr:has(td:has-text("开发人员")) input[type="text"], '
                    'tr:has(td:has-text("开发")) input[type="text"], '
                    'div:has(span:has-text("开发人员")) input'
                ).first
                if dev_input.is_visible(timeout=3000):
                    info["developer"] = dev_input.input_value() or ""
            except Exception:
                pass

        # 从 collab_frame 提取当前处理人和当前节点
        if collab_frame:
            try:
                flow_items = collab_frame.locator(
                    '.workflow-item, .approval-item, .process-item, '
                    'tr[class*="workflow"], tr[class*="flow"], '
                    'div[class*="node"], div[class*="handler"]'
                )
                count = flow_items.count()
                if count > 0:
                    last_item = flow_items.nth(count - 1)
                    handler_el = last_item.locator('.handler, .handlerName, td:nth-child(2), span[class*="name"]').first
                    if handler_el.is_visible(timeout=2000):
                        info["currentHandler"] = handler_el.inner_text().strip()
                    node_el = last_item.locator('.nodeName, .node-name, td:nth-child(1), span[class*="node"]').first
                    if node_el.is_visible(timeout=2000):
                        info["currentNode"] = node_el.inner_text().strip()
            except Exception:
                pass

    except Exception as e:
        print(f"WARN: 提取工单 {ticket_no} 信息失败: {e}", file=sys.stderr)

    return info if info else None


def close_workorder_panel(page):
    """关闭工单详情面板，返回列表页"""
    try:
        close_btn = page.locator(
            '.close-btn, button:has-text("关闭"), a:has-text("关闭"), '
            '.panel-close, [class*="close"]'
        ).first
        if close_btn.is_visible(timeout=3000):
            close_btn.click()
            page.wait_for_timeout(1000)
    except Exception:
        pass

    try:
        page.go_back(timeout=TIMEOUT)
        page.wait_for_load_state("networkidle", timeout=TIMEOUT)
    except Exception:
        pass


def run_capture_mode(browser, args):
    """抓包模式：记录所有网络请求，不提取数据"""
    ticket_nos = args.get("ticketNos", [])
    base_url = args.get("baseUrl", "")
    login_url = args.get("loginUrl", "")
    username = args.get("username", "")
    password = args.get("password", "")

    context = browser.new_context(
        viewport={"width": 1920, "height": 1080},
        ignore_https_errors=True,
    )
    page = context.new_page()

    # 记录所有网络请求
    requests_log = []

    def on_request(request):
        entry = {
            "method": request.method,
            "url": request.url,
        }
        if request.method == "POST":
            try:
                entry["postData"] = request.post_data
            except Exception:
                pass
        requests_log.append(entry)
        print(f"REQ: {request.method} {request.url[:150]}", file=sys.stderr)

    def on_response(response):
        url = response.url
        status = response.status
        content_type = response.headers.get("content-type", "")
        # 只记录有意义的响应（JSON、HTML、表单数据）
        if "json" in content_type or "html" in content_type or "form" in content_type or "xml" in content_type:
            try:
                body = response.text()[:2000] if status < 400 else ""
                print(f"RES: {status} {url[:150]}", file=sys.stderr)
                if body:
                    print(f"BODY: {body[:500]}", file=sys.stderr)
            except Exception:
                print(f"RES: {status} {url[:150]}", file=sys.stderr)

    page.on("request", on_request)
    page.on("response", on_response)

    # 登录
    login_a8(page, login_url, username, password)

    # 只处理第一个工单来抓包
    if ticket_nos:
        ticket_no = ticket_nos[0]
        print(f"INFO: 抓包模式 - 查询工单 {ticket_no}", file=sys.stderr)
        page.goto(base_url, timeout=NAV_TIMEOUT)
        page.wait_for_load_state("networkidle", timeout=TIMEOUT)

        if find_and_open_workorder(page, ticket_no):
            # 等待页面完全加载
            page.wait_for_timeout(5000)

            # 打印所有 frame 的 URL
            print(f"INFO: 页面 frames:", file=sys.stderr)
            for frame in page.frames:
                print(f"  FRAME: {frame.name} -> {frame.url[:150]}", file=sys.stderr)

            # 打印页面 HTML 结构摘要
            try:
                html = page.content()
                print(f"INFO: 主页面 HTML 长度: {len(html)}", file=sys.stderr)
            except Exception:
                pass

    # 输出抓包结果
    print(f"CAPTURE:{json.dumps(requests_log, ensure_ascii=False)}")

    context.close()


def main():
    if len(sys.argv) < 2:
        print("ERROR: 缺少参数", file=sys.stderr)
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(f"ERROR: 参数 JSON 解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    ticket_nos = args.get("ticketNos", [])
    base_url = args.get("baseUrl", "")
    login_url = args.get("loginUrl", "")
    username = args.get("username", "")
    password = args.get("password", "")
    mode = args.get("mode", "query")

    if not ticket_nos:
        print("WARN: 无工单号需要查询", file=sys.stderr)
        sys.exit(0)

    print(f"INFO: 开始{'抓包' if mode == 'capture' else '批量查询'} {len(ticket_nos)} 个工单")

    launch_options = {"headless": True}
    launch_options["args"] = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_options)

        try:
            if mode == "capture":
                run_capture_mode(browser, args)
            else:
                context = browser.new_context(
                    viewport={"width": 1920, "height": 1080},
                    ignore_https_errors=True,
                )
                page = context.new_page()

                try:
                    login_a8(page, login_url, username, password)

                    for i, ticket_no in enumerate(ticket_nos):
                        print(f"INFO: [{i+1}/{len(ticket_nos)}] 查询工单 {ticket_no}")

                        try:
                            page.goto(base_url, timeout=NAV_TIMEOUT)
                            page.wait_for_load_state("networkidle", timeout=TIMEOUT)

                            if not find_and_open_workorder(page, ticket_no):
                                print(f"RESULT:{{\"ticketNo\":\"{ticket_no}\",\"info\":null}}")
                                continue

                            info = extract_workorder_info(page, ticket_no)
                            result = {"ticketNo": ticket_no, "info": info}
                            print(f"RESULT:{json.dumps(result, ensure_ascii=False)}")

                            close_workorder_panel(page)

                        except Exception as e:
                            print(f"WARN: 查询工单 {ticket_no} 出错: {e}", file=sys.stderr)
                            print(f"RESULT:{{\"ticketNo\":\"{ticket_no}\",\"info\":null}}")

                finally:
                    context.close()

        finally:
            browser.close()

    print("INFO: 完成")


if __name__ == "__main__":
    main()
