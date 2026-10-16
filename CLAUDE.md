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
