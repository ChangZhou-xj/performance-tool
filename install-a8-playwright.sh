#!/usr/bin/env sh
set -eu

# install-a8-playwright.sh
# 青龙面板一次性初始化：为 A8 工时填报安装 Python Playwright 及 Chromium。
# 与 ql-task-a8-fill.sh 保持一致，使用环境变量 A8_WORK_PYTHON（默认 python3）所指向的解释器。

PY="${A8_WORK_PYTHON:-python3}"

echo ">>> 使用 Python 解释器: ${PY}"
"$PY" --version || { echo "[ERROR] 找不到 Python 命令 ${PY}，请确认或设置 A8_WORK_PYTHON" >&2; exit 1; }

echo ">>> 安装 playwright（pip）"
if ! "$PY" -m pip --version >/dev/null 2>&1; then
	echo "[ERROR] ${PY} 无 pip，请先安装 pip（如 via apt/apk 或用 ensurepip）" >&2
	exit 1
fi
"$PY" -m pip install --upgrade playwright

echo ">>> 安装 Chromium 浏览器"
"$PY" -m playwright install chromium

echo ">>> 安装浏览器系统依赖（青龙容器内需要；失败可在宿主机自行安装对应依赖库）"
if "$PY" -m playwright install-deps chromium; then
	echo ">>> 系统依赖安装完成"
else
	echo "[WARN] install-deps 失败：若 Chromium 无法启动，请按报错在青龙容器/宿主机安装对应系统库" >&2
fi

echo ">>> 自检：导入 playwright"
"$PY" -c "from playwright.sync_api import sync_playwright; print('playwright 已就绪 OK')"

echo ">>> 初始化完成，可直接在青龙任务中运行 npm run ql:a8-fill 或 npm run fill:a8-hours"