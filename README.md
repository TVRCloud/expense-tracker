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

## Pages & screens

One doc per page — what it does, the user story behind it, key elements, and edge cases
to design for. This is what the UI/UX designer should read first. Every authenticated
page also sits inside one shared app shell (sidebar/bottom nav/header) — see
[docs/pages/](docs/pages/) for that too.

| # | Page | Route | Doc |
|---|---|---|---|
| 1 | Dashboard | `/dashboard` | [docs/pages/01-dashboard.md](docs/pages/01-dashboard.md) |
| 2 | Transactions | `/transactions`, `/transactions/add`, `/transactions/[id]`, `/transactions/recurring` | [docs/pages/02-transactions.md](docs/pages/02-transactions.md) |
| 3 | Accounts | `/accounts`, `/accounts/[id]` | [docs/pages/03-accounts.md](docs/pages/03-accounts.md) |
| 4 | Budgets | `/budgets` | [docs/pages/04-budgets.md](docs/pages/04-budgets.md) |
| 5 | Goals | `/goals` | [docs/pages/05-goals.md](docs/pages/05-goals.md) |
| 6 | Loans | `/loans` | [docs/pages/06-loans.md](docs/pages/06-loans.md) |
| 7 | Analytics | `/analytics` | [docs/pages/07-analytics.md](docs/pages/07-analytics.md) |
| 8 | Notifications | `/notifications` | [docs/pages/08-notifications.md](docs/pages/08-notifications.md) |
| 9 | Logs | `/logs` | [docs/pages/09-logs.md](docs/pages/09-logs.md) |
| 10 | Settings | `/settings` + 6 subpages | [docs/pages/10-settings.md](docs/pages/10-settings.md) |
| 11 | Account | `/account` | [docs/pages/11-account.md](docs/pages/11-account.md) |
| 12 | Admin Users | `/admin/users` (admin only) | [docs/pages/12-admin-users.md](docs/pages/12-admin-users.md) |
| 13 | Credit Cards *(embedded, no own route)* | inside Accounts, Transactions, Dashboard | [docs/pages/13-credit-cards.md](docs/pages/13-credit-cards.md) |
| 14 | Login | `/login` | [docs/pages/14-login.md](docs/pages/14-login.md) |
| 15 | Register | `/register` | [docs/pages/15-register.md](docs/pages/15-register.md) |
| 16 | Forgot Password | `/forgot-password` | [docs/pages/16-forgot-password.md](docs/pages/16-forgot-password.md) |
| 17 | Reset Password | `/reset-password/[token]` | [docs/pages/17-reset-password.md](docs/pages/17-reset-password.md) |
| 18 | Offline | `/offline` | [docs/pages/18-offline.md](docs/pages/18-offline.md) |

Also API-only, no UI: **n8n integration** (`/api/integrations/*`) — see [docs/n8n-integration.md](docs/n8n-integration.md).

> Budgets, Goals, and Loans aren't linked from the Sidebar, BottomNav, or Dashboard today
> — only reachable via the command palette (⌘K/Ctrl+K) or a notification deep-link.
> Worth deciding whether that changes in the redesign.

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
- [n8n Integration](docs/n8n-integration.md)
- [Pages & screens](docs/pages/) — one doc per page, user story + design notes
