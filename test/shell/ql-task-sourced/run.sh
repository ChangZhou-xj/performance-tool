#!/usr/bin/env sh
# 回归测试：青龙任务脚本必须能「交还控制权」，否则面板永远显示「运行中」
#
# 背景：青龙 2.21 的 /ql/shell/otask.sh 对 .sh 任务使用 source 执行
# （which_program="."），任务脚本跑在 task.sh 自己的 shell 里。脚本若以 `exit`
# 结束，task.sh 会立刻终止，其后的 handle_task_end（上报 /open/crons/status
# status=1、写耗时、结束运行实例）永远执行不到 —— 表现为任务其实跑完了，
# 面板却永久「运行中」，且每次运行多一条永不结束的实例记录。
#
# 本测试用桩环境复刻青龙的执行顺序，断言三件事：
#   1. 被 source 后，wrapper 的 handle_task_end 能被执行到；
#   2. 脚本退出码正确透传（失败时面板才能显示「失败」）；
#   3. 脚本的 set -u 不能残留到调用方 shell（否则 handle_task_end 报 unbound variable）；
# 另外用「故意写 exit 的脚本」做反向对照，确保本测试真的能抓到这类回归。
#
# 全部在临时目录里跑，npm/node 都是桩，不联网、不读写仓库 data/。
# 用法: sh test/shell/ql-task-sourced/run.sh   （或 npm run test:ql-task）
set -u

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

# 桩要能被 PATH 直接执行：复制到临时目录并 chmod +x。
# 不直接依赖仓库里的可执行位——git 在 Windows 上不记录 file mode（core.fileMode=false），
# 若直接用仓库里的文件，Linux 上会因缺少 +x 而报 permission denied。
stub_bin="$tmp/bin"
mkdir -p "$stub_bin"
for stub in npm node; do
	cp "$here/lib/bin/$stub" "$stub_bin/$stub"
	chmod +x "$stub_bin/$stub"
done
PATH="$stub_bin:$PATH"
export PATH

pass=0
fail=0

ok() {
	pass=$((pass + 1))
	printf '  \033[32m✓\033[0m %s\n' "$1"
}

ng() {
	fail=$((fail + 1))
	printf '  \033[31m✗\033[0m %s\n' "$1"
}

has() {
	case "$1" in
	*"$2"*) return 0 ;;
	*) return 1 ;;
	esac
}

# 造一个「像本仓库」的 fixture：脚本靠 package.json + 各任务的特征文件定位项目根目录
make_fixture() {
	dir="$1"
	mkdir -p "$dir/data" "$dir/scripts"
	printf '{"name":"fixture","private":true}\n' >"$dir/package.json"
	: >"$dir/send-serverchan.js"
	: >"$dir/scripts/fill-a8-work-hours.js"
	: >"$dir/generate-project-email.js"
}

# 与青龙一致：.sh 任务由 bash 执行 task.sh，task.sh 再 source 用户脚本
run_sourced() {
	bash "$here/lib/wrapper.sh" "$1" "$2" 2>&1
}

# ---------- 0. 语法检查 ----------
printf '\n== 语法检查 ==\n'
for name in ql-task.sh ql-task-a8-fill.sh ql-task-project.sh; do
	if [ ! -f "$repo/$name" ]; then
		ng "$name 不存在（脚本被移动或改名？）"
		continue
	fi
	if bash -n "$repo/$name" 2>/dev/null; then
		ok "$name bash -n"
	else
		ng "$name bash -n 语法错误"
	fi
	if command -v dash >/dev/null 2>&1; then
		if dash -n "$repo/$name" 2>/dev/null; then
			ok "$name dash -n"
		else
			ng "$name dash -n 语法错误"
		fi
	fi
done

# ---------- 1/2. 三个脚本：source 执行 + 直接执行 ----------
for spec in "ql-task.sh:0" "ql-task-a8-fill.sh:0" "ql-task-project.sh:0"; do
	name="${spec%%:*}"
	expect_rc="${spec##*:}"
	fixture="$tmp/${name%.sh}"
	make_fixture "$fixture"
	cp "$repo/$name" "$fixture/$name"

	printf '\n== %s ==\n' "$name"

	# 1) 青龙真实执行方式：source
	out="$(run_sourced "$fixture" "$name")"
	if has "$out" "[task.sh] handle_task_end"; then
		ok "source 执行后 handle_task_end 执行到（面板能收到「完成」）"
	else
		ng "source 执行后 handle_task_end 没有执行到 —— 面板会一直显示「运行中」"
	fi
	if has "$out" "[task.sh] script rc=$expect_rc"; then
		ok "source 执行退出码透传为 $expect_rc"
	else
		ng "source 执行退出码不是预期的 $expect_rc"
	fi
	if has "$out" "[task.sh] shell-nounset=off"; then
		ok "set -u 未残留到调用方 shell"
	else
		ng "set -u 残留到调用方 shell，handle_task_end 可能报 unbound variable"
	fi

	# 2) 直接执行（本地 sh / npm 包装脚本的方式）：仍应正常 exit
	for sh_bin in bash dash; do
		command -v "$sh_bin" >/dev/null 2>&1 || continue
		out="$(cd "$fixture" && "$sh_bin" "./$name" 2>&1)"
		rc=$?
		if has "$out" "return: can only"; then
			ng "$sh_bin 直接执行报 return 错误（非 source 时不该走 return 分支）"
		elif [ "$rc" -ne "$expect_rc" ]; then
			ng "$sh_bin 直接执行退出码=$rc（预期 $expect_rc）"
		else
			ok "$sh_bin 直接执行退出码 $rc"
		fi
	done
done

# ---------- 3. 失败路径：中间步骤失败要能透传给面板 ----------
printf '\n== 失败路径（ql-task.sh，npm report:day 返回 3）==\n'
export STUB_NPM_FAIL='report:day'
out="$(run_sourced "$tmp/ql-task" ql-task.sh)"
unset STUB_NPM_FAIL
if has "$out" "[task.sh] handle_task_end"; then
	ok "失败时仍执行到 handle_task_end（面板能显示「失败」而不是卡住）"
else
	ng "失败时没执行到 handle_task_end"
fi
if has "$out" "[task.sh] script rc=3"; then
	ok "失败退出码 3 透传"
else
	ng "失败退出码没有透传"
fi

# ---------- 4. 反向对照：故意用 exit 结尾的脚本必须被本测试抓到 ----------
printf '\n== 反向对照（故意 exit 的脚本应判定为异常）==\n'
legacy_fixture="$tmp/legacy"
make_fixture "$legacy_fixture"
cat >"$legacy_fixture/legacy-exit.sh" <<'EOF'
#!/usr/bin/env sh
set -u
echo "[legacy] 干完活"
exit 0
EOF
out="$(bash "$here/lib/wrapper.sh" "$legacy_fixture" "legacy-exit.sh" 2>&1)"
if has "$out" "[task.sh] handle_task_end"; then
	ng "反向对照失效：用 exit 的脚本竟然也执行到了 handle_task_end，本测试无法发现回归"
else
	ok "反向对照有效：用 exit 的脚本确实丢掉了 handle_task_end"
fi

# ---------- 汇总 ----------
printf '\n===== 结果：%d 通过 / %d 失败 =====\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then
	printf '青龙任务脚本可能又退回「面板一直运行中」的写法，请检查脚本结尾是 return 还是 exit。\n'
	exit 1
fi
printf '全部通过：三个青龙任务脚本都能把控制权交还 task.sh。\n'
exit 0
