# Notifications
Purpose: in-app notification inbox with deep links. Page spec: [docs/pages/08-notifications.md](../../../docs/pages/08-notifications.md). Channels: [docs/notifications.md](../../../docs/notifications.md).

## Files
- components/NotificationsClient.tsx: `/notifications` list, mark read, delete, mark all read; routes by `meta`.

## Talks to
- `GET /api/notifications?limit=`, `PATCH/DELETE /api/notifications/:id`, `POST /api/notifications/read-all`.
- Models: Notification (90-day TTL). SSE resource `notifications`.
- Mobile: none found. No inbox screen in lib/features; the app's "notification" code is the bank-app capture listener.

## Rules and gotchas
- Producers (src/lib/budget-alert.ts, emi-notifications.ts, credit-notifications.ts) each write a routable id into `meta`; the client turns that into a link. Keep both sides in step.
- Types: budget_alert, loan_due, goal_reached, system, transaction, credit_due, credit_overdue, emi_due.
- Hard deletes and TTL expiry are not pushed over SSE.

## Tests
- None.

## Last changed
- 10a7ed0 feat(ui): Apple-style redesign with full-width responsive layouts
