#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A8 工时填报 Python 层单元测试
"""

import importlib.util
import json
import os
import sys
import tempfile
import unittest

# 通过 importlib 加载带连字符的模块名
SCRIPT_PATH = os.path.join(os.path.dirname(__file__), '..', 'scripts', 'fill-a8-work-hours.py')
spec = importlib.util.spec_from_file_location('fill_a8_work_hours', SCRIPT_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

get_today = module.get_today
get_now = module.get_now
build_screenshot_path = module.build_screenshot_path
load_params_from_file = module.load_params_from_file



class TestUtils(unittest.TestCase):
    def test_get_today_format(self):
        today = get_today()
        self.assertRegex(today, r'^\d{4}-\d{2}-\d{2}$')

    def test_get_now_format(self):
        now = get_now()
        self.assertRegex(now, r'^\d{2}:\d{2}:\d{2}$')

    def test_build_screenshot_path_contains_username_and_date(self):
        path = build_screenshot_path('1003854', '2026-08-03')
        self.assertIn('error_1003854_2026-08-03.png', path)
        self.assertTrue(path.endswith('.png'))

    def test_build_screenshot_path_uses_today_when_no_date(self):
        path = build_screenshot_path('testuser')
        self.assertIn('testuser', path)
        self.assertIn(get_today(), path)

    def test_load_params_from_file(self):
        params = {'username': 'u1', 'password': 'p1', 'fillMethod': 'template'}
        with tempfile.NamedTemporaryFile('w', delete=False, encoding='utf-8') as f:
            json.dump(params, f)
            tmp_path = f.name
        try:
            loaded = load_params_from_file(tmp_path)
            self.assertEqual(loaded, params)
        finally:
            os.unlink(tmp_path)


if __name__ == '__main__':
    unittest.main()
