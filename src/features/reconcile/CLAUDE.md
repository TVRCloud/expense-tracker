# Reconcile (web)
Purpose: review inbox for auto-captured transactions and queued bank messages; confirm, correct, void, resolve. Rules: [docs/reconcile.md](../../../docs/reconcile.md). No page spec in docs/pages.

## Files
- components/ReconcileClient.tsx: `/reconcile` inbox, history.
- components/CorrectionSheet.tsx: edit values, pick a reason, preview balance change.
- components/ProvenanceCard.tsx: on transaction detail, shows every capture of a payment.
- components/SourceBadge.tsx: source and review-status markers (icon plus text).
- hooks/useReconcile.ts: inbox, history, provenance queries and mutations (shapes from src/lib/reconcile/inbox.ts).

## Talks to
- `GET /api/reconcile`, `GET /api/reconcile/history`, `GET|POST /api/transactions/:id/corrections`, `POST /api/transactions/:id/confirm`, `POST /api/captures/:id/resolve`, `DELETE /api/captures/:id`.
- Models: CapturedMessage, Transaction, TransactionCorrection. SSE resource `captures`.
- Mobile: Review tab (lib/features/review) uses `/api/integrations/review/*`.

## Rules and gotchas
- Business rules live in src/lib/reconcile and src/lib/capture; keep web and phone routes on those shared functions.
- Correction rows are insert-only. Transfers, split, recurring and statement/loan-linked rows return 409.

## Tests
- `src/test/integrations.test.ts` (capture ingest and reconcile, parseCapture).

## Last changed
- e19229d feat(realtime): live updates for every screen and an app event channel
