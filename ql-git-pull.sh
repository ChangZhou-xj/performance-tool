#!/usr/bin/env bash
set -euo pipefail

# ql-git-pull.sh
# Pull (reset) a branch (default: master) for a target repo or all git repos under a directory.
# Usage:
#   ql-git-pull.sh [REPO_PATH] [BRANCH]
# Examples:
#   ql-git-pull.sh /ql/data/scripts master       # pull master for a git repo or scan subdirs
#   DRY_RUN=true ql-git-pull.sh . master         # dry-run on current repo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_PATH="${1:-/ql/data/scripts}"
BRANCH="${2:-master}"
DRY_RUN="${DRY_RUN:-false}"

ts() {
  date '+%Y-%m-%d %H:%M:%S'
}

log_info() {
  echo "[$(ts)] [INFO] $*"
}

log_warn() {
  echo "[$(ts)] [WARN] $*"
}

log_error() {
  echo "[$(ts)] [ERROR] $*"
}

run_cmd() {
  local desc="$1"
  shift

  log_info "${desc}"
  "$@"
}

trap 'log_error "脚本执行失败，退出码: $?，行号: ${LINENO}"' ERR

log_info "ql-git-pull 启动"
log_info "script dir: ${SCRIPT_DIR}"
log_info "target path: ${REPO_PATH}"
log_info "branch: ${BRANCH}"
log_info "dry run: ${DRY_RUN}"

action_pull() {
  local dir="$1"
  log_info "---- processing: $dir"
  if [ ! -d "$dir/.git" ]; then
    log_warn "  -> no .git in $dir, skipping"
    return 0
  fi

  pushd "$dir" >/dev/null || return 1
  # require origin remote
  if ! git remote | grep -q '^origin$'; then
    log_warn "  -> no 'origin' remote in $dir, skipping"
    popd >/dev/null
    return 0
  fi

  run_cmd "  -> fetching origin/${BRANCH}" git fetch origin "${BRANCH}" || { log_error "  -> git fetch failed"; popd >/dev/null; return 1; }

  if [ "${DRY_RUN}" = "true" ]; then
    log_info "  -> DRY_RUN: showing commits HEAD..origin/${BRANCH}"
    git --no-pager log --oneline --decorate --pretty=format:'%h %ad %s' --date=short HEAD..origin/"${BRANCH}" || true
    popd >/dev/null
    return 0
  fi

  # checkout or create the branch tracking origin
  if git rev-parse --verify "${BRANCH}" >/dev/null 2>&1; then
    run_cmd "  -> switching to local branch ${BRANCH}" git checkout "${BRANCH}" || run_cmd "  -> fallback switch ${BRANCH}" git switch "${BRANCH}"
  else
    run_cmd "  -> creating local branch ${BRANCH} from origin/${BRANCH}" git checkout -B "${BRANCH}" origin/"${BRANCH}" || run_cmd "  -> fallback create local branch ${BRANCH}" git checkout -b "${BRANCH}"
  fi

  run_cmd "  -> resetting to origin/${BRANCH}" git reset --hard origin/"${BRANCH}" || { log_error "  -> reset failed"; popd >/dev/null; return 1; }
  log_info "  -> pulling origin/${BRANCH}"
  git pull origin "${BRANCH}" || true
  popd >/dev/null
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
