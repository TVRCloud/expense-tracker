#!/usr/bin/env bash
# Fails when code in a directory that has its own CLAUDE.md changed without
# that CLAUDE.md changing too, or when a src/features/* directory has no
# CLAUDE.md. See docs/contributing.md ("Documentation").
#
# Usage: bash scripts/check-feature-docs.sh [base-ref]   (default: origin/main)
#
# Compares `git diff --name-only <base>...HEAD`, so only committed changes
# count. Each changed file belongs to its nearest ancestor directory that has
# a CLAUDE.md (the repo root CLAUDE.md is ignored). Ignored files: CLAUDE.md
# itself, tests (*.test.*, *.spec.*, test/tests/__tests__ dirs) and snapshots.
set -euo pipefail

base="${1:-origin/main}"
root="$(git rev-parse --show-toplevel)"
cd "$root"

if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "check-feature-docs: base ref '$base' not found. Pass one, e.g. main." >&2
  exit 2
fi

failed=0

# 1. Every feature dir needs a CLAUDE.md.
missing=()
for dir in src/features/*/; do
  dir="${dir%/}"
  [ -f "$dir/CLAUDE.md" ] || missing+=("$dir")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Feature dirs without a CLAUDE.md:"
  printf '  %s\n' "${missing[@]}"
  failed=1
fi

# 2. Changed code needs its dir's CLAUDE.md changed too.
changed="$(git diff --name-only "$base"...HEAD)"

is_ignored() {
  case "$1" in
    */CLAUDE.md | CLAUDE.md) return 0 ;;
    *.test.* | *.spec.* | *.snap) return 0 ;;
    */__snapshots__/* | */__tests__/* | */tests/* | */test/*) return 0 ;;
  esac
  return 1
}

owner_of() {
  local d
  d="$(dirname "$1")"
  while [ "$d" != "." ] && [ "$d" != "/" ]; do
    if [ -f "$d/CLAUDE.md" ]; then echo "$d"; return; fi
    d="$(dirname "$d")"
  done
}

owners=""
while IFS= read -r file; do
  [ -z "$file" ] && continue
  is_ignored "$file" && continue
  owner="$(owner_of "$file")"
  [ -z "$owner" ] && continue
  owners="$owners"$'\n'"$owner"
done <<<"$changed"

stale=()
while IFS= read -r owner; do
  [ -z "$owner" ] && continue
  if ! grep -qx "$owner/CLAUDE.md" <<<"$changed"; then
    stale+=("$owner")
  fi
done < <(printf '%s\n' "$owners" | sort -u)

if [ "${#stale[@]}" -gt 0 ]; then
  echo "Changed since $base but CLAUDE.md not updated (also check docs/feature-map.md):"
  printf '  %s/CLAUDE.md\n' "${stale[@]}"
  failed=1
fi

if [ "$failed" -eq 0 ]; then
  echo "check-feature-docs: ok (base $base)"
fi
exit "$failed"
