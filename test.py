#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
playwright 环境自检脚本 —— 纯本地检查：不联网、不连 A8 服务器。
用法二选一：
  1) cd /ql/data/scripts/performance-tool && python3 test.py
  2) npm run check:a8-env   # 与填报任务用同一个解释器(A8_WORK_PYTHON)执行，最贴近真实填报环境
"""
import importlib
import platform
import shutil
import sys

print('================ 环境自检 ================')
print('== 解释器 ==')
print('  exe      :', sys.executable)
print('  version  :', sys.version.split()[0])
print('  platform :', sys.platform)
print('  machine  :', platform.machine())
try:
    import sysconfig
    print('  sysconfig:', sysconfig.get_platform())
except Exception as e:
    print('  sysconfig: 读取失败 %r' % (e,))

# playwright 及它 import 时需要的依赖（缺任意一个，填报的 from playwright.sync_api 都会失败/缺 daemon）
PACKAGES = ['playwright', 'greenlet', 'pyee', 'typing_extensions']
print('== 包检查 ==')
has_pw = False
pw_version = None
for pkg in PACKAGES:
    try:
        mod = importlib.import_module(pkg)
    except Exception as e:
        print('  [MISS] %-18s %s: %s' % (pkg, type(e).__name__, e))
        continue
    ver = getattr(mod, '__version__', None) or getattr(mod, 'VERSION', '?')
    print('  [ OK ] %-18s 版本=%s' % (pkg, ver))
    print('         %s' % getattr(mod, '__file__', ''))
    if pkg == 'playwright':
        has_pw = True
        pw_version = ver

print('== playwright 子模块（填报实际用到 sync_api）==')
if not has_pw:
    print('  playwright 未安装，跳过子模块检查')
else:
    for sub in ['playwright.sync_api', 'playwright.async_api']:
        try:
            importlib.import_module(sub)
            print('  [ OK ] %s' % sub)
        except Exception as e:
            print('  [MISS] %s  %s: %s' % (sub, type(e).__name__, e))

print('== 命令行入口 ==')
cli = shutil.which('playwright')
print('  playwright 命令:', cli or '(无 —— 说明 playwright 相关执行文件未落到 PATH，import 可能不受影响)')

print('== 结论 ==')
print()
if has_pw:
    print('  ★ playwright 已就绪（版本 %s），本解释器可直接填报。' % pw_version)
    print('  若仍在本机报 “No module named playwright”，则是「解释器分裂」：')
    print('  填报任务解析到的 python3 与本脚本不同。请在青龙环境变量设置：')
    print('    A8_WORK_PYTHON=%s' % sys.executable)
    print('  然后重跑 npm run fill:a8-hours 或 npm run ql:a8-fill。')
else:
    print('  ✗ playwright 未安装 —— 需要先完成依赖安装。')
    print('    在 /ql/data/scripts/performance-tool 目录执行：')
    print('      npm run setup:a8')
    print('  若安装时报 “from versions: none”，是容器出站过滤了 /simple 索引页，与镜像无关；')
    print('  setup 内有从 files.pythonhosted.org 直接下 wheel 的离线兜底，可一并尝试。')