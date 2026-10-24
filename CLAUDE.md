@AGENTS.md

## GitHub issues and pull requests

When creating or editing an issue or PR in this repo, follow the forms in `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE.md`. Keep every ticket short and easy to read.

- **Only the title and the main section are required.** Everything else is optional, so leave out any section you have nothing real to put in. Do not pad.
- **Pick the form that fits**, and reuse its section headings as `##` headings in the body (the `gh` CLI cannot fill issue forms, so write the body by hand):
  - Bug: `## What is wrong?` (required), then optional `## How can we see it?`, `## Where?`, `## Screenshots, errors, device`. Label `bug`.
  - Bank message parsed wrongly: `## The message` (required, redacted, in a code block), then optional `## What happened?`, `## What should have happened?`, `## Bank and how it arrived`. Label `bug`.
  - Feature: `## What do you need?` (required), then optional `## What would you like to happen?`, `## Where?`, `## Scope, mockups, links`. Label `enhancement`.
  - Task or chore: `## What and why?` (required), then optional `## Steps`, `## Risks`. No label.
- **Short means short:** a sentence or two per section, bullets for lists, no long background, no repeated text. A reader should get the point in about ten seconds.
- **Titles** are plain and specific, in sentence case, with no prefix. Say what is wrong or wanted, not "Fix bug".
- **Pull requests** use the template: `Closes #<issue>`, `## What changed and why`, `## How I checked it`, and only the `## Screenshots` and `## Rollout` parts that apply. Name the branch `<issue-number>-<short-slug>` and use conventional commits (`feat:`, `fix:`, `docs:`, ...).
- **Redact first.** Never put passwords, API keys, OTPs, full account or card numbers, or real balances in a ticket, PR, screenshot or log. Raw bank messages are redacted to `XXXX`.
- Security problems go through GitHub's private vulnerability reporting, never a public issue.
- The global rule still applies: no Claude attribution in commits, issues or PRs.

## Phases: one branch, one deploy
Work that comes as a phase (a tracker ticket with sub-tickets) ships as one merge to `main`, because a merge to `main` deploys to production.
- The phase has one integration branch, `phase-<n>-<slug>`, made from `main` by the first sub-ticket.
- Sub-ticket PRs target the phase branch. Vercel only builds a preview for them. Keep the phase branch current by merging `main` into it when `main` moves.
- Each sub-ticket keeps its own branch `<issue-number>-<slug>`, PR, tests and docs.
- When every sub-ticket is in and `yarn typecheck` and `yarn test` pass on the phase branch, open one PR from the phase branch to `main` listing the sub-tickets with `Closes #<tracker>`. Say in `## Rollout` what is needed (env vars, cron schedulers). Merge it before the app repo's phase PR.
- **Every sub-ticket PR is independently reviewed before it merges into the phase branch.** The review is a code review of its diff by someone who did not write it (a reviewer agent or a person), not the builder's own read and not just passing tests and typecheck. Findings go back to the builder to fix with tests, and the PR is reviewed again until it reports no blocking findings; only then does it merge into the phase branch. Look hardest at ownership filters (every query scoped to the signed-in user), input bounds, idempotency on writes, voided or deleted rows, money units, time zones, and CodeQL alerts.
- The final PR from the phase branch to `main` then gets a light last pass over the combined diff: shared files where several sub-PRs edited the same lines (docs lists, realtime resources, `server.ts` timers, `src/test/integrations.test.ts`), merge-conflict repairs, the `## Rollout` notes, and a green CodeQL. Expect few findings; a long list means a sub-PR skipped its review.
- Bug fixes and one-off changes that are not part of a phase still go straight to `main`.

## Code review before every push
Before any `git push` (a feature, a fix, or a merge-conflict repair), review the diff first: run the `code-review` skill, or have a reviewer agent read it, fix what it finds, then push. Passing tests and the analyzer is not a review. A repair that resolves conflicts can introduce duplicated lines (a repeated enum value or `if` condition), so it is reviewed too.

## Docs and feature context

Read `docs/feature-map.md` first, then the `CLAUDE.md` in the feature dir you will touch, before opening code. The index of all docs is `docs/README.md`; past decisions are in `docs/adr/`.

@docs/feature-map.md

- **Feature dirs with a `CLAUDE.md`:** `src/features/<name>/`, the main `src/app/api/<area>/` dirs, `src/lib`, `src/models`, `worker`.
- **On every edit in one of those dirs**, update that dir's `CLAUDE.md` and the matching row in `docs/feature-map.md` in the same change.
- **A new feature dir** needs a `CLAUDE.md` (template: Purpose, Files, Talks to, Rules and gotchas, Tests, Last changed; max about 30 lines) and a feature-map row.
- **Check before a PR:** `bash scripts/check-feature-docs.sh` (default base `origin/main`).
- **Commands** (from `package.json`): `yarn lint`, `yarn typecheck`, `yarn test` (Vitest), `yarn build`, `yarn dev`. There is one test package, run from the repo root.
- Only write Next.js facts that you read in this repo or in `node_modules/next/dist/docs/` (see AGENTS.md).
