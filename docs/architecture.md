# Architecture

## Overview

Finance OS is a Next.js 15 App Router application with realtime updates over Server-Sent Events backed by MongoDB change streams (see [realtime.md](realtime.md)).

```
Browser
  │
  ├── HTTPS → Next.js App Router (React Server Components + Client Components)
  │                │
  │                ├── /api/*      — Next.js Route Handlers (Edge-compatible where possible)
  │                └── /api/events — SSE stream fed by a MongoDB change stream
  │
  └── EventSource → /api/events (auto-reconnects)
```

## Directory layout

```
expense-tracker/
├── server.ts                  — Custom HTTP server (Next.js + Socket.io)
├── src/
│   ├── app/
│   │   ├── (auth)/            — Public auth pages (no layout)
│   │   ├── (app)/             — Protected app pages (sidebar/bottom-nav layout)
│   │   └── api/               — Route Handlers
│   ├── features/              — Feature modules (components + hooks + schemas)
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── transactions/
│   │   ├── analytics/
│   │   ├── settings/
│   │   ├── accounts/
│   │   ├── budgets/
│   │   ├── goals/
│   │   ├── loans/
│   │   └── notifications/
│   ├── models/                — Mongoose models (10 collections)
│   ├── lib/                   — Singleton utilities
│   │   ├── auth-options.ts    — NextAuth config (JWT + JTI sessions)
│   │   ├── auth-guard.ts      — requireAuth() server utility
│   │   ├── mongodb.ts         — Cached Mongoose connection
│   │   ├── redis.ts           — ioredis singleton
│   │   ├── push.ts            — VAPID helpers
│   │   ├── api-client.ts      — Axios instance for client-side fetches
│   │   ├── query-client.ts    — TanStack React Query singleton
│   │   ├── socket-client.ts   — Socket.io client singleton
│   │   └── utils.ts           — cn(), formatCurrency(), etc.
│   ├── components/
│   │   ├── layout/            — Sidebar, BottomNav, MobileHeader, DesktopTopbar
│   │   ├── shared/            — RoleGuard, EmptyState, etc.
│   │   ├── providers/         — QueryProvider, ThemeProvider, SocketProvider, SessionProvider
│   │   └── ui/                — shadcn/ui components
│   ├── hooks/                 — useSocket, usePushNotifications, useRole, useDebounce
│   └── types/                 — next-auth.d.ts, models.ts, api.ts
```

## Data flow

1. **Server Components** fetch data directly from MongoDB via Mongoose (no HTTP hop)
2. **Client Components** fetch via TanStack React Query → axios `apiClient` → Next.js Route Handlers → MongoDB
3. **Mutations** (create/update/delete) always go through Route Handlers; on success the query cache is invalidated
4. **Realtime updates**: `/api/events` streams `data-changed {resource}` from a MongoDB change stream; `RealtimeSync` maps each resource to TanStack query invalidations
5. **Redis** caches expensive aggregations (stats, analytics) with a 5-minute TTL

## Key design decisions

- UI follows the Apple-style design system in [design-system.md](design-system.md) (tokens in `src/app/globals.css`, reference artifact linked there)

- All monetary values are stored as **integers (cents)** — never floats
- `requireAuth()` is called at the top of every Route Handler — no middleware magic for per-route auth
- JTI session tracking: every JWT contains a `jti` stored in MongoDB; on every token refresh the JTI is validated. Session can be revoked server-side by setting `isActive: false`
- Redis is optional — all Redis calls are wrapped in try/catch; the app works without it
- Realtime is SSE + change streams (no custom server); `server.ts` and `socket-client.ts` are legacy
