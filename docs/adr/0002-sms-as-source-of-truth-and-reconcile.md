# ADR-0002: Bank SMS as source of truth, with a reconcile inbox

Status: Accepted
Date: 2026-09-26 (introduced), 2026-09-30 (bank-name matching)

## Context
The same payment can arrive through the phone's SMS receiver, a bank-app notification, and n8n forwarding SMS text. The earlier design had a review queue with a 30-day TTL (`sms_review_items`) and a 24-hour idempotency window. `docs/reconcile.md` describes the rules that replaced it.

## Decision
- Rank channels: `sms` (3, source of truth), `n8n` (2), `notification` (1, fallback only).
- Store every message in `captured_messages`, text encrypted, nothing expires. Dedupe on a permanent unique hash of the normalized text.
- Hold a notification as `pending_sms` for 15 minutes; if the SMS arrives, use the SMS values.
- A late SMS replaces an unreviewed lower-priority transaction (recorded as a `sms_override` correction). If the user already reviewed it, queue a `source_conflict` for them to settle.
- Auto-create only at parser confidence of 0.8 or more with a matched account; otherwise queue with a reason.
- Users confirm, correct or void in Reconcile. Every correction is an insert-only `transaction_corrections` row.
- Match accounts by saved last digits first, then by bank and instrument when exactly one account fits.

## Consequences
- One ingest path (`src/lib/capture/ingest.ts`) serves phone and n8n; routes only validate.
- Promotion of held notifications needs a trigger: `server.ts` timer, `GET /api/cron/promote-captures`, or lazy runs on upload and inbox reads.
- Needs `CAPTURE_ENCRYPTION_KEY` in every environment; without it capture endpoints return 500.
- Corrections to transfers, split, recurring and statement- or loan-linked rows are refused with 409.

## Source
`docs/reconcile.md`; commits e08c36f "app support" and 52f3dea "feat(capture): match bank SMS to an account by bank when no digits are saved"; `src/models/CapturedMessage.ts` header comment.
