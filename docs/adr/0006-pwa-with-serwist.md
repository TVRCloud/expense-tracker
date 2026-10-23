# ADR-0006: PWA service worker with Serwist

Status: Accepted
Date: 2026-09-05

## Context
The app is installable and works offline. Push notifications need an active service worker. `docs/pwa.md` still describes `next-pwa`, but the build now uses Serwist (introduced in commit e247f6c "v2", where `@serwist/next` first appears in `package.json`).

## Decision
- Source is `worker/index.ts`, built by `@serwist/next` to `public/sw.js`, disabled in development.
- `/offline` is precached by hand and used as the document fallback.
- `/api/events` is `NetworkOnly` and placed before the default cache rules, since the default API rule buffered the SSE stream and broke realtime.
- Push `push` and `notificationclick` handlers live in the same worker.
- `.map` files are excluded from precache: they return 403 on Vercel, which left the worker stuck installing and push never worked (`next.config.ts` comment).

## Consequences
- Any new long-lived or streaming route needs a `NetworkOnly` rule before `defaultCache`.
- `docs/pwa.md` is out of date on library name and caching defaults.

## Source
`worker/index.ts`, `next.config.ts` comments, commit e247f6c.
