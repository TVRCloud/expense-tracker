#!/usr/bin/env bash
# PostToolUse hook (Edit|Write|MultiEdit). When an edited file sits under a
# directory with a CLAUDE.md, remind Claude to update that file and the
# feature map in the same change. Silent otherwise.
set -uo pipefail
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[[ -z $file ]] && exit 0
case $file in
  */CLAUDE.md|*/test/*|*/tests/*|*/__tests__/*|*.test.ts|*.test.tsx|*/docs/*) exit 0 ;;
esac
dir=$(dirname "$file")
while [[ $dir == "$root"/* ]]; do
  if [[ -f $dir/CLAUDE.md ]]; then
    rel=${dir#"$root"/}
    jq -n --arg d "$rel" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:("Feature docs: you edited a file under " + $d + ". Before finishing, update " + $d + "/CLAUDE.md (Files, Talks to, gotchas, Last changed) and the docs/feature-map.md row if purpose or files changed. See docs/templates/feature-CLAUDE.md.")}}'
    exit 0
  fi
  dir=$(dirname "$dir")
done
exit 0
