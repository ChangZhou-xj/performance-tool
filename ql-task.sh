#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="$SCRIPT_DIR/data"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ql-task-$(date +%Y%m%d_%H%M%S).log"

exec > >(tee -a "$LOG_FILE") 2>&1

on_err() {
	local exit_code=$?
	echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] 命令执行失败，立即停止，退出码: ${exit_code}" >&2
	return "$exit_code"
}

run_step() {
	local desc="$1"
	shift
	echo "[$(date '+%Y-%m-%d %H:%M:%S')] [INFO] $desc"
	"$@"
}

notify() {
	local exit_code=$?
	local status="成功"
	if [ "$exit_code" -ne 0 ]; then
		status="失败(${exit_code})"
	fi
	node "$SCRIPT_DIR/send-serverchan.js" "$status" "$LOG_FILE" || true
	exit "$exit_code"
}

trap notify EXIT
trap on_err ERR

run_step "执行日报生成" npm run report:day
run_step "执行日报邮件发送" npm run send-email
