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

# 常规 pip 源全部失败（典型为容器对该索引的 /simple 页面做了过滤/返回空页）时，
# 尝试直接从 files.pythonhosted.org 下载 wheel 离线安装，绕过被过滤的索引页面。
# 以下 URL 为针对 python3.11 / linux x86_64 固定版本的 wheel（playwright 1.62.0 及其依赖）。
if [ "$installed" -ne 1 ]; then
	echo ">>> 常规源均失败，改从 files.pythonhosted.org 直接下载 wheel 离线安装 ..."
	dl() {
		_url="$1"; _outdir="$2"
		_frag="${_url%%#*}"
		_fn="$(basename "$_frag")"
		if command -v curl >/dev/null 2>&1; then
			curl -fsSL -m 180 -o "$_outdir/$_fn" "$_url"
		elif command -v wget >/dev/null 2>&1; then
			wget -q -T 180 -O "$_outdir/$_fn" "$_url"
		else
			return 1
		fi
	}
	WHEELS="
https://files.pythonhosted.org/packages/43/6b/b24aebc2b04bffcb342bccf96e287c78b363e1615bed5cea97500cc0393a/playwright-1.62.0-py3-none-manylinux1_x86_64.whl
https://files.pythonhosted.org/packages/4c/ac/e731ed62576e91e533b36d0d97325adc2786674ab9e48ed8a6a24f4ef4e9/greenlet-3.2.5-cp311-cp311-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
https://files.pythonhosted.org/packages/81/12/5347938b1f9a6453f0dbdfcc3e2388a1320ef9b9ec17fbefbc4ab647ea98/pyee-14.0.0-py3-none-any.whl
https://files.pythonhosted.org/packages/49/d3/b8441a820a491ddfc024b0b0cf0393375b75ea13866d9c66727e54c2fc80/typing_extensions-4.16.0-py3-none-any.whl
"
	offline_dir="${TMPDIR:-/tmp}/a8-pw-wheels"
	mkdir -p "$offline_dir"
	[ "$(command -v curl || command -v wget)" ] || echo "[WARN] 容器无 curl/wget，离线下载不可用"
	dl_ok=1
	for _u in $WHEELS; do
		[ -n "$_u" ] || continue
		echo "  [下载] $_u"
		if ! dl "$_u" "$offline_dir"; then
			echo "  [失败] 下载失败：$_u" >&2
			dl_ok=0
			break
		fi
	done
	if [ "$dl_ok" -eq 1 ]; then
		echo ">>> 4 个 wheel 下载完成，开始离线安装（playwright 1.62.0）"
		if do_pip_install --no-index --find-links "$offline_dir" greenlet==3.2.5 pyee==14.0.0 typing_extensions==4.16.0; then
			installed=1
			echo ">>> wheel 离线安装成功（playwright 1.62.0）"
		else
			echo "[WARN] 离线安装失败，请检查 wheel 与该 Python/系统是否匹配" >&2
		fi
	fi
fi

if [ "$installed" -ne 1 ]; then
	echo "[ERROR] playwright 在所有方式下均未能安装。" >&2
	echo "[ERROR] 若连 files.pythonhosted.org 也无法下载，说明容器出站被完整阻断，无法在容器内搭建 Playwright。" >&2
	echo "[INFO] 平台信息（供排查）：" >&2
	{
		uname -m 2>/dev/null
		"$PY" -c "import sysconfig; print('sysconfig:', sysconfig.get_platform())" 2>/dev/null || true
		"$PY" -m pip debug --verbose 2>/dev/null | sed -n -e '/^Compatible tags/p'
	} >&2 || true
	echo "[HINT] 若容器出站被阻断，建议改用支持平台的机器执行填报，青龙仅负责调度/通知。" >&2
	exit 1
fi

echo ">>> 安装 Chromium 浏览器"
set +e
"$PY" -m playwright install chromium
pw_status=$?
set -e
if [ "$pw_status" -ne 0 ]; then
	echo "[WARN] Chromium 默认源下载失败，改用国内镜像重试（npmmirror）..." >&2
	PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright/" "$PY" -m playwright install chromium || {
		echo "[ERROR] Chromium 下载失败（默认源与 npmmirror 均不可用），请检查容器出站网络" >&2
		exit 1
	}
fi

echo ">>> 安装浏览器系统依赖（青龙容器内需要；失败可在宿主机自行安装对应依赖库）"
if "$PY" -m playwright install-deps chromium; then
	echo ">>> 系统依赖安装完成"
else
	echo "[WARN] install-deps 失败：若 Chromium 无法启动，请按报错在青龙容器/宿主机安装对应系统库" >&2
fi

echo ">>> 自检：导入 playwright"
"$PY" -c "from playwright.sync_api import sync_playwright; print('playwright 已就绪 OK')"

echo ">>> 初始化完成，可直接在青龙任务中运行 npm run ql:a8-fill 或 npm run fill:a8-hours"