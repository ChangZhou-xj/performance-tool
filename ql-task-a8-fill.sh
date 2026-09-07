#!/usr/bin/env sh
set -u

ORIGINAL_PWD="$(pwd)"
SCRIPT_PATH="$0"

is_project_dir() {
	dir="${1:-}"
	[ -n "$dir" ] || return 1
	[ -f "$dir/package.json" ] && [ -f "$dir/scripts/fill-a8-work-hours.js" ]
}

resolve_dirname() {
	target_path="$1"
	if resolved_dir="$(cd "$(dirname "$target_path")" 2>/dev/null && pwd)"; then
		printf '%s\n' "$resolved_dir"
		return 0
	fi
	dirname "$target_path"
}

find_upwards() {
	dir="${1:-}"
	[ -n "$dir" ] || return 1

	while [ -n "$dir" ]; do
		if is_project_dir "$dir"; then
			printf '%s\n' "$dir"
			return 0
		fi

		parent_dir="$(dirname "$dir")"
		if [ "$parent_dir" = "$dir" ]; then
			break
		fi
		dir="$parent_dir"
	done

	return 1
}

find_in_common_roots() {
	for base_dir in \
		"${QL_TASK_PROJECT_DIR:-}" \
		"${PROJECT_DIR:-}" \
		"/ql/data/scripts" \
		"/ql/scripts" \
		"/ql/data/repo" \
		"/ql/repo"
	do
		[ -n "$base_dir" ] || continue
		[ -d "$base_dir" ] || continue

		if is_project_dir "$base_dir"; then
			printf '%s\n' "$base_dir"
			return 0
		fi

		found_dir="$({
			find "$base_dir" -maxdepth 4 -type f -name package.json 2>/dev/null || true
		} | while IFS= read -r package_file; do
			candidate_dir="$(dirname "$package_file")"
			if [ -f "$candidate_dir/scripts/fill-a8-work-hours.js" ] && [ -f "$candidate_dir/ql-task-a8-fill.sh" ]; then
				printf '%s\n' "$candidate_dir"
				break
			fi
		done | head -n 1)"

		if [ -n "$found_dir" ]; then
			printf '%s\n' "$found_dir"
			return 0
		fi
	done

	return 1
}

SCRIPT_DIR="$(resolve_dirname "$SCRIPT_PATH")"
PROJECT_ROOT="${QL_TASK_PROJECT_DIR:-}"

if ! is_project_dir "$PROJECT_ROOT"; then
	PROJECT_ROOT="$(find_upwards "$ORIGINAL_PWD" 2>/dev/null || true)"
fi

if ! is_project_dir "$PROJECT_ROOT"; then
	PROJECT_ROOT="$(find_upwards "$SCRIPT_DIR" 2>/dev/null || true)"
fi

if ! is_project_dir "$PROJECT_ROOT"; then
	PROJECT_ROOT="$(find_in_common_roots 2>/dev/null || true)"
fi

if ! is_project_dir "$PROJECT_ROOT"; then
	echo "[ERROR] 未找到项目根目录，请设置环境变量 QL_TASK_PROJECT_DIR 指向仓库根目录" >&2
	echo "[ERROR] 当前脚本路径: $SCRIPT_PATH" >&2
	echo "[ERROR] 当前工作目录: $ORIGINAL_PWD" >&2
	exit 1
fi

LOG_DIR="$PROJECT_ROOT/data"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ql-task-a8-fill-$(date +%Y%m%d_%H%M%S).log"

write_log_line() {
	line="$1"
	printf '%s\n' "$line"
	printf '%s\n' "$line" >> "$LOG_FILE"
}

ts() {
	date '+%Y-%m-%d %H:%M:%S'
}

log_info() {
	write_log_line "[$(ts)] [INFO] $*"
}

log_warn() {
	write_log_line "[$(ts)] [WARN] $*"
}

log_error() {
	write_log_line "[$(ts)] [ERROR] $*"
}

log_cmd_output() {
	write_log_line "$*"
}

run_step() {
	desc="$1"
	shift
	tmp_file="${TMPDIR:-/tmp}/ql-task-a8-fill.$$.$(date +%s).log"

	log_info "$desc"
	# 退出码必须在命令执行后立即捕获：若写在 `if ... fi`（无 else）之后，
	# POSIX 规定 if 语句的退出状态为 0，会丢失命令真实的非零退出码，
	# 导致失败被误报为成功、Server酱 通知误发"执行成功"。
	"$@" > "$tmp_file" 2>&1
	status="$?"

	while IFS= read -r line || [ -n "$line" ]; do
		log_cmd_output "$line"
	done < "$tmp_file"
	rm -f "$tmp_file"

	if [ "$status" -ne 0 ]; then
		log_error "命令执行失败，立即停止，退出码: ${status}"
		return "$status"
	fi
	return 0
}

send_notification() {
	exit_code="$1"
	status_override="${2:-}"
	status_text="${status_override:-成功}"
	if [ "$exit_code" -ne 0 ]; then
		status_text="失败(${exit_code})"
	fi

	log_info "准备发送 Server酱 通知: ${status_text}"
	if [ ! -f "$PROJECT_ROOT/send-serverchan.js" ]; then
		log_warn "未找到通知脚本: $PROJECT_ROOT/send-serverchan.js"
		return 0
	fi

	SERVERCHAN_TITLE_PREFIX='A8工时填报' node "$PROJECT_ROOT/send-serverchan.js" "$status_text" "$LOG_FILE" || log_warn "Server酱通知发送失败，已忽略"
}

main() {
	log_info "ql-task-a8-fill 启动"
	log_info "脚本路径: $SCRIPT_PATH"
	log_info "脚本目录: $SCRIPT_DIR"
	log_info "启动目录: $ORIGINAL_PWD"
	log_info "项目目录: $PROJECT_ROOT"
	log_info "日志文件: $LOG_FILE"

	log_info "检查是否工作日"
	check_tmp_file="${TMPDIR:-/tmp}/ql-task-a8-fill-check.$$.$(date +%s).log"
	if npm --prefix "$PROJECT_ROOT" run check-workday --silent > "$check_tmp_file" 2>&1; then
		while IFS= read -r line || [ -n "$line" ]; do
			log_cmd_output "$line"
		done < "$check_tmp_file"
		rm -f "$check_tmp_file"
	else
		check_status="$?"
		while IFS= read -r line || [ -n "$line" ]; do
			log_cmd_output "$line"
		done < "$check_tmp_file"
		rm -f "$check_tmp_file"

		if [ "$check_status" -eq 2 ]; then
			SKIP_REASON="非工作日"
			log_info "今天不是工作日，跳过 A8 工时填报"
			return 0
		fi

		log_error "工作日检查失败，立即停止，退出码: ${check_status}"
		return "$check_status"
	fi

	# 由包装脚本统一发送通知，进入前关闭填报脚本自身的内置通知，避免重复推送
	run_step "执行 A8 工时填报" env A8_NO_NOTIFY=1 npm --prefix "$PROJECT_ROOT" run fill:a8-hours || return "$?"
	return 0
}

SKIP_REASON=""
main
EXIT_CODE="$?"
SKIP_STATUS_TEXT=""
if [ -n "$SKIP_REASON" ] && [ "$EXIT_CODE" -eq 0 ]; then
	SKIP_STATUS_TEXT="跳过(${SKIP_REASON})"
fi
send_notification "$EXIT_CODE" "$SKIP_STATUS_TEXT"

# 诊断标记：此行出现即说明 shell 已走到最后一步、即将退出。
# 若青龙任务仍不停止但能看到下面这行，说明是退出后有子进程/孤儿残留（而非脚本本身卡住）。
log_info "ql-task-a8-fill 全部步骤完成，退出码 ${EXIT_CODE}"
if command -v ps >/dev/null 2>&1; then
	# 只检查由本任务产生的 node/python 子进程；过滤两类必然存在的误报：
	#   1. ql-task-a8-fill.sh 自身的 bash 进程（脚本在 ps 时还活着，不是孤儿）
	#   2. /ql/static/build/app.js（青龙面板 web 服务，容器启动后常驻）
	# 若真有本任务的 node/python 孤儿，仍会被列出。
	orphan_lines="$(ps -ef 2>/dev/null \
		| grep -E 'node |python' \
		| grep -v grep \
		| grep -v '/ql/static/' || true)"
	if [ -n "$orphan_lines" ]; then
		log_info "发现疑似残留进程（非青龙服务、非本脚本）:"
		printf '%s\n' "$orphan_lines" | while IFS= read -r _line; do
			[ -n "$_line" ] && log_cmd_output "  $_line"
		done
	else
		log_info "未发现异常残留进程"
	fi
fi

exit "$EXIT_CODE"