# API: events
Purpose: browser SSE stream of "resource changed" events.

## Files
- route.ts: `GET /api/events`; `requireAuth()` then `createRealtimeResponse`.

## Talks to
- Libs: src/lib/realtime/sse.ts, changes.ts. Source: one MongoDB change stream per connection.
- Client: SocketProvider (EventSource) and RealtimeSync. App twin: `GET /api/integrations/events`.

## Rules and gotchas
- Events carry only the resource name; clients refetch. Contract and invalidation map: [docs/realtime.md](../../../../docs/realtime.md).
- `maxDuration = 60`; the browser reconnects and refetches everything.
- Needs a replica set or Atlas. Service worker must never cache this route (worker/index.ts uses NetworkOnly).

## Tests
- `src/lib/realtime/changes.test.ts`, `invalidation.test.ts`.

## Last changed
- e19229d feat(realtime): live updates for every screen and an app event channel
