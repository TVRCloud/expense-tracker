# Contributing

## Prerequisites

- Node.js 20+
- Yarn (not npm or pnpm)
- MongoDB running locally (or Atlas connection string in `.env.local`)
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

Every change starts as an issue, so the "why" is written down before the code.

1. **Open an issue** with the form that fits (New issue shows them): *Bug report*, *Feature request*, *Task or chore*, or *Bank message parsed wrongly* for capture problems. Blank issues are off on purpose. Report security problems privately through the link on that page, never in a public issue.
2. **Branch from `main`** named `<issue-number>-<short-slug>`, for example `48-app-update-endpoints`.
3. **Commit** with the conventional prefixes above (`feat:`, `fix:`, `docs:`, ...). Keep the subject short and say why in the body when it is not obvious.
4. **Open a pull request** from the branch. The template asks for what changed, why, how to check it, screenshots and rollout notes. Start it with `Closes #<issue>` so merging closes the ticket.
5. **Rollout items matter.** Tick new environment variables, database changes and API contract changes in the PR, and update the matching doc in the same PR.

Redact before you paste: no passwords, API keys, OTPs or full account numbers in issues, screenshots or logs.

