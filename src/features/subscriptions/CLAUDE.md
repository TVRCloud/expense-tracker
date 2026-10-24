# Subscriptions
Purpose: repeating charges found in the user's expense history, with the next date and what they cost a year; confirm or dismiss each.

## Files
- components/SubscriptionsClient.tsx: `/subscriptions` list (Active and Dismissed tabs), confirm, dismiss and restore.
- hooks/useSubscriptions.ts: `useSubscriptions(status)` and `useSetSubscriptionStatus()`; query key `["subscriptions", status]`.

## Talks to
- `GET /api/subscriptions`, `PATCH /api/subscriptions/:id`.
- Libs: src/lib/subscription-detector.ts, src/lib/subscription-service.ts. Model: SubscriptionDecision.
- Mobile: none yet; the app will read `integrations/subscriptions` (TVRCloud/expense-tracker-mobile#50).

## Rules and gotchas
- Detections are not stored; they are recomputed on every read. Only the user's choice is saved.
- Realtime resource `subscriptions` (and `transactions`) invalidates the `["subscriptions"]` keys.
- Amounts are cents, shown with `useCurrency().formatCurrency`.

## Tests
- `src/lib/subscription-detector.test.ts` (detection rules), `src/test/integrations.test.ts` ("integration subscriptions").

## Last changed
- feat(integrations): subscription detector
