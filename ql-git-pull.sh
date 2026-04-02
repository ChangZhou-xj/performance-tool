#!/usr/bin/env sh
set -eu

# ql-git-pull.sh
# Pull (reset) a branch (default: master) for a target repo or all git repos under a directory.
# Usage:
#   ql-git-pull.sh [REPO_PATH] [BRANCH]
# Examples:
#   ql-git-pull.sh /ql/data/scripts master       # pull master for a git repo or scan subdirs
#   DRY_RUN=true ql-git-pull.sh . master         # dry-run on current repo

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_REPO_PATH="/ql/data/scripts"
DEFAULT_BRANCH="master"
DRY_RUN="${DRY_RUN:-false}"
CMD_TIMEOUT="${CMD_TIMEOUT:-300}"
LOG_DIR="${SCRIPT_DIR}/data"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/ql-git-pull-$(date +%Y%m%d_%H%M%S).log"
RAW_ARGS="$*"
IGNORED_ARGS=""
REPO_PATH=""
BRANCH=""

export GIT_TERMINAL_PROMPT=0
export GIT_PAGER=cat

write_log_line() {
  line="$1"
  printf '%s\n' "$line"
  printf '%s\n' "$line" >> "$LOG_FILE"
}

append_ignored_arg() {
  arg="$1"
  if [ -n "$IGNORED_ARGS" ]; then
    IGNORED_ARGS="${IGNORED_ARGS}, ${arg}"
  else
    IGNORED_ARGS="${arg}"
  fi
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
  write_log_line "[$(ts)] [CMD] $*"
}

run_cmd() {
  desc="$1"
  shift
  tmp_file="${TMPDIR:-/tmp}/ql-git-pull.$$.$(date +%s).log"

  log_info "${desc}"
  if command -v timeout >/dev/null 2>&1; then
    log_info "  -> timeout: ${CMD_TIMEOUT}s"
    if timeout "${CMD_TIMEOUT}" "$@" >"$tmp_file" 2>&1; then
      while IFS= read -r line || [ -n "$line" ]; do
        log_cmd_output "$line"
      done < "$tmp_file"
      rm -f "$tmp_file"
      return 0
    fi

    status="$?"
    while IFS= read -r line || [ -n "$line" ]; do
      log_cmd_output "$line"
    done < "$tmp_file"
    rm -f "$tmp_file"

    if [ "$status" -eq 124 ]; then
      log_error "命令执行超时(${CMD_TIMEOUT}s): ${desc}"
    fi
    return "$status"
  fi

  if "$@" >"$tmp_file" 2>&1; then
    while IFS= read -r line || [ -n "$line" ]; do
      log_cmd_output "$line"
    done < "$tmp_file"
    rm -f "$tmp_file"
    return 0
  fi

  status="$?"
  while IFS= read -r line || [ -n "$line" ]; do
    log_cmd_output "$line"
  done < "$tmp_file"
  rm -f "$tmp_file"
  return "$status"
}

normalize_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      now|*.sh)
        append_ignored_arg "$1"
        shift
        ;;
      *)
        break
        ;;
    esac
  done

  arg1="${1:-}"
  arg2="${2:-}"

  if [ -n "$arg2" ]; then
    REPO_PATH="$arg1"
    BRANCH="$arg2"
    return
  fi

  if [ -n "$arg1" ]; then
    if [ -d "$arg1" ]; then
      REPO_PATH="$arg1"
      BRANCH="$DEFAULT_BRANCH"
      return
    fi

    case "$arg1" in
      /*|./*|../*|*/*)
        REPO_PATH="$arg1"
        BRANCH="$DEFAULT_BRANCH"
        ;;
      *)
        REPO_PATH="$DEFAULT_REPO_PATH"
        BRANCH="$arg1"
        ;;
    esac
    return
  fi

  REPO_PATH="$DEFAULT_REPO_PATH"
  BRANCH="$DEFAULT_BRANCH"
}

on_exit() {
  exit_code="$?"
  if [ "$exit_code" -ne 0 ]; then
    log_error "脚本执行失败，退出码: ${exit_code}"
  fi
}

trap on_exit EXIT

normalize_args "$@"

log_info "ql-git-pull 启动"
log_info "script dir: ${SCRIPT_DIR}"
log_info "raw args: ${RAW_ARGS:-<empty>}"
if [ -n "$IGNORED_ARGS" ]; then
  log_info "ignored ql args: ${IGNORED_ARGS}"
fi
log_info "target path: ${REPO_PATH}"
log_info "branch: ${BRANCH}"
log_info "dry run: ${DRY_RUN}"
log_info "cmd timeout: ${CMD_TIMEOUT}s"
log_info "log file: ${LOG_FILE}"

action_pull() {
  dir="$1"
  log_info "---- processing: $dir"
  if [ ! -d "$dir/.git" ]; then
    log_warn "  -> no .git in $dir, skipping"
    return 0
  fi

  current_dir="$(pwd)"
  cd "$dir" || return 1
  # require origin remote
  if ! git remote | grep -q '^origin$'; then
    log_warn "  -> no 'origin' remote in $dir, skipping"
    cd "$current_dir" || true
    return 0
  fi

  run_cmd "  -> fetching origin/${BRANCH}" git fetch origin "${BRANCH}" || { log_error "  -> git fetch failed"; cd "$current_dir" || true; return 1; }

  if [ "${DRY_RUN}" = "true" ]; then
    run_cmd "  -> DRY_RUN: showing commits HEAD..origin/${BRANCH}" git --no-pager log --oneline --decorate --pretty=format:%h\ %ad\ %s --date=short HEAD..origin/"${BRANCH}" || true
    cd "$current_dir" || true
    return 0
  fi

  # checkout or create the branch tracking origin
  if git rev-parse --verify "${BRANCH}" >/dev/null 2>&1; then
    run_cmd "  -> switching to local branch ${BRANCH}" git checkout "${BRANCH}" || run_cmd "  -> fallback switch ${BRANCH}" git switch "${BRANCH}"
  else
    run_cmd "  -> creating local branch ${BRANCH} from origin/${BRANCH}" git checkout -B "${BRANCH}" origin/"${BRANCH}" || run_cmd "  -> fallback create local branch ${BRANCH}" git checkout -b "${BRANCH}"
  fi

  run_cmd "  -> resetting to origin/${BRANCH}" git reset --hard origin/"${BRANCH}" || { log_error "  -> reset failed"; cd "$current_dir" || true; return 1; }
  run_cmd "  -> pulling origin/${BRANCH}" git pull origin "${BRANCH}" || true
  cd "$current_dir" || true
  log_info "  -> done: $dir"
}

# resolve repo path
if [ ! -d "${REPO_PATH}" ]; then
  log_warn "target path '${REPO_PATH}' not found, fallback to script dir: ${SCRIPT_DIR}"
  REPO_PATH="${SCRIPT_DIR}"
fi

# If target itself is a git repo, operate on it; otherwise scan subdirectories for .git
if [ -d "${REPO_PATH}/.git" ]; then
  action_pull "${REPO_PATH}"
  exit 0
fi

# scan subdirectories
found=0
for d in "${REPO_PATH}"/*/; do
  [ -d "$d" ] || continue
  # trim trailing slash
  repo_dir="${d%/}"
  if [ -d "${repo_dir}/.git" ]; then
    found=1
    action_pull "${repo_dir}"
  fi
done

if [ "$found" -eq 0 ]; then
  log_error "no git repositories found under ${REPO_PATH}"
  exit 1
fi

log_info "all done"
exit 0
