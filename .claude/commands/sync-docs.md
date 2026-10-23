---
description: Bring feature CLAUDE.md files and the feature map in line with the current diff
---
1. Run `git diff --name-only origin/main...HEAD` plus uncommitted changes.
2. For each touched feature dir with a CLAUDE.md, read the dir's changed files and update Files, Talks to, gotchas, Tests and Last changed. Only write what the code shows.
3. Update the matching `docs/feature-map.md` row if purpose or files changed.
4. Run the feature-docs check script for this repo and report anything still failing.
