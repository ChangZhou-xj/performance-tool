#!/usr/bin/env sh
set -u

# 青龙（/ql/shell/otask.sh 的 main）对 .sh 任务是「source」方式执行的：
#   which_program="."  ->  . task_performance-tool/ql-task-project.sh
# 即本脚本实际跑在 task.sh 这个 shell 进程里。脚本末尾只要 `exit`，整个 task.sh
# 会立刻终止，它最后两步 run_task_after / handle_task_end 就永远执行不到——而
# handle_task_end 才负责把「完成 + 耗时」上报面板（/open/crons/status，status=1）
# 并把本次运行实例标记为结束。表现为：任务 20 多秒就跑完了，面板却一直显示
# 「运行中」，且每天多一条永不结束的运行实例。
# 所以先判断是否被 source：被 source 时结尾用 return 交还控制权。
if ( return 0 2>/dev/null ); then
	QL_TASK_SOURCED=1
else
	QL_TASK_SOURCED=0
fi

ORIGINAL_PWD="$(pwd)"
SCRIPT_PATH="$0"

is_project_dir() {
	dir="${1:-}"
	[ -n "$dir" ] || return 1
	[ -f "$dir/package.json" ] && [ -f "$dir/generate-project-email.js" ]
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
			if [ -f "$candidate_dir/generate-project-email.js" ] && [ -f "$candidate_dir/ql-task-project.sh" ]; then
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
	set +u
	if [ "$QL_TASK_SOURCED" = "1" ]; then
		return 1
	fi
	exit 1
fi

LOG_DIR="$PROJECT_ROOT/data"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ql-task-project-$(date +%Y%m%d_%H%M%S).log"

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
	tmp_file="${TMPDIR:-/tmp}/ql-task-project.$$.$(date +%s).log"

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

	node "$PROJECT_ROOT/send-serverchan.js" "$status_text" "$LOG_FILE" || log_warn "Server酱通知发送失败，已忽略"
}

main() {
	log_info "ql-task-project 启动"
	log_info "脚本路径: $SCRIPT_PATH"
	log_info "脚本目录: $SCRIPT_DIR"
	log_info "启动目录: $ORIGINAL_PWD"
	log_info "项目目录: $PROJECT_ROOT"
	log_info "日志文件: $LOG_FILE"

	log_info "检查是否工作日"
	check_tmp_file="${TMPDIR:-/tmp}/ql-task-project-check.$$.$(date +%s).log"
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
			log_info "今天不是工作日，跳过项目问题汇报生成与邮件发送"
			return 0
		fi

		log_error "工作日检查失败，立即停止，退出码: ${check_status}"
		return "$check_status"
	fi

	run_step "下载工作记录" npm --prefix "$PROJECT_ROOT" run download-work-record || return "$?"
	run_step "生成项目问题汇报" node "$PROJECT_ROOT/generate-project-email.js" || return "$?"
	run_step "发送项目问题汇报邮件" node "$PROJECT_ROOT/generate-project-email.js" --send || return "$?"
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

# 被青龙 source 时必须 return，把控制权交还 task.sh，让它执行 handle_task_end
# 上报「完成」；直接执行（sh ql-task-project.sh）时仍用 exit 返回退出码。
# 同时 set +u：脚本开头的 set -u 会残留在调用方 shell 里，令 task.sh 的收尾
# 逻辑（share.sh handle_task_end / api.sh）因未定义变量报错，同样收不到完成状态。
set +u
if [ "$QL_TASK_SOURCED" = "1" ]; then
	return "$EXIT_CODE"
fi
exit "$EXIT_CODE"
