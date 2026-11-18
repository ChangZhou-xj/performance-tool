#!/usr/bin/env sh
# 模拟青龙 /ql/shell/task.sh + otask.sh 对被 source 的 .sh 任务的处理顺序：
#
#   handle_task_start  ->  . 用户脚本  ->  run_task_after  ->  handle_task_end
#
# 关键点与青龙一致：用户脚本是用 `.`（source）在当前 shell 里执行的，
# 而不是另起子进程。因此脚本内部一旦 `exit`，本 wrapper 后续的
# handle_task_end 就永远执行不到——那正是面板一直显示「运行中」的原因。
#
# 用法: wrapper.sh <fixture 目录> <脚本名>
# 输出标记（供 run.sh 断言）：
#   [task.sh] handle_task_start
#   [task.sh] script rc=<退出码>
#   [task.sh] shell-nounset=<on|off>
#   [task.sh] handle_task_end
set -u

fixture_dir="$1"
script_name="$2"

cd "$fixture_dir" || exit 1

echo "[task.sh] handle_task_start"

. "./$script_name"
script_rc=$?

case "$-" in
*u*) nounset_state="on" ;;
*) nounset_state="off" ;;
esac

echo "[task.sh] script rc=$script_rc"
echo "[task.sh] shell-nounset=$nounset_state"
# 真实 task.sh 到这里会调 update_cron（/open/crons/status）上报完成与耗时
echo "[task.sh] handle_task_end"
