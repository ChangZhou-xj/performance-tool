#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="$SCRIPT_DIR/data"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ql-task-$(date +%Y%m%d_%H%M%S).log"

exec > >(tee -a "$LOG_FILE") 2>&1

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

npm run report:day
npm run send-email
