#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A8 工单批量查询脚本
通过 Playwright 自动化登录 A8 系统，依次查询每个工单的处理人信息

用法:
  python3 a8-batch-query.py '{"ticketNos":["KFXQ-CX-xxx","QXWT-CX-xxx"],"baseUrl":"http://...","loginUrl":"http://...","username":"xxx","password":"xxx"}'

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

TIMEOUT = 30000  # 页面操作超时 30 秒
NAV_TIMEOUT = 60000  # 导航超时 60 秒


def login_a8(page, login_url, username, password):
    """登录 A8 系统"""
    print(f"INFO: 正在登录 A8...")
    page.goto(login_url, timeout=NAV_TIMEOUT)
    page.wait_for_load_state("networkidle", timeout=TIMEOUT)

    # 填写用户名密码
    username_input = page.locator('input[name="login_username"], input[id="login_username"], input[placeholder*="用户名"]').first
    password_input = page.locator('input[name="login_password"], input[id="login_password"], input[placeholder*="密码"], input[type="password"]').first

    username_input.fill(username)
    password_input.fill(password)

    # 点击登录按钮
    login_btn = page.locator('button[id="login_button"], input[type="submit"], button:has-text("登录"), a:has-text("登录")').first
    login_btn.click()
    page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT)
    print("INFO: 登录完成")


def find_and_open_workorder(page, ticket_no):
    """在主页查找包含工单号的链接并双击打开"""
    # 工单链接文字格式：运维工单-开发需求--KFXQ-CX-xxx--项目：xxx
    link = page.locator(f'a:has-text("{ticket_no}")').first
    if not link.is_visible(timeout=5000):
        print(f"WARN: 工单 {ticket_no} 在页面中未找到", file=sys.stderr)
        return False

    # 必须双击才能打开工单详情
    link.dblclick()
    page.wait_for_timeout(3000)
    page.wait_for_load_state("networkidle", timeout=TIMEOUT)
    return True


def extract_workorder_info(page, ticket_no):
    """从已打开的工单 iframe 中提取信息"""
    info = {}

    try:
        # 等待 iframe 出现
        collab_frame = None
        form_frame = None

        # 查找 collab_frame（审批流程）
        for frame in page.frames:
            if "collab" in frame.url or "collaboration" in frame.url:
                collab_frame = frame
                break

        # 查找 form_frame（表单）
        for frame in page.frames:
            if "form" in frame.url or "formData" in frame.url:
                form_frame = frame
                break

        # 如果没找到命名的 frame，尝试通过 name/id 查找
        if not collab_frame:
            collab_frame = page.frame("collab_frame") or page.frame("collaborationFrame")
        if not form_frame:
            form_frame = page.frame("form_frame") or page.frame("formFrame")

        # 从 form_frame 提取开发人员
        if form_frame:
            try:
                # 查找包含"开发人员"标签的输入框
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
                # 查找审批流程最后一条记录
                flow_items = collab_frame.locator(
                    '.workflow-item, .approval-item, .process-item, '
                    'tr[class*="workflow"], tr[class*="flow"], '
                    'div[class*="node"], div[class*="handler"]'
                )
                count = flow_items.count()
                if count > 0:
                    last_item = flow_items.nth(count - 1)
                    # 提取处理人
                    handler_el = last_item.locator('.handler, .handlerName, td:nth-child(2), span[class*="name"]').first
                    if handler_el.is_visible(timeout=2000):
                        info["currentHandler"] = handler_el.inner_text().strip()

                    # 提取节点名称
                    node_el = last_item.locator('.nodeName, .node-name, td:nth-child(1), span[class*="node"]').first
                    if node_el.is_visible(timeout=2000):
                        info["currentNode"] = node_el.inner_text().strip()
            except Exception:
                pass

        # 如果没找到 frame，尝试直接在主页面查找（有些 A8 版本不用 iframe）
        if not info:
            try:
                # 在页面中搜索开发人员字段
                dev_row = page.locator('tr:has(td:has-text("开发人员"))').first
                if dev_row.is_visible(timeout=3000):
                    dev_val = dev_row.locator('td:nth-child(2) input, td input[type="text"]').first
                    if dev_val.is_visible(timeout=2000):
                        info["developer"] = dev_val.input_value() or ""
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

    # 如果关不掉，尝试返回
    try:
        page.go_back(timeout=TIMEOUT)
        page.wait_for_load_state("networkidle", timeout=TIMEOUT)
    except Exception:
        pass


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

    if not ticket_nos:
        print("WARN: 无工单号需要查询", file=sys.stderr)
        sys.exit(0)

    print(f"INFO: 开始批量查询 {len(ticket_nos)} 个工单")

    with sync_playwright() as p:
        launch_options = {"headless": True}
        launch_options["args"] = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]

        browser = p.chromium.launch(**launch_options)
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            ignore_https_errors=True,
        )
        page = context.new_page()

        try:
            # 登录
            login_a8(page, login_url, username, password)

            # 逐个查询工单
            for i, ticket_no in enumerate(ticket_nos):
                print(f"INFO: [{i+1}/{len(ticket_nos)}] 查询工单 {ticket_no}")

                try:
                    # 导航到主页
                    page.goto(base_url, timeout=NAV_TIMEOUT)
                    page.wait_for_load_state("networkidle", timeout=TIMEOUT)

                    # 查找并双击打开工单
                    if not find_and_open_workorder(page, ticket_no):
                        print(f"RESULT:{{\"ticketNo\":\"{ticket_no}\",\"info\":null}}")
                        continue

                    # 提取信息
                    info = extract_workorder_info(page, ticket_no)

                    result = {"ticketNo": ticket_no, "info": info}
                    print(f"RESULT:{json.dumps(result, ensure_ascii=False)}")

                    # 关闭工单面板
                    close_workorder_panel(page)

                except Exception as e:
                    print(f"WARN: 查询工单 {ticket_no} 出错: {e}", file=sys.stderr)
                    print(f"RESULT:{{\"ticketNo\":\"{ticket_no}\",\"info\":null}}")

        finally:
            context.close()
            browser.close()

    print("INFO: 批量查询完成")


if __name__ == "__main__":
    main()
