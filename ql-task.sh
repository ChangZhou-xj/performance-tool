#!/usr/bin/env sh
set -u

SCRIPT_DIR="$(dirname -- "$0")"
SCRIPT_DIR="$(cd -- "$SCRIPT_DIR" || exit 1; pwd)"
cd "$SCRIPT_DIR" || exit 1

LOG_DIR="$SCRIPT_DIR/data"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ql-task-$(date +%Y%m%d_%H%M%S).log"
NOTIFY_DONE="false"

ts() {
	date '+%Y-%m-%d %H:%M:%S'
}

write_log_line() {
	line="$1"
	printf '%s\n' "$line"
	printf '%s\n' "$line" >> "$LOG_FILE"
}

log_info() {
	write_log_line "[$(ts)] [INFO] $*"
}

log_warn() {
	write_log_line "[$(ts)] [WARN] $*"
}

run_cmd() {
	desc="$1"
	shift
	tmp_file="${TMPDIR:-$LOG_DIR}/ql-task.$$.$(date +%s).tmp"

	log_info "$desc"
	if "$@" > "$tmp_file" 2>&1; then
		status=0
	else
		status=$?
	fi

	while IFS= read -r line || [ -n "$line" ]; do
		write_log_line "$line"
	done < "$tmp_file"
	rm -f "$tmp_file"

	return "$status"
}

notify() {
	exit_code=$?
	status="成功"

	if [ "$NOTIFY_DONE" = "true" ]; then
		exit "$exit_code"
	fi
	NOTIFY_DONE="true"
	trap - EXIT INT TERM

	if [ "$exit_code" -ne 0 ]; then
		status="失败(${exit_code})"
		log_warn "任务执行失败，准备发送结束通知"
	else
		log_info "任务执行成功，准备发送结束通知"
	fi

	if ! run_cmd "执行 Server酱通知" node "$SCRIPT_DIR/send-serverchan.js" "$status" "$LOG_FILE"; then
		log_warn "Server酱通知执行失败，但不影响主任务退出码"
	fi

	exit "$exit_code"
}

trap 'notify' EXIT INT TERM

log_info "ql-task 启动"
log_info "script dir: $SCRIPT_DIR"
log_info "log file: $LOG_FILE"

run_cmd "执行日报生成" npm run report:day || exit $?
run_cmd "执行日报邮件发送" npm run send-email || exit $?
