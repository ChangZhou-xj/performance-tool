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


if __name__ == '__main__':
    args = parse_args()
    params = load_params_from_file(args.file)
    print_result({
        'success': True,
        'account': params.get('name') or params.get('username'),
        'steps': ['参数读取成功'],
        'screenshot': None,
    })
