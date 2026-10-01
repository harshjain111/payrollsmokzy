#!/usr/bin/env bash
# Shared helpers: loads .env.migration next to this file (if present) and validates vars.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
WORK_DIR="${WORK_DIR:-$HERE/.work}"
mkdir -p "$WORK_DIR"

if [[ -f "$HERE/.env.migration" ]]; then
  set -a; # shellcheck disable=SC1091
  source "$HERE/.env.migration"; set +a
fi

need() {
  for v in "$@"; do
    if [[ -z "${!v:-}" ]]; then
      echo "Missing required variable: $v (set it in the environment or scripts/migrate-supabase/.env.migration)" >&2
      exit 1
    fi
  done
}

log() { printf '\n==> %s\n' "$*"; }
