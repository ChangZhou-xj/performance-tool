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

echo "[ql-git-pull] script dir: ${SCRIPT_DIR}"
echo "[ql-git-pull] target path: ${REPO_PATH}"
echo "[ql-git-pull] branch: ${BRANCH}"
echo "[ql-git-pull] dry run: ${DRY_RUN}"

action_pull() {
  local dir="$1"
  echo "---- processing: $dir"
  if [ ! -d "$dir/.git" ]; then
    echo "  -> no .git in $dir, skipping"
    return 0
  fi

  pushd "$dir" >/dev/null || return 1
  # require origin remote
  if ! git remote | grep -q '^origin$'; then
    echo "  -> no 'origin' remote in $dir, skipping"
    popd >/dev/null
    return 0
  fi

  echo "  -> fetching origin/${BRANCH}"
  git fetch origin "${BRANCH}" || { echo "  -> git fetch failed"; popd >/dev/null; return 1; }

  if [ "${DRY_RUN}" = "true" ]; then
    echo "  -> DRY_RUN: showing commits HEAD..origin/${BRANCH}"
    git --no-pager log --oneline --decorate --pretty=format:'%h %ad %s' --date=short HEAD..origin/"${BRANCH}" || true
    popd >/dev/null
    return 0
  fi

  # checkout or create the branch tracking origin
  if git rev-parse --verify "${BRANCH}" >/dev/null 2>&1; then
    git checkout "${BRANCH}" || git switch "${BRANCH}"
  else
    git checkout -B "${BRANCH}" origin/"${BRANCH}" || git checkout -b "${BRANCH}"
  fi

  echo "  -> resetting to origin/${BRANCH}"
  git reset --hard origin/"${BRANCH}" || { echo "  -> reset failed"; popd >/dev/null; return 1; }
  echo "  -> pulling origin/${BRANCH}"
  git pull origin "${BRANCH}" || true
  popd >/dev/null
  echo "  -> done: $dir"
}

# resolve repo path
if [ ! -d "${REPO_PATH}" ]; then
  echo "[ql-git-pull] target path '${REPO_PATH}' not found, fallback to script dir: ${SCRIPT_DIR}"
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
  echo "[ql-git-pull] no git repositories found under ${REPO_PATH}"
  exit 1
fi

echo "[ql-git-pull] all done"
exit 0
