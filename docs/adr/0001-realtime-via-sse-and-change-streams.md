# ADR-0001: Realtime via SSE and MongoDB change streams

Status: Accepted
Date: 2026-08-06 (socket.io removed), 2026-10-16 (current design)

## Context
Live updates first used socket.io on a custom server (`server.ts`). `docs/realtime.md` records that Vercel cannot host persistent servers. The phone app also needed an event channel that works with an API key, not a browser session.

## Decision
- Stream Server-Sent Events fed by one MongoDB change stream per connection, narrowed to seven collections and to the caller's `user`.
- Events say only which resource changed; clients refetch. No data travels on the stream.
- Browser: `GET /api/events` (session). App: `GET /api/integrations/events` (API key) plus `GET /api/integrations/changes?since=` as a polling fallback.
- Hard-delete events are not broadcast, because they carry no document to attribute to a user. Records are soft-deleted or archived so changes arrive as updates.

## Consequences
- Needs a replica set or Atlas.
- Vercel ends the function at `maxDuration` (60s set); clients reconnect and refetch everything, so events in the gap are not lost to the UI.
- Hard-deleted notifications and TTL expiry are not pushed.
- The service worker must never cache `/api/events` (`worker/index.ts`).
- `server.ts` still exists but only runs timers, no sockets.

## Source
`docs/realtime.md`; commits 99fea86 "rem socket" and e19229d "feat(realtime): live updates for every screen and an app event channel"; `src/lib/realtime/changes.ts` header comments.
