#!/usr/bin/env sh
set -eu

# install-a8-playwright.sh
# 青龙面板一次性初始化：为 A8 工时填报安装 Python Playwright 及 Chromium。
# - 与 ql-task-a8-fill.sh 一致，使用 A8_WORK_PYTHON（默认 python3）指向的解释器。
# - pip 源：默认用系统 pip 配置；可通过环境变量 A8_PIP_INDEX 指定 PyPI 镜像。
#   （国内环境默认源常因网络/"from versions: none" 失败，可设
#    A8_PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple）
# - 未显式指定 A8_PIP_INDEX 时，默认源安装失败会自动回退清华镜像。

PY="${A8_WORK_PYTHON:-python3}"

echo ">>> 使用 Python 解释器: ${PY}"
if ! "$PY" --version 2>/dev/null; then
	echo "[ERROR] 找不到 Python 命令 ${PY}，请确认或设置 A8_WORK_PYTHON" >&2
	exit 1
fi

echo ">>> 检查 pip"
if ! "$PY" -m pip --version >/dev/null 2>&1; then
	echo "[ERROR] ${PY} 无 pip，请先安装 pip" >&2
	exit 1
fi

echo ">>> 当前 pip 索引配置（供排查）："
"$PY" -m pip config list 2>/dev/null || true

# 显式关闭 errexit 以按返回值判断安装是否成功，避免 set -e 在 if 条件中吞掉退出码
do_pip_install() {
	set +e
	"$PY" -m pip install --upgrade playwright "$@"
	status=$?
	set -e
	return "$status"
}

if do_pip_install ${A8_PIP_INDEX:+-i "$A8_PIP_INDEX"}; then
	echo ">>> playwright 安装成功"
else
	if [ -z "${A8_PIP_INDEX:-}" ] && do_pip_install -i "https://pypi.tuna.tsinghua.edu.cn/simple"; then
		echo ">>> 默认源安装失败，已通过清华大学 PyPI 镜像安装成功（可设 A8_PIP_INDEX 固定该镜像）"
	else
		echo "[ERROR] playwright 安装失败。" >&2
		echo "[ERROR] 请在青龙环境变量设置 A8_PIP_INDEX=<可用 PyPI 镜像地址> 后重试，或排查容器网络。" >&2
		exit 1
	fi
fi

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