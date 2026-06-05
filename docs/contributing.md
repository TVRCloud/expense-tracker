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
