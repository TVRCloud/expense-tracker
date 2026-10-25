# Contributing

## Prerequisites

- Node.js 20+
- Yarn (not npm or pnpm)
- MongoDB running locally **as a replica set** (or an Atlas connection string in `.env.local`). A standalone `mongod` starts, but realtime, split-purchase edits and every transaction create (the row and the balance move are written in one database transaction) need a replica set (`mongod --replSet rs0`, then `rs.initiate()` once)
- Redis running locally (optional)

## Setup

```bash
git clone <repo> && cd expense-tracker
yarn install
cp .env.example .env.local
# fill in the required values
yarn dev
```

## Code style

- **TypeScript strict mode** — no `any`
- **ESLint** enforces `@typescript-eslint/no-explicit-any` as an error
- **Prettier** for formatting (100 char line width, double quotes)
- Run `yarn lint:fix && yarn format` before committing

A pre-commit hook (Husky + lint-staged) enforces this automatically.

## Feature structure

New features go in `src/features/{name}/`:

```
features/my-feature/
├── components/   — React components specific to this feature
├── hooks/        — TanStack Query hooks (useFeature, useCreateFeature, etc.)
└── schemas/      — Zod schemas for forms
```

API routes go in `src/app/api/{name}/route.ts`.

## Adding a new model

1. Create `src/models/MyModel.ts` following the pattern of existing models
2. Add the TypeScript interface to `src/types/models.ts`
3. Add the Mongoose schema with appropriate indexes
4. Export a default model using the `mongoose.models` cache pattern

## Adding an API route

1. Create `src/app/api/{resource}/route.ts`
2. Call `requireAuth()` at the top
3. Validate input with Zod
4. Call `connectDB()` before any Mongoose operation
5. Return `NextResponse.json({ data: ... })` on success
6. Catch errors, log with `logger.error`, return 500

## Commit convention

Use conventional commits:
- `feat:` new feature
- `fix:` bug fix
- `refactor:` code change that neither adds a feature nor fixes a bug
- `docs:` documentation only
- `chore:` tooling, dependencies

## Type checking

```bash
yarn typecheck  # tsc --noEmit
```

Must pass before opening a PR.

## Issues, branches and pull requests

Every change starts as an issue, so the "why" is written down before the code. Keep it short.

1. **Open an issue** with the form that fits: *Bug report*, *Bank message parsed wrongly*, *Feature request* or *Task or chore*. Only the title and the first box ("What is wrong?", "The message", "What do you need?", "What and why?") are required; everything else is optional, so skip what you don't know. Blank issues are off on purpose. Report security problems privately through the link on the new-issue page, never in a public issue.
2. **Branch from `main`** named `<issue-number>-<short-slug>`, for example `48-app-update-endpoints`.
3. **Commit** with the conventional prefixes above (`feat:`, `fix:`, `docs:`, ...).
4. **Open a pull request.** The template has four short parts: what changed and why, how you checked it, screenshots, and rollout ticks. Start it with `Closes #<issue>` so merging closes the ticket. Delete the parts that don't apply.
5. **Rollout ticks matter.** New environment variables, database changes and API contract changes belong in the PR, with the matching doc updated in the same PR.

Redact before you paste: no passwords, API keys, OTPs or full account numbers in issues, screenshots or logs.

## Documentation

Docs are part of the change, not a follow-up. Start from [docs/README.md](README.md).

- **Feature `CLAUDE.md`:** every `src/features/<name>/` dir, the main `src/app/api/<area>/` dirs, `src/lib`, `src/models` and `worker` have a `CLAUDE.md` (purpose, files, what it talks to, rules, tests). If you change files or behaviour in one of these dirs, update its `CLAUDE.md` in the same PR. A new feature dir needs one before merge.
- **Feature map:** update the matching row in [feature-map.md](feature-map.md) when pages, routes, models or purpose change.
- **Check:** `bash scripts/check-feature-docs.sh [base]` (default base `origin/main`) lists dirs whose `CLAUDE.md` was not touched. Run it before opening a PR.
- **Decisions:** record a hard-to-undo or cross-feature choice as an ADR in [adr/](adr/README.md). Do not edit an accepted ADR; supersede it.
- **Contracts:** API or schema changes also update [api-contracts.md](api-contracts.md), [n8n-integration.md](n8n-integration.md) or [database-schema.md](database-schema.md), as the PR template's rollout ticks remind you.
- **Changelog:** add a short line under `Unreleased` in [../CHANGELOG.md](../CHANGELOG.md) for changes people would notice.
- **Issues and PRs:** use the forms in `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE.md` (rules above).
