# Docs index

What each doc answers and when to read it. For "where is feature X in the code", start with [feature-map.md](feature-map.md).

## Index

| Doc | What it answers | Read it when |
|---|---|---|
| [feature-map.md](feature-map.md) | Which pages, components, API routes, models, libs, tests and mobile screens belong to each feature | Before opening code, to find the files for a task |
| [architecture.md](architecture.md) | Layout, data flow, main design choices | You are new, or adding a layer |
| [database-schema.md](database-schema.md) | Fields and indexes of each collection | Touching a model or a query |
| [api-contracts.md](api-contracts.md) | Browser API paths, auth and shapes | Changing or calling a `/api/*` route |
| [n8n-integration.md](n8n-integration.md) | The API-key surface `/api/integrations/*`: auth, idempotency, errors, rate limits, app updates | Working on n8n or the mobile app's API |
| [reconcile.md](reconcile.md) | How bank messages become transactions; source priority; dedupe; corrections | Touching capture, review or corrections |
| [realtime.md](realtime.md) | SSE and change-stream events, invalidation map, polling fallback | Touching live updates |
| [authentication.md](authentication.md) | Login, session tracking, guards, password reset, roles | Touching auth or access rules |
| [notifications.md](notifications.md) | In-app notifications and web push | Touching alerts or push |
| [pwa.md](pwa.md) | Install, offline, caching | Touching the service worker or manifest |
| [deployment.md](deployment.md) | Requirements and environment variables | Deploying or adding an env var |
| [design-system.md](design-system.md) | UI tokens and how the reference artifact maps to code | Changing UI styles |
| [contributing.md](contributing.md) | Setup, code style, commits, issues, PRs, documentation rules | Before your first change |
| [flutter-mobile-app-spec.md](flutter-mobile-app-spec.md) | Original draft spec for the companion app (partly superseded; see reconcile.md) | You need history only |
| [adr/README.md](adr/README.md) | Why major decisions were made | You are about to reverse or repeat one |
| [../CHANGELOG.md](../CHANGELOG.md) | What changed, by release period | Writing release notes |

### Page specs

One doc per screen, with user story, key elements and edge cases ([pages/](pages/)). Routes are as stated in each file.

| # | Page | Spec |
|---|---|---|
| 1 | Dashboard | [01-dashboard.md](pages/01-dashboard.md) |
| 2 | Transactions (list, add, detail, recurring) | [02-transactions.md](pages/02-transactions.md) |
| 3 | Accounts | [03-accounts.md](pages/03-accounts.md) |
| 4 | Budgets | [04-budgets.md](pages/04-budgets.md) |
| 5 | Goals | [05-goals.md](pages/05-goals.md) |
| 6 | Loans | [06-loans.md](pages/06-loans.md) |
| 7 | Analytics | [07-analytics.md](pages/07-analytics.md) |
| 8 | Notifications | [08-notifications.md](pages/08-notifications.md) |
| 9 | Logs | [09-logs.md](pages/09-logs.md) |
| 10 | Settings | [10-settings.md](pages/10-settings.md) |
| 11 | Account | [11-account.md](pages/11-account.md) |
| 12 | Admin users | [12-admin-users.md](pages/12-admin-users.md) |
| 13 | Credit cards (embedded) | [13-credit-cards.md](pages/13-credit-cards.md) |
| 14 | Login | [14-login.md](pages/14-login.md) |
| 15 | Register | [15-register.md](pages/15-register.md) |
| 16 | Forgot password | [16-forgot-password.md](pages/16-forgot-password.md) |
| 17 | Reset password | [17-reset-password.md](pages/17-reset-password.md) |
| 18 | Offline | [18-offline.md](pages/18-offline.md) |

Reconcile (`/reconcile`) and Landing (`/`) have no page spec; see [reconcile.md](reconcile.md) and [feature-map.md](feature-map.md).

## Where context lives

- Root [CLAUDE.md](../CLAUDE.md) and [AGENTS.md](../AGENTS.md): rules for Claude. AGENTS.md warns that this Next.js version differs from common knowledge; read `node_modules/next/dist/docs/` before changing Next.js code.
- `CLAUDE.md` inside `src/features/<name>/`, `src/app/api/<area>/`, `src/lib`, `src/models`, `worker`: purpose, files, rules for that dir.
- `.github/`: issue forms and the PR template.

## Reading order for a newcomer

1. [../README.md](../README.md): what the app is, how to run it.
2. [architecture.md](architecture.md), then [feature-map.md](feature-map.md).
3. [database-schema.md](database-schema.md) and [authentication.md](authentication.md).
4. The page spec and feature `CLAUDE.md` for the area you will change.
5. [reconcile.md](reconcile.md) and [n8n-integration.md](n8n-integration.md) if you touch bank messages or the app API.
6. [backup.md](backup.md) for the backup file format and its threat model, [realtime.md](realtime.md), [notifications.md](notifications.md), [pwa.md](pwa.md) as needed.
7. [contributing.md](contributing.md) before you open a PR; skim [adr/README.md](adr/README.md) for past decisions.

Note: some older docs lag the code; [feature-map.md](feature-map.md#known-doc-drift) lists the known gaps.

## Templates and agent tooling

- `docs/templates/`: feature CLAUDE.md, ADR and new-feature checklist templates.
- `.claude/commands/new-feature.md`, `.claude/commands/sync-docs.md`: slash commands to scaffold a feature and sync docs with a diff.
- `.claude/hooks/feature-docs-reminder.sh`: after an edit in a feature dir, reminds Claude to update that dir's CLAUDE.md.
- `.github/workflows/docs-check.yml`: CI runs the feature-docs check on every PR.
