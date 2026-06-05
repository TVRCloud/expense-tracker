# Finance OS

A production-quality full-stack expense tracker built with Next.js 15 App Router, TypeScript, shadcn/ui, and MongoDB.

## Features

- **Expense tracking** — income, expenses, transfers with category tags
- **Budgets** — monthly category budgets with configurable alert thresholds
- **Loans** — track money given/received with repayment history
- **Goals** — savings goals with progress tracking
- **Analytics** — 6-month bar chart overview, category breakdown, monthly history
- **Real-time** — live balance and notification updates via Socket.io
- **Push notifications** — VAPID web push for budget alerts, loan due dates, goal milestones
- **PWA** — installable, offline-capable
- **Role-based access** — user and admin roles with guarded routes
- **Dark/light mode** — system-aware theme with smooth toggle

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 App Router + TypeScript strict |
| UI | shadcn/ui + Tailwind CSS v4 |
| Auth | NextAuth v4 (JWT + JTI session tracking) |
| Database | MongoDB + Mongoose |
| Caching | Redis (ioredis) |
| State | TanStack React Query v5 |
| Forms | react-hook-form + Zod |
| Realtime | Socket.io (custom server) |
| Push | web-push (VAPID) |
| PWA | next-pwa |
| Logging | pino |
| Charts | recharts |

## Getting started

```bash
# 1. Clone
git clone <repo-url> && cd expense-tracker

# 2. Install dependencies (Yarn only)
yarn install

# 3. Configure environment
cp .env.example .env.local
# Fill in MONGODB_URI, NEXTAUTH_SECRET, etc.

# 4. Generate VAPID keys for push notifications
npx web-push generate-vapid-keys

# 5. Dev server
yarn dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---------|-------------|
| `yarn dev` | Start development server (custom Socket.io server) |
| `yarn build` | Production build |
| `yarn start` | Start production server |
| `yarn lint` | ESLint check |
| `yarn lint:fix` | ESLint fix |
| `yarn format` | Prettier format |
| `yarn typecheck` | TypeScript type check |

## Project structure

```
src/
├── app/           — Next.js pages and API routes
│   ├── (auth)/    — Login, register, forgot/reset password
│   ├── (app)/     — Protected app screens
│   └── api/       — All API routes
├── features/      — Feature-scoped components, hooks, schemas
├── models/        — Mongoose models
├── lib/           — Core utilities (auth, db, redis, push, etc.)
├── components/    — Shared UI components and providers
├── hooks/         — Global hooks
└── types/         — TypeScript type definitions
```

See [docs/architecture.md](docs/architecture.md) for full details.

## Documentation

- [Architecture](docs/architecture.md)
- [Database Schema](docs/database-schema.md)
- [API Contracts](docs/api-contracts.md)
- [Authentication](docs/authentication.md)
- [Realtime](docs/realtime.md)
- [Notifications](docs/notifications.md)
- [PWA](docs/pwa.md)
- [Deployment](docs/deployment.md)
- [Contributing](docs/contributing.md)
