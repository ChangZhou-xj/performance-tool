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


def get_now():
    """获取当前时间字符串 HH:MM:SS"""
    return datetime.now().strftime('%H:%M:%S')


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
    # Windows 上 Python stdout 默认 GBK，Node.js 以 UTF-8 解码会导致中文乱码
    if sys.platform == 'win32' and hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    print(f"RESULT:{json.dumps(result, ensure_ascii=False)}")
    sys.stdout.flush()


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description='A8 工时填报自动化')
    parser.add_argument('--file', required=True, help='参数 JSON 文件路径')
    return parser.parse_args()


def fill_work_hours(params):
    """核心填报流程：登录、门户、项目管理导航"""
    from playwright.sync_api import sync_playwright

    url = params.get('url') or ''
    username = params.get('username') or ''
    password = params.get('password') or ''
    name = params.get('name') or username
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

            # 暂时关闭浏览器（任务 8 再继续）
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
    args = parse_args()
    params = load_params_from_file(args.file)
    result = fill_work_hours(params)
    print_result(result)
