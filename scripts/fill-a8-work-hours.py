#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A8 工时填报自动化脚本 - Python + Playwright

从 Node.js 入口通过 JSON 参数文件调用，操作 A8/OA 门户完成个人工时报告填写。
"""

import argparse
import json
import os
import sys
import traceback
from datetime import datetime


# 项目根目录（脚本位于 scripts/ 下）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS_DIR = os.path.join(BASE_DIR, 'logs')


def ensure_logs_dir():
    """确保日志目录存在"""
    if not os.path.exists(LOGS_DIR):
        os.makedirs(LOGS_DIR, exist_ok=True)


def get_today():
    """获取当前日期字符串 YYYY-MM-DD"""
    return datetime.now().strftime('%Y-%m-%d')


def truncate_todo(text):
    """截断待办标题：保留到「产品：xxx」为止，去掉「-支持人员：{支持人员确认}」尾巴。"""
    idx = text.find('支持人员')
    if idx != -1:
        text = text[:idx].rstrip('-')
    return text.strip()


def build_screenshot_path(username, date_str=None):
    """构建失败截图路径"""
    ensure_logs_dir()
    date_str = date_str or get_today()
    return os.path.join(LOGS_DIR, f'error_{username}_{date_str}.png')


def load_params_from_file(file_path):
    """从 JSON 文件读取参数"""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def print_result(result):
    """输出 RESULT 行，便于 Node.js 解析"""
    print(f"RESULT:{json.dumps(result, ensure_ascii=False)}")
    sys.stdout.flush()


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description='A8 工时填报自动化')
    parser.add_argument('--file', required=True, help='参数 JSON 文件路径')
    return parser.parse_args()


def fill_work_hours(params):
    """核心填报流程：登录、门户、项目管理导航"""
    url = params.get('url') or ''
    username = params.get('username') or ''
    password = params.get('password') or ''
    name = params.get('name') or username

    if params.get('dryRun'):
        return {
            'success': True,
            'account': name,
            'steps': ['dry-run 模式：跳过浏览器操作'],
            'screenshot': None,
        }

    from playwright.sync_api import sync_playwright

    headless = params.get('headless', True)
    slow_mo = params.get('slowMo', 300)

    screenshot_path = build_screenshot_path(username, params.get('date'))
    steps = []
    browser = None
    context = None
    page = None
    form_page = None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless, slow_mo=slow_mo)
            context = browser.new_context()
            page = context.new_page()

            # 1. 打开登录页
            page.goto(url)
            page.wait_for_timeout(5000)
            steps.append('打开登录页')

            # 2. 登录（Seeyon A8 V8 登录表单：login_username / login_password1 / login_button，
            #    login_password 为页面 JS 加密后的隐藏字段，点击按钮后自动生成并提交）
            page.fill('#login_username', username)
            page.fill('#login_password1', password)
            page.click('#login_button')
            page.wait_for_timeout(6000)
            steps.append('登录成功')

            # 3. 关闭弹窗
            page.wait_for_timeout(2000)
            close_buttons = page.query_selector_all('.ant-modal-close, [class*="close"]')
            for btn in close_buttons[:3]:
                try:
                    btn.click(timeout=1500)
                except Exception:
                    pass
            page.wait_for_timeout(1000)
            steps.append('关闭弹窗')

            # 3.5 抓取门户「待办中心」前两条待办，用于填充工时具体描述
            page.wait_for_timeout(2000)
            todo_raw = page.evaluate('''() => {
                const items = document.querySelectorAll('div.colDiv.columnRowDiv');
                const out = [];
                for (const el of items) {
                    const t = (el.innerText || '').trim();
                    if (t) out.push(t);
                    if (out.length >= 2) break;
                }
                return out;
            }''')
            todos = [truncate_todo(t) for t in todo_raw]
            steps.append(f'抓取待办 {len(todos)} 条')
            if todos:
                print(f'待办明细: {todos}', file=sys.stderr)
            todo_text = '\n'.join(todos)

            # 4. 悬停展开左侧「工时管理」一级菜单（Seeyon A8 左侧菜单为 hover 展开）
            page.wait_for_timeout(3000)
            lev1 = page.locator('li.lev1Li > div.lev1Title > div.navText', has_text='工时管理').first
            lev1.hover(timeout=10000)
            page.wait_for_timeout(2000)
            steps.append('悬停展开工时管理菜单')

            # 5. 点击二级菜单「[填写]个人工时报告」，会在新标签页打开表单
            form_link = page.locator('li.lev2Li', has_text='个人工时报告')
            clicked = False
            for i in range(form_link.count()):
                el = form_link.nth(i)
                if el.is_visible():
                    el.click(timeout=10000)
                    clicked = True
                    break
            if not clicked:
                raise Exception('未找到可见的「个人工时报告」二级菜单')
            page.wait_for_timeout(3000)
            steps.append('点击个人工时报告')

            # 6. 切换到新打开的表单标签页
            form_page = context.pages[-1]
            # 只等 domcontentloaded（HTML 解析完成）。不能等 load/networkidle：
            # 二者依赖页面所有子资源加载完成，A8 服务端慢时有挂起请求会导致
            # load 永不触发，30s 超时（2026-09-04 实测两种签名各失败一次）。
            # 内容就绪由下方各填报分支的条件等待保证。
            form_page.wait_for_load_state('domcontentloaded')
            form_page.wait_for_timeout(5000)
            steps.append('切换到个人工时报告表单页')

            fill_method = params.get('fillMethod', 'template')
            steps.append(f'填写方式: {fill_method}')

            if fill_method == 'copy':
                # 复制历史记录：等「我发起的数据」区异步渲染完成，避免时序竞态找不到历史记录。
                # 注意：必须等实际记录条目 li（async XHR 填充），不能只等容器 #dataRelation_body——
                # 容器一开始就在 DOM，state='attached' 立刻返回，此时记录还没渲染，evaluate 会误判为无记录。
                try:
                    form_page.wait_for_selector(
                        '#dataRelation_body ul.dr_item > li.list_li',
                        state='visible',
                        timeout=30000,
                    )
                except Exception:
                    # 等待超时：要么真无历史记录，要么选择器与现网 DOM 不符
                    #（记录可能渲染成别的结构）。交给下方 evaluate 收集证据并报错/截图。
                    pass
                copy_result = form_page.evaluate('''() => {
                    const result = { success: false, message: '' };
                    const dataRelationBody = document.getElementById('dataRelation_body');
                    if (!dataRelationBody) {
                        result.message = '未找到 #dataRelation_body';
                        return result;
                    }
                    const firstLi = dataRelationBody.querySelector('ul.dr_item > li.list_li');
                    if (!firstLi) {
                        // 诊断：dump「我发起的数据」区实际结构，区分「真无记录」与「选择器不匹配」
                        const ul = dataRelationBody.querySelector('ul.dr_item');
                        const liCount = ul ? ul.querySelectorAll(':scope > li').length : 0;
                        const htmlLen = (dataRelationBody.innerHTML || '').length;
                        const allLi = dataRelationBody.querySelectorAll('li').length;
                        const txt = ((dataRelationBody.innerText || '').replace(/\s+/g, ' ')).slice(0, 120);
                        result.message = '未找到历史记录(ul=' + !!ul + ', dr_item_li=' + liCount
                            + ', 全部li=' + allLi + ', htmlLen=' + htmlLen + ', 文本="' + txt + '")';
                        return result;
                    }
                    const recordTitle = firstLi.getAttribute('title');
                    let copyBtn = firstLi.querySelector('span.copyToLeftHover[title="复制至当前模板"]');
                    if (!copyBtn) copyBtn = firstLi.querySelector('span#copyToForm');
                    if (!copyBtn) {
                        const spans = firstLi.querySelectorAll('span[title]');
                        for (const span of spans) {
                            const title = span.getAttribute('title');
                            if (title && title.includes('复制')) {
                                copyBtn = span;
                                break;
                            }
                        }
                    }
                    if (!copyBtn) {
                        result.message = '记录 "' + recordTitle + '" 中未找到复制按钮';
                        return result;
                    }
                    if (copyBtn.onclick) {
                        copyBtn.onclick.call(copyBtn, new Event('click'));
                    } else {
                        copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    }
                    result.success = true;
                    result.message = '已复制: ' + recordTitle;
                    return result;
                }''')
                print(f'复制结果: {copy_result}', file=sys.stderr)
                if not copy_result.get('success'):
                    raise Exception(copy_result.get('message', '复制历史记录失败'))

                # 填写工时总体内容（报告内容）为「无」，用 Playwright fill 触发 Vue 双向绑定
                zw_frame = form_page.frame_locator('#zwIframe')
                report_areas = zw_frame.locator('textarea[placeholder*="整体描述工作进展"]')
                # 复制后表单会异步重渲染，等 textarea 渲染出来再填
                try:
                    report_areas.first.wait_for(state='visible', timeout=30000)
                except Exception:
                    pass
                report_filled = False
                for i in range(report_areas.count()):
                    try:
                        report_areas.nth(i).fill('无')
                        report_filled = True
                    except Exception:
                        pass
                if not report_filled:
                    raise Exception('未找到报告内容输入框')
                steps.append('已填写工时总体内容为"无"')

                # 填写工时具体描述（项目工作内容表格），用抓取的待办覆盖
                if todos:
                    desc_areas = zw_frame.locator('textarea[placeholder*="工时描述"]')
                    desc_filled = False
                    for i in range(desc_areas.count()):
                        try:
                            desc_areas.nth(i).fill(todo_text)
                            desc_filled = True
                        except Exception:
                            pass
                    if not desc_filled:
                        raise Exception('未找到工时描述输入框')
                    steps.append('已填写工时具体描述')

            elif fill_method == 'template':
                # 调用模板
                form_page.evaluate('''() => {
                    const allElements = document.querySelectorAll('a, button, span');
                    for (const el of allElements) {
                        if (el.innerText && el.innerText.includes('调用模板') && el.innerText.length < 10) {
                            el.click();
                            break;
                        }
                    }
                }''')
                form_page.wait_for_timeout(3000)

                select_template_result = form_page.evaluate('''() => {
                    const iframe = document.getElementById('layui-layer-iframe1');
                    if (!iframe) return { success: false, error: '未找到iframe' };
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (!iframeDoc) return { success: false, error: '无法访问iframe文档' };
                    const allLinks = iframeDoc.querySelectorAll('a[id^="tree_"]');
                    for (const link of allLinks) {
                        const txt = (link.innerText || '').trim();
                        if (txt && (txt.includes('工时填报') || txt.includes('工时报告'))) {
                            link.click();
                            return { success: true, text: txt };
                        }
                    }
                    return { success: false, error: '未找到工时填报模板' };
                }''')
                print(f'模板选择结果: {select_template_result}', file=sys.stderr)

                if select_template_result.get('success'):
                    form_page.wait_for_timeout(1500)
                    form_page.evaluate('''() => {
                        const confirmBtns = document.querySelectorAll('.layui-layer-btn0');
                        for (const btn of confirmBtns) {
                            if (btn.innerText && btn.innerText.includes('确定')) {
                                btn.click();
                                return true;
                            }
                        }
                        return false;
                    }''')
                    form_page.wait_for_timeout(5000)
                else:
                    form_page.evaluate('''() => {
                        const cancelBtns = document.querySelectorAll('.layui-layer-btn1, .layui-layer-close');
                        for (const btn of cancelBtns) {
                            if ((btn.innerText && btn.innerText.includes('取消')) || (btn.className && btn.className.includes('close'))) {
                                btn.click();
                                return true;
                            }
                        }
                        return false;
                    }''')
                    form_page.wait_for_timeout(2000)

            steps.append('模板/历史记录处理完成')

            # 9. 填写日期
            target_date = params.get('date') or get_today()
            target_day = int(target_date.split('-')[2])
            steps.append(f'填写日期: {target_date}')

            # 滚动到日期输入框
            form_page.evaluate('''() => {
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow.document;
                        if (!doc) continue;
                        const dateSections = doc.querySelectorAll('section.cap4-date');
                        for (const section of dateSections) {
                            const titleEl = section.querySelector('.field-title');
                            if (titleEl && titleEl.innerText.includes('工时日期')) {
                                section.scrollIntoView({ behavior: 'instant', block: 'center' });
                                return { scrolled: true };
                            }
                        }
                    } catch (e) {}
                }
                return { scrolled: false };
            }''')
            form_page.wait_for_timeout(1500)

            # 清空日期输入框
            form_page.evaluate('''() => {
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow.document;
                        if (!doc) continue;
                        const dateSections = doc.querySelectorAll('section.cap4-date');
                        for (const section of dateSections) {
                            const titleEl = section.querySelector('.field-title');
                            if (titleEl && titleEl.innerText.includes('工时日期')) {
                                const input = section.querySelector('input');
                                if (input) {
                                    input.value = '';
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                    input.dispatchEvent(new Event('change', { bubbles: true }));
                                    return { cleared: true };
                                }
                            }
                        }
                    } catch (e) {}
                }
                return { cleared: false };
            }''')
            form_page.wait_for_timeout(500)

            # 打开日历
            open_cal_result = form_page.evaluate('''() => {
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    try {
                        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                        if (!iframeDoc) continue;
                        const dateSections = iframeDoc.querySelectorAll('section.cap4-date');
                        for (const section of dateSections) {
                            const titleEl = section.querySelector('.field-title');
                            if (titleEl && titleEl.innerText.includes('工时日期')) {
                                let pickerBtn = section.querySelector('.cap4-date__picker');
                                if (pickerBtn) {
                                    pickerBtn.click();
                                    return { success: true };
                                }
                            }
                        }
                    } catch (e) {}
                }
                return { success: false };
            }''')
            print(f'打开日历结果: {open_cal_result}', file=sys.stderr)
            form_page.wait_for_timeout(2000)

            if open_cal_result.get('success'):
                # 点击今日按钮
                today_btn_info = form_page.evaluate('''() => {
                    const iframes = document.querySelectorAll('iframe');
                    for (const iframe of iframes) {
                        try {
                            const doc = iframe.contentDocument || iframe.contentWindow.document;
                            if (!doc) continue;
                            const tables = doc.querySelectorAll('table');
                            for (const table of tables) {
                                const buttons = table.querySelectorAll('td.button');
                                for (const btn of buttons) {
                                    const btnText = (btn.innerText || '').trim();
                                    if (btnText === '今日') {
                                        const rect = btn.getBoundingClientRect();
                                        const iframeRect = iframe.getBoundingClientRect();
                                        return { found: true, x: iframeRect.left + rect.left + rect.width / 2, y: iframeRect.top + rect.top + rect.height / 2 };
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                    return { found: false };
                }''')

                if today_btn_info.get('found'):
                    form_page.mouse.click(today_btn_info['x'], today_btn_info['y'])
                form_page.wait_for_timeout(1500)

                # 选择今天的日期单元格
                select_result = form_page.evaluate(f'''(targetDay) => {{
                    const iframes = document.querySelectorAll('iframe');
                    for (const iframe of iframes) {{
                        try {{
                            const doc = iframe.contentDocument || iframe.contentWindow.document;
                            if (!doc) continue;
                            const tables = doc.querySelectorAll('table');
                            for (const table of tables) {{
                                const buttons = table.querySelectorAll('td.button');
                                let hasTodayBtn = false;
                                for (const btn of buttons) {{
                                    if ((btn.innerText || '').trim() === '今日') {{
                                        hasTodayBtn = true;
                                        break;
                                    }}
                                }}
                                if (!hasTodayBtn) continue;
                                const cells = table.querySelectorAll('td');
                                for (const cell of cells) {{
                                    if (cell.className && cell.className.includes('today')) {{
                                        cell.click();
                                        return {{ success: true, date: (cell.innerText || '').trim(), method: 'today_class' }};
                                    }}
                                }}
                                for (const cell of cells) {{
                                    const text = (cell.innerText || '').trim();
                                    if (text === String(targetDay) || text === String(targetDay).padStart(2, '0')) {{
                                        cell.click();
                                        return {{ success: true, date: text, method: 'date_number' }};
                                    }}
                                }}
                            }}
                        }} catch (e) {{}}
                    }}
                    return {{ success: false }};
                }}''', target_day)
                print(f'选择日期结果: {select_result}', file=sys.stderr)
                form_page.wait_for_timeout(800)

                # 点击确定按钮
                confirm_result = form_page.evaluate('''() => {
                    function findAndClickConfirm(doc, location) {
                        if (!doc) return null;
                        const spans = doc.querySelectorAll('span.common_button_emphasize');
                        for (const span of spans) {
                            if ((span.innerText || '').trim() === '确定') {
                                span.click();
                                return { success: true, method: 'class_selector', location };
                            }
                        }
                        const allSpans = doc.querySelectorAll('span');
                        for (const span of allSpans) {
                            if ((span.innerText || '').trim() === '确定') {
                                const rect = span.getBoundingClientRect();
                                if (rect.width > 0 && rect.height > 0) {
                                    span.click();
                                    return { success: true, method: 'span_text', location };
                                }
                            }
                        }
                        const buttons = doc.querySelectorAll('button, input[type="button"], a');
                        for (const btn of buttons) {
                            const text = (btn.innerText || '').trim() || (btn.value || '').trim();
                            if (text === '确定') {
                                btn.click();
                                return { success: true, method: 'button_selector', location };
                            }
                        }
                        return null;
                    }
                    const mainResult = findAndClickConfirm(document, 'main');
                    if (mainResult) return mainResult;
                    const iframes = document.querySelectorAll('iframe');
                    for (let i = 0; i < iframes.length; i++) {
                        try {
                            const doc = iframes[i].contentDocument || iframes[i].contentWindow.document;
                            const result = findAndClickConfirm(doc, 'iframe[' + i + ']');
                            if (result) return result;
                        } catch (e) {}
                    }
                    return { success: false, message: '未找到确定按钮' };
                }''')
                print(f'确定按钮点击结果: {confirm_result}', file=sys.stderr)
                form_page.wait_for_timeout(1000)

            steps.append('日期填写完成')

            # 10. 发送前确认
            final_check = form_page.evaluate('''() => {
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow.document;
                        if (!doc) continue;
                        const dateSections = doc.querySelectorAll('section.cap4-date');
                        for (const section of dateSections) {
                            const titleEl = section.querySelector('.field-title');
                            if (titleEl && titleEl.innerText.includes('工时日期')) {
                                const input = section.querySelector('input');
                                if (input) {
                                    return { found: true, dateValue: input.value, title: titleEl.innerText.trim() };
                                }
                            }
                        }
                    } catch (e) {}
                }
                return { found: false };
            }''')
            print(f'发送前确认 - 工时日期: {final_check}', file=sys.stderr)
            steps.append(f'发送前确认 - 工时日期: {final_check.get("dateValue", "未找到")}')

            # 11. 发送
            form_page.evaluate('''() => {
                const masks = document.querySelectorAll('.mask');
                masks.forEach(m => m.remove());
                const spans = document.querySelectorAll('span');
                for (const span of spans) {
                    if (span.innerText === '发送' && span.id) {
                        span.click();
                        break;
                    }
                }
            }''')
            try:
                form_page.wait_for_timeout(10000)
            except Exception:
                pass  # 发送成功后 A8 会关闭表单页，等待超时/页面关闭属正常
            steps.append('发送成功')

            context.close()
            browser.close()

        return {
            'success': True,
            'account': name,
            'steps': steps,
            'screenshot': None,
        }
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        try:
            if form_page:
                form_page.screenshot(path=screenshot_path, full_page=True)
            elif page:
                page.screenshot(path=screenshot_path, full_page=True)
        except Exception as screenshot_err:
            print(f'截图失败: {screenshot_err}', file=sys.stderr)

        if context:
            try:
                context.close()
            except Exception:
                pass
        if browser:
            try:
                browser.close()
            except Exception:
                pass

        return {
            'success': False,
            'account': name,
            'error': str(e),
            'steps': steps,
            'screenshot': screenshot_path if os.path.exists(screenshot_path) else None,
        }


if __name__ == '__main__':
    # Windows 上 Python stdout 默认 GBK，Node.js 以 UTF-8 解码会导致中文乱码
    if sys.platform == 'win32' and hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')

    args = parse_args()
    params = load_params_from_file(args.file)
    result = fill_work_hours(params)
    print_result(result)
