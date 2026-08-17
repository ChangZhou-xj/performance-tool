#!/usr/bin/env sh
set -eu

# install-a8-playwright.sh
# 青龙面板一次性初始化：为 A8 工时填报安装 Python Playwright 及 Chromium。
# - 与 ql-task-a8-fill.sh 一致，使用 A8_WORK_PYTHON（默认 python3）指向的解释器。
# - pip 源：依次尝试 A8_PIP_INDEX（若设置）、阿里云、清华、腾讯云、华为云、官方 pypi，
#   取第一个能装到 playwright 的源；并用 --no-cache-dir 规避陈旧索引缓存导致的 “from versions: none”
#   （青龙默认常是阿里云镜像，若返回空版本，多半是该镜像缓存未同步 playwright，需换源）。

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
	"$PY" -m pip install --upgrade playwright --no-cache-dir "$@"
	status=$?
	set -e
	return "$status"
}

echo ">>> 清理 pip 缓存（规避陈旧索引缓存导致的 from versions: none 报错）"
"$PY" -m pip cache purge 2>/dev/null || true

# 候选源：A8_PIP_INDEX（若设置）置顶，其余按国内常用镜像排序，最后官方 pypi
CANDIDATES=""
for ix in \
	"${A8_PIP_INDEX:-}" \
	"https://mirrors.aliyun.com/pypi/simple" \
	"https://pypi.tuna.tsinghua.edu.cn/simple" \
	"https://mirrors.cloud.tencent.com/pypi/simple" \
	"https://repo.huaweicloud.com/repository/pypi/simple" \
	"https://pypi.org/simple"
do
	[ -n "$ix" ] || continue
	case "|${CANDIDATES}|" in
		*"|${ix}|"*) ;;
		*) CANDIDATES="${CANDIDATES}${CANDIDATES:+|}|${ix}" ;;
	esac
done

echo ">>> 依次尝试 pip 源安装 playwright："
installed=0
for ix in $(printf '%s' "$CANDIDATES" | tr '|' '\n'); do
	[ -n "$ix" ] || continue
	echo "  [尝试] $ix"
	if do_pip_install -i "$ix"; then
		echo ">>> playwright 已通过 $ix 安装成功"
		installed=1
		break
	fi
	echo "  [失败] $ix"
done

if [ "$installed" -ne 1 ]; then
	echo "[ERROR] playwright 在所有候选源均未能安装。" >&2
	echo "[ERROR] 提示：若 pip 能刷到自身升级但找不到 playwright，多半是容器架构不被支持，而非镜像问题。" >&2
	echo "[INFO] 平台信息（供排查）：" >&2
	{
		uname -m 2>/dev/null
		"$PY" -c "import sysconfig; print('sysconfig:', sysconfig.get_platform())" 2>/dev/null || true
		"$PY" -m pip debug --verbose 2>/dev/null | sed -n -e '/^Compatible tags/p'
	} >&2 || true
	echo "[HINT] playwright 仅支持 x86_64 / arm64 等平台；若此处显示 armv7/i686 等，则无法在容器内安装，需改用支持平台或换 requests 方案。" >&2
	exit 1
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