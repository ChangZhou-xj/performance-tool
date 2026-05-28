#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A8 工单批量查询脚本
通过 Playwright 自动化登录 A8 系统，依次查询每个工单的处理人信息

用法:
  python3 a8-batch-query.py '{"ticketNos":["KFXQ-CX-xxx"],"baseUrl":"http://...","loginUrl":"http://...","username":"xxx","password":"xxx"}'

输出:
  RESULT:{"ticketNo":"xxx","info":{"developer":"张三","currentHandler":"李四","currentNode":"开发处理"}}
  RESULT:{"ticketNo":"yyy","info":null}
"""

import sys
import json
import re
import os

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)

TIMEOUT = 30000
NAV_TIMEOUT = 60000
MAIN_PAGE_URL = 'http://120.35.0.67:28101/seeyon/main.do?method=main'


def login_a8(page, login_url, username, password):
    """登录 A8 系统"""
    print(f"INFO: 正在登录 A8...", file=sys.stderr)
    page.goto(login_url, timeout=NAV_TIMEOUT)
    page.wait_for_load_state("networkidle", timeout=TIMEOUT)

    page.locator('input#login_username').fill(username)
    page.locator('input#login_password1').fill(password)
    page.locator('input#login_button').click()
    page.wait_for_load_state("networkidle", timeout=NAV_TIMEOUT)
    print("INFO: 登录完成", file=sys.stderr)


def find_affair_id(page, ticket_no):
    """在主页查找包含工单号的链接，提取 affairId"""
    result = page.evaluate(r"""(ticketNo) => {
        const links = document.querySelectorAll("a");
        for (const l of links) {
            if ((l.innerText || "").includes(ticketNo)) {
                const onclick = l.getAttribute("onclick") || "";
                const match = onclick.match(/affairId=([^&'"]+)/);
                return match ? match[1] : null;
            }
        }
        return null;
    }""", ticket_no)
    return result


def open_workorder(page, ticket_no, affair_id):
    """通过 A8 的 checkAndOpenLink JS API 打开工单"""
    collab_url = f'/collaboration/collaboration.do?method=summary&openFrom=listPending&affairId={affair_id}&showTab=true'

    page.evaluate(r"""([ticketNo, collabUrl, affairId]) => {
        const links = document.querySelectorAll("a");
        for (const l of links) {
            if ((l.innerText || "").includes(ticketNo)) {
                vPortal.sectionHandler.multiRowVariableColumnColTemplete.checkAndOpenLink(
                    collabUrl, '3', affairId, '1', 'null', l
                );
                break;
            }
        }
    }""", [ticket_no, collab_url, affair_id])

    page.wait_for_timeout(8000)


def extract_current_handler_from_workflow(page, collab_frame):
    """从流程视图中提取当前节点和处理人信息

    A8 流程图在 iframe (/seeyon/workflow/designer.do?method=showDiagram) 中渲染。
    当前节点通过 <use href="#icon_..._current"> 标识。
    流程文本中，节点名后面紧跟的人名即为该节点的处理人。
    """
    try:
        # 切换到流程 tab
        collab_frame.evaluate(r"""() => {
            const a = document.querySelector("li#workflow_view_li a");
            if (a) a.click();
        }""")
        page.wait_for_timeout(5000)
    except Exception:
        pass

    # 找流程 iframe
    workflow_frame = None
    for frame in page.frames:
        if 'workflow/designer' in frame.url and 'showDiagram' in frame.url:
            workflow_frame = frame
            break

    if not workflow_frame:
        return None

    result = workflow_frame.evaluate(r"""() => {
        // 1. 找当前节点名（use[href*="current"] 所在的 g 元素的 text）
        let currentNode = "";
        const uses = document.querySelectorAll("use");
        for (const u of uses) {
            const href = u.getAttribute("xlink:href") || u.getAttribute("href") || "";
            if (href.includes("current")) {
                const g = u.closest("g");
                if (g) {
                    const texts = g.querySelectorAll("text");
                    for (const t of texts) {
                        let c = (t.textContent || "").trim();
                        // 去掉重复文本（SVG text 会有两份，如"开发人员开发中开发人员开发中"）
                        const half = c.substring(0, Math.ceil(c.length / 2));
                        if (c === half + half) {
                            c = half;
                        }
                        // 跳过 [审批-xxx] 类的组织标签
                        if (c.match(/^\[审批/) || c === "[审批-财信]") continue;
                        if (c) {
                            currentNode = c;
                        }
                    }
                }
                break;
            }
        }

        // 2. 从流程文本中找当前节点后面的人名
        // 流程文本中节点和人名交替出现，人名紧跟在其处理的节点后面
        const bodyText = document.body.innerText || "";
        const lines = bodyText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        const nodes = [];
        for (const line of lines) {
            if (line === "流程预测" || line === "[审批-财信]" || line.match(/^\d+%$/)) continue;
            nodes.push(line);
        }

        // 找当前节点在列表中的位置，然后向后找人名
        let currentHandler = "";
        if (currentNode) {
            const idx = nodes.indexOf(currentNode);
            if (idx >= 0) {
                // 从当前节点的下一个开始，找第一个是人名的条目
                // 人名特征: 2-4个中文字符，或含"()"(如"黄圣茂(博思软件)")
                // 不是节点名(不含: 处理、验证、确认、评估、发起、开发、支持、人员)
                for (let i = idx + 1; i < nodes.length; i++) {
                    const name = nodes[i];
                    if (!name.match(/处理|验证|确认|评估|发起|开发|支持|人员|一线|节点/)) {
                        currentHandler = name;
                        break;
                    }
                }
            }
        }

        // 3. 降级: 如果没找到当前节点，取文本中第一个人名（通常在"研发负责人处理"后面）
        if (!currentHandler && !currentNode && nodes.length > 0) {
            for (let i = 0; i < nodes.length; i++) {
                if (!nodes[i].match(/处理|验证|确认|评估|发起|开发|支持|人员|一线|节点/)) {
                    currentHandler = nodes[i];
                    break;
                }
            }
        }

        if (currentNode || currentHandler) {
            return {
                currentNode: currentNode,
                currentHandler: currentHandler
            };
        }
        return null;
    }""")

    return result


def extract_current_handler(collab_frame):
    """从 collab_frame 意见区提取当前处理人（降级方案）

    A8 审批意见区中，当前节点格式:
    <span>姓名</span> <span class="padding_l_5 color_black" title="部门">部门</span>
    <span class="margin_l_20 font_bold">暂存待办</span> <span>日期</span>
    """
    handler_info = collab_frame.evaluate(r"""() => {
        const statusSpans = document.querySelectorAll("span.font_bold, span.margin_l_20");
        for (const s of statusSpans) {
            const statusText = (s.innerText || "").trim();
            if (statusText.match(/暂存待办|移交|回退|办理中|已办/)) {
                const parent = s.parentElement || s.parentNode;
                if (parent) {
                    const parentText = (parent.innerText || "").trim();
                    const match = parentText.match(/^(\S+)\s+(\S+(?:\s*\S+)?)\s*(暂存待办|移交|回退|办理中)(\d{4}-\d{2}-\d{2})?/);
                    if (match) {
                        return {
                            currentHandler: match[1],
                            currentNode: match[3],
                            department: match[2],
                            date: match[4] || ""
                        };
                    }
                    return {currentHandler: parentText.substring(0, 60)};
                }
            }
        }
        return null;
    }""")
    return handler_info


def extract_developer(form_frame):
    """从 form_frame 提取开发人员字段

    A8 表单中，开发人员字段可能是:
    1. 普通 input，同行 label 包含 "开发人员"
    2. 自定义组件，人名在 label 文本中（如 "开发人员\n代吉盛、陈政伟"），
       input value 可能是其他值（如"补丁包"）
    """
    if not form_frame:
        return None

    try:
        form_frame.wait_for_timeout(5000)
    except Exception:
        pass

    dev_info = form_frame.evaluate(r"""() => {
        // 方法1: 在 label 文本中查找 "开发人员" 后跟人名
        // A8 表单结构: 同一个 tr/div 中，label 和 input 并列
        // 例如: "开发人员\n代吉盛、陈政伟" 在 label 区域，input value 是 "补丁包"
        const containers = document.querySelectorAll("tr, div[class*='field'], div[class*='row']");
        for (const container of containers) {
            const text = (container.innerText || "").trim();
            if (text.includes("开发人员")) {
                // 尝试从 label 文本中提取人名
                // 格式: "开发人员\n名字1、名字2" 或 "开发人员\t名字"
                const labelMatch = text.match(/开发人员[\n\t]+([^\n\t]+?)(?:[\n\t]|$)/);
                if (labelMatch && labelMatch[1].trim()) {
                    const candidate = labelMatch[1].trim();
                    // 确认提取的不是选项值（如"补丁包"、"确定修改"）
                    if (candidate.match(/[一-龥]{2,}/) && !candidate.match(/^(补丁包|确定修改|暂不修改|其他)$/)) {
                        return candidate;
                    }
                }

                // 方法2: 找容器内的 input/select
                const input = container.querySelector("input[type='text']");
                if (input && input.value && input.value.trim()) {
                    const val = input.value.trim();
                    // 检查 value 是否像人名（中文2-4字或含顿号分隔的多名）
                    if (val.match(/^[一-龥]{2,4}(?:[、,，][一-龥]{2,4})*$/)) {
                        return val;
                    }
                }

                const select = container.querySelector("select");
                if (select) {
                    const opt = select.options ? select.options[select.selectedIndex] : null;
                    if (opt && opt.text && opt.text.trim()) {
                        return opt.text.trim();
                    }
                }
            }
        }

        // 方法3: 遍历所有 input，检查同行 label 是否包含"开发人员"
        const inputs = document.querySelectorAll("input[type='text']");
        for (const inp of inputs) {
            if (!inp.value || !inp.value.trim() || inp.value.length <= 1) continue;
            const row = inp.closest("tr") || inp.closest("div[class*='field']") || inp.parentElement?.parentElement;
            if (row) {
                const rowText = (row.innerText || "").trim();
                if (rowText.includes("开发人员")) {
                    const val = inp.value.trim();
                    if (val.match(/^[一-龥]{2,4}(?:[、,，][一-龥]{2,4})*$/)) {
                        return val;
                    }
                    // value 不是人名，尝试从 label 文本提取
                    const labelMatch = rowText.match(/开发人员[\n\t]+([^\n\t]+?)(?:[\n\t]|$)/);
                    if (labelMatch && labelMatch[1].trim().match(/[一-龥]{2,}/)) {
                        return labelMatch[1].trim();
                    }
                }
            }
        }

        return null;
    }""")
    return dev_info


def extract_workorder_info(page, ticket_no):
    """从已打开的工单中提取处理人信息"""
    info = {}

    try:
        collab_frame = None
        form_frame = None
        for frame in page.frames:
            url = frame.url
            if 'collaboration' in url and 'summary' in url:
                collab_frame = frame
            if 'form/dist/index.html' in url:
                form_frame = frame

        # 提取当前处理人（优先从流程视图提取，降级到意见区）
        if collab_frame:
            handler = extract_current_handler_from_workflow(page, collab_frame)
            if not handler:
                # 降级: 从意见区提取
                handler = extract_current_handler(collab_frame)
            if handler:
                if handler.get('currentHandler'):
                    info['currentHandler'] = handler['currentHandler']
                if handler.get('currentNode'):
                    info['currentNode'] = handler['currentNode']
                if handler.get('department'):
                    info['department'] = handler['department']

        # 提取开发人员
        if form_frame:
            developer = extract_developer(form_frame)
            if developer:
                info['developer'] = developer

    except Exception as e:
        print(f"WARN: 提取工单 {ticket_no} 信息失败: {e}", file=sys.stderr)

    return info if info else None


def go_back_to_main(page):
    """回到主页，准备查询下一个工单"""
    try:
        page.goto(MAIN_PAGE_URL, timeout=NAV_TIMEOUT)
        page.wait_for_load_state("networkidle", timeout=TIMEOUT)
    except Exception:
        pass


def main():
    if len(sys.argv) < 2:
        print("ERROR: 缺少参数", file=sys.stderr)
        sys.exit(1)

    # 支持 --file 方式传入 JSON 参数（Windows 兼容）
    if sys.argv[1] == "--file" and len(sys.argv) >= 3:
        try:
            with open(sys.argv[2], 'r', encoding='utf-8') as f:
                args = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError) as e:
            print(f"ERROR: 参数文件解析失败: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        try:
            args = json.loads(sys.argv[1])
        except json.JSONDecodeError as e:
            print(f"ERROR: 参数 JSON 解析失败: {e}", file=sys.stderr)
            sys.exit(1)

    ticket_nos = args.get("ticketNos", [])
    login_url = args.get("loginUrl", MAIN_PAGE_URL)
    username = args.get("username", "")
    password = args.get("password", "")

    if not ticket_nos:
        print("WARN: 无工单号需要查询", file=sys.stderr)
        sys.exit(0)

    print(f"INFO: 开始批量查询 {len(ticket_nos)} 个工单", file=sys.stderr)

    launch_options = {
        "headless": True,
        "args": ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_options)

        try:
            context = browser.new_context(
                viewport={"width": 1920, "height": 1080},
                ignore_https_errors=True,
            )
            page = context.new_page()

            try:
                login_a8(page, login_url, username, password)

                for i, ticket_no in enumerate(ticket_nos):
                    print(f"INFO: [{i+1}/{len(ticket_nos)}] 查询工单 {ticket_no}", file=sys.stderr)

                    try:
                        go_back_to_main(page)

                        affair_id = find_affair_id(page, ticket_no)
                        if not affair_id:
                            print(f"WARN: 工单 {ticket_no} 在主页待办列表中未找到（可能不在当前用户待办中）", file=sys.stderr)
                            result = {"ticketNo": ticket_no, "info": None}
                            print(f"RESULT:{json.dumps(result, ensure_ascii=False)}")
                            continue

                        open_workorder(page, ticket_no, affair_id)
                        info = extract_workorder_info(page, ticket_no)
                        result = {"ticketNo": ticket_no, "info": info}
                        print(f"RESULT:{json.dumps(result, ensure_ascii=False)}")

                    except Exception as e:
                        print(f"WARN: 查询工单 {ticket_no} 出错: {e}", file=sys.stderr)
                        result = {"ticketNo": ticket_no, "info": None}
                        print(f"RESULT:{json.dumps(result, ensure_ascii=False)}")

            finally:
                context.close()

        finally:
            browser.close()

    print("INFO: 完成", file=sys.stderr)


if __name__ == "__main__":
    main()
