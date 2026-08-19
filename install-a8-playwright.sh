#!/usr/bin/env sh
set -eu

# install-a8-playwright.sh
# 青龙面板一次性初始化：为 A8 工时填报安装 Python Playwright 及 Chromium。
# - 与 ql-task-a8-fill.sh 一致，使用 A8_WORK_PYTHON（默认 python3）指向的解释器。
# - pip 源：依次尝试 A8_PIP_INDEX（若设置）、阿里云、清华、腾讯云、华为云、官方 pypi，
#   取第一个能装到 playwright 的源；并用 --no-cache-dir 规避陈旧索引缓存导致的 “from versions: none”
#   （青龙默认常是阿里云镜像，若返回空版本，多半是该镜像缓存未同步 playwright，需换源）。
# - 系统依赖：根据容器发行版（apt 或 apk）显式安装 Chromium 所需系统库，安装后必须验证浏览器
#   能正常启动；若验证失败则脚本以非零退出码终止，避免“装完却跑不起来”的误导。

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

# ---------------------------------------------------------------------------
# 安装浏览器系统依赖（青龙容器内常见失败点，必须显式处理并提供降级方案）
# ---------------------------------------------------------------------------
install_apt_deps() {
	# Debian / Ubuntu 系列：apt-get 可安装时直接安装 Chromium 所需系统库
	if command -v apt-get >/dev/null 2>&1; then
		echo ">>> 检测到 apt-get，尝试安装 Chromium 系统依赖包"
		apt-get update -qq >/dev/null 2>&1 || true
		apt-get install -y --no-install-recommends \
			libglib2.0-0 \
			libnss3 \
			libatk1.0-0 \
			libatk-bridge2.0-0 \
			libcups2 \
			libdrm2 \
			libxkbcommon0 \
			libxcomposite1 \
			libxdamage1 \
			libxfixes3 \
			libxrandr2 \
			libgbm1 \
			libpango-1.0-0 \
			libcairo2 \
			libasound2 \
			fonts-liberation \
			libappindicator3-1 \
			libcurl3-gnutls \
		>/dev/null 2>&1 || return 1
		return 0
	fi
	return 1
}

install_apk_deps() {
	# Alpine 系列：Playwright 官方 Linux 浏览器为 glibc 构建，musl 环境通常无法直接运行。
	# 安装系统 chromium 包，并引导使用 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH。
	if command -v apk >/dev/null 2>&1; then
		echo ">>> 检测到 apk（Alpine 系），安装系统 chromium 包"
		apk add --no-cache \
			chromium \
			chromium-chromedriver \
			nss \
			freetype \
			harfbuzz \
			ca-certificates \
			ttf-freefont \
		>/dev/null 2>&1 || return 1
		return 0
	fi
	return 1
}

echo ">>> 安装浏览器系统依赖"
deps_ok=0

# 1) 优先使用 Playwright 自带的 install-deps（最完整，但某些精简容器无 apt 权限会失败）
set +e
if "$PY" -m playwright install-deps chromium >/dev/null 2>&1; then
	set -e
	echo ">>> playwright install-deps 成功"
	deps_ok=1
else
	set -e
	echo "[WARN] playwright install-deps 失败，将按发行版手动安装系统依赖..." >&2
fi

# 2) install-deps 失败时，按包管理器显式安装最小依赖集合
if [ "$deps_ok" -ne 1 ]; then
	if install_apt_deps; then
		deps_ok=1
	elif install_apk_deps; then
		deps_ok=1
	else
		echo "[WARN] 未找到可识别的包管理器（apt-get/apk），无法自动安装系统依赖" >&2
	fi
fi

# 3) 校验浏览器能否真正启动。这是防止“依赖安装提示成功但运行时缺库”的最后一道防线。
echo ">>> 校验 Chromium 能否正常启动"
verify_script="${TMPDIR:-/tmp}/a8-pw-verify-$$.py"
cat > "$verify_script" <<'PYEOF'
import sys
from playwright.sync_api import sync_playwright

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        browser.close()
        print('BROWSER_OK')
        sys.exit(0)
except Exception as e:
    print(f'BROWSER_FAIL: {e}')
    sys.exit(1)
PYEOF

verify_status=1
browser_ok=0
set +e
verify_output=$("$PY" "$verify_script" 2>&1)
verify_status=$?
set -e
rm -f "$verify_script"

if [ "$verify_status" -eq 0 ] && printf '%s' "$verify_output" | grep -q 'BROWSER_OK'; then
	browser_ok=1
fi

if [ "$browser_ok" -eq 1 ]; then
	echo ">>> Chromium 启动验证通过"
else
	echo "[ERROR] Chromium 无法启动，错误信息：" >&2
	printf '%s\n' "$verify_output" >&2 || true

	# Alpine 特殊提示：系统 chromium 路径需通过环境变量显式指定
	if command -v apk >/dev/null 2>&1 && [ -x /usr/bin/chromium-browser ]; then
		echo "[HINT] 当前为 Alpine 容器，Playwright 自带 Chromium 可能不兼容 musl。" >&2
		echo "[HINT] 请在使用前执行：export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser" >&2
		echo "[HINT] 或在 .env 文件中加入：PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser" >&2
	fi

	# 通用手动安装提示
	echo "[HINT] 若容器无权限自动安装依赖，可在宿主机/容器内手动执行对应命令后重试：" >&2
	if command -v apt-get >/dev/null 2>&1; then
		echo "    apt-get update && apt-get install -y libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2" >&2
	elif command -v apk >/dev/null 2>&1; then
		echo "    apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont" >&2
	fi
	exit 1
fi

echo ">>> 自检：导入 playwright"
"$PY" -c "from playwright.sync_api import sync_playwright; print('playwright 已就绪 OK')"

echo ">>> 初始化完成，可直接在青龙任务中运行 npm run ql:a8-fill 或 npm run fill:a8-hours"
