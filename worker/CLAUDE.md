# worker (service worker)
Purpose: the PWA service worker source. It is NOT a background job runner. Jobs run in server.ts timers and `/api/cron/*`.

## Files
- index.ts: Serwist setup (precache, runtime caching, `/offline` fallback) plus `push` and `notificationclick` handlers.
- tsconfig.json: WebWorker typings, includes only index.ts.

## Talks to
- Built by `@serwist/next` from `next.config.ts` (`swSrc: worker/index.ts`, output `public/sw.js`, disabled in development).
- Push payloads come from src/lib/push.ts; subscriptions via `/api/push/*`.

## Rules and gotchas
- `/api/events` must stay `NetworkOnly` and listed before `defaultCache`, or the default API rule buffers the SSE stream and breaks realtime.
- `/offline` is a rendered page, so it is added to `precacheEntries` by hand.
- Notification click opens or focuses a window at `data.url` (default `/notifications`).
- Docs: [docs/pwa.md](../docs/pwa.md) still says next-pwa; the code uses Serwist.

## Tests
- None.

## Last changed
- e247f6c v2
