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

            # 2. 登录
            page.fill('#loginid', username)
            page.fill('#userpassword', password)
            page.click('#submit')
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

            # 4. 点击门户
            page.wait_for_timeout(3000)
            page.mouse.move(200, 40)
            page.wait_for_timeout(500)

            portal_info = page.evaluate('''() => {
                const elements = document.querySelectorAll('*');
                let results = [];
                for (const el of elements) {
                    const text = el.innerText ? el.innerText.trim() : '';
                    if (text === '门户') {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            results.push({ text, top: rect.top, left: rect.left, width: rect.width });
                        }
                    }
                }
                return results;
            }''')

            if portal_info and len(portal_info) > 0:
                top_portal = min(portal_info, key=lambda x: x['top'])
                page.mouse.click(top_portal['left'] + top_portal['width'] / 2, top_portal['top'] + 10)
            page.wait_for_timeout(3000)
            steps.append('点击门户')

            # 5. 点击项目管理
            page.wait_for_timeout(3000)
            pm_clicked = False
            try:
                page.click('text=项目管理', timeout=10000)
                pm_clicked = True
            except Exception:
                pass

            if not pm_clicked:
                pm_info = page.evaluate('''() => {
                    const elements = document.querySelectorAll('*');
                    for (const el of elements) {
                        const text = el.innerText ? el.innerText.trim() : '';
                        if (text === '项目管理') {
                            const rect = el.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                return { found: true, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
                            }
                        }
                    }
                    return { found: false };
                }''')
                if pm_info and pm_info.get('found'):
                    page.mouse.click(pm_info['left'] + pm_info['width'] / 2, pm_info['top'] + pm_info['height'] / 2)
                    pm_clicked = True

            page.wait_for_timeout(10000)
            steps.append('点击项目管理')

            # 6. 切换到项目管理系统页面
            pages = context.pages
            pm_page = None
            for p_obj in pages:
                if 'seeyon' in p_obj.url:
                    pm_page = p_obj
                    break

            if not pm_page:
                page.wait_for_timeout(10000)
                for p_obj in context.pages:
                    if 'seeyon' in p_obj.url:
                        pm_page = p_obj
                        break

            if not pm_page:
                raise Exception('未能打开项目管理系统')

            pm_page.wait_for_load_state('networkidle')
            pm_page.wait_for_timeout(5000)
            steps.append('切换到项目管理系统')

            # 7. 点击工时管理
            pm_page.wait_for_timeout(3000)
            work_hour_click = pm_page.locator('text=工时管理').first
            if work_hour_click.is_visible(timeout=5000):
                work_hour_click.click()
            pm_page.wait_for_timeout(5000)
            steps.append('点击工时管理')

            # 8. 点击个人工时报告
            work_hour_manage = pm_page.locator('text=工时管理').first
            if work_hour_manage.is_visible(timeout=5000):
                work_hour_manage.click()
                pm_page.wait_for_timeout(1000)

            fill_report = pm_page.locator('text=个人工时报告').first
            if fill_report.is_visible(timeout=5000):
                fill_report.click()

            pm_page.wait_for_timeout(5000)
            all_pages = context.pages
            form_page = all_pages[-1]
            form_page.wait_for_load_state('networkidle')
            form_page.wait_for_timeout(3000)
            steps.append('打开个人工时报告')

            fill_method = params.get('fillMethod', 'template')
            steps.append(f'填写方式: {fill_method}')

            if fill_method == 'copy':
                # 复制历史记录
                form_page.wait_for_timeout(3000)
                copy_result = form_page.evaluate('''() => {
                    const result = { success: false, message: '' };
                    const dataRelationBody = document.getElementById('dataRelation_body');
                    if (!dataRelationBody) {
                        result.message = '未找到 #dataRelation_body';
                        return result;
                    }
                    const firstLi = dataRelationBody.querySelector('ul.dr_item > li.list_li');
                    if (!firstLi) {
                        result.message = '未找到历史记录';
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

                # 填写工时总体内容
                fill_content_result = form_page.evaluate('''() => {
                    const result = { success: false, message: '' };
                    const iframes = document.querySelectorAll('iframe');
                    for (const iframe of iframes) {
                        try {
                            const doc = iframe.contentDocument || iframe.contentWindow.document;
                            if (!doc) continue;
                            const allTextareas = doc.querySelectorAll('textarea');
                            for (const textarea of allTextareas) {
                                const placeholder = textarea.placeholder || '';
                                if (placeholder.includes('整体描述工作进展') || placeholder.includes('如无则填写')) {
                                    const currentValue = (textarea.value || '').trim();
                                    if (!currentValue) {
                                        textarea.value = '无';
                                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                                        textarea.dispatchEvent(new Event('change', { bubbles: true }));
                                        result.success = true;
                                        result.message = '已填写工时总体内容为"无"';
                                        return result;
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                    result.message = '未找到工时总体内容输入框或已有内容';
                    return result;
                }''')
                print(f'填写结果: {fill_content_result}', file=sys.stderr)

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
                        if (txt && txt.includes('工时报告')) {
                            link.click();
                            return { success: true, text: txt };
                        }
                    }
                    return { success: false, error: '未找到工时报告模板' };
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
            form_page.wait_for_timeout(10000)
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
