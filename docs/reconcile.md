# Capture and reconcile

How bank messages become transactions, how the same payment arriving on several channels is kept to one entry, and how a person confirms or fixes what was captured.

Code: `src/lib/capture/*` (ingest, parsers, source priority), `src/lib/reconcile/*` (corrections, inbox, actions). Tests: `src/test/integrations.test.ts` › `parseCapture`, `capture ingest and reconcile`.

## Sources and priority

| Channel | Sent by | Priority | Meaning |
|---|---|---|---|
| `sms` | Android app, SMS receiver | 3 | **Source of truth** |
| `n8n` | n8n forwarding SMS text (`POST /api/integrations/sms`) | 2 | SMS text, used when the phone didn't capture it |
| `notification` | Android app, bank-app notification listener | 1 | Low-priority fallback only |

Every message is stored in `captured_messages`. The raw text is encrypted with `CAPTURE_ENCRYPTION_KEY`, and nothing in the collection expires. Transactions carry:
- `source`: which channel their values came from
- `sourceCapture`: the message in use
- `captures[]`: every message linked to the payment
- `reviewStatus`: `unreviewed | confirmed | corrected | voided`, or null for manual entries

## Ingest rules

1. **Same text again, from any channel, at any time:** `duplicate`. Matched by the unique content hash of the normalized text, so there is no 24h idempotency window.
2. **OTP, offer, due reminder, collect request:** `ignored`.
3. **Bank notification with no SMS yet:** held as `pending_sms` for 15 minutes.
   - If the matching SMS arrives in that time, the transaction uses the **SMS values**. The notification is kept as a `supporting` record.
   - If no SMS arrives, it becomes a transaction with `source: notification`, labelled "lower priority, verify".
   - Promotion runs on the `server.ts` timer, on `GET /api/cron/promote-captures`, on the daily cron, and lazily on every upload and inbox read.
4. **SMS arrives for a payment already created from a lower-priority source:**
   - If the transaction is unreviewed, the SMS **replaces** its values. This is a system `sms_override` correction, so the old values stay on record.
   - If the user already confirmed or corrected it, the SMS never overrides silently. It is queued as `source_conflict` for the user to settle with "Keep mine" or "Use SMS values".
5. **Lower- or equal-priority copy of an existing payment:** `duplicate`. Its values are never used.
6. **Can't be sure it's the same payment** (account unknown on one side, no bank ref): queued as `possible_duplicate`. The user answers "Same payment" or "It's separate".
7. **Parsed with confidence ≥ 0.8 and the account matched:** created as `unreviewed`. Otherwise queued with one of these reasons: `unparsed`, `low_confidence`, `no_matching_account`, `no_matching_loan`.

**Which messages count as the same payment:**
- Same direction and amount, or the same bank/UPI ref.
- A different channel.
- Accounts that don't conflict.
- Close in time:
  - within 10 minutes when both messages state a time
  - otherwise the same IST day, so a delayed SMS still matches
- Different refs always mean different payments.
- Two messages from the same channel are never merged. Two ₹200 coffees stay two transactions.

**Account matching:**
- The message's last 4 digits (`A/c XX1234`, `card ending 1234`) are compared against `Account.smsLastFour` (set on the account page as "SMS match digits") and `creditMeta.lastFourDigits`.
- If two accounts share the same digits, nothing is guessed.
- No account has the digits: the bank (from the text, e.g. "HDFC Bank", or the sender code, e.g. `VM-HDFCBK`) and the instrument ("A/C" means a bank or savings account, "Card" a credit card) narrow the user's accounts by name and type. If exactly one account of that bank and kind is left and it has no other digits saved, it is used (`accountMatch: "bank"` on the capture). Otherwise the message is queued as `no_matching_account` with a `suggestedAccountId` to preselect. See `src/lib/capture/account-match.ts`.
- Confirming a bank-matched transaction, or correcting its account, saves the digits on that account (unless another account already uses them), so the next message matches by digits. Digits can also be entered when creating a bank or savings account.

## Corrections

`correctTransaction` (`src/lib/reconcile/correct.ts`):
- **Can change:** amount, type (debit/credit), account, date, category, description.
- **Refused with 409:** transfers, split, recurring, and statement- or loan-linked rows.
- **Balances:** the old balance effect is reversed and the new one applied, each with an atomic `$inc` per account. Every write is also added to the ledger chain.
- **Record:** each fix writes a `transaction_corrections` row with before and after snapshots, changed fields, reason, note, `via` (`web | mobile | system`), balance effects, and the ledger sequence. These rows are never updated or deleted.
- **Voiding:** the reasons `duplicate` and `not_a_transaction` void the row (balance reversed, soft-deleted, `reviewStatus: voided`). The original values are kept in the correction.

## API

Web routes use the session. Phone routes use the Bearer key and require `Idempotency-Key` on every mutation.

| Action | Web | Phone |
|---|---|---|
| Upload a capture | — | `POST /api/integrations/captures` `{text, channel: sms\|notification, sender?, packageName?, receivedAt, alsoSeenIn?}` |
| n8n SMS | — | `POST /api/integrations/sms` `{text, receivedAt?}` |
| Inbox | `GET /api/reconcile` | `GET /api/integrations/review` |
| One transaction's provenance + corrections | `GET /api/transactions/:id/corrections` | `GET /api/integrations/review/transactions/:id` |
| Confirm ("Looks right") | `POST /api/transactions/:id/confirm` | `POST /api/integrations/review/transactions/:id/confirm` |
| Correct / void | `POST /api/transactions/:id/corrections` `{changes, reason, note?}` | `POST /api/integrations/review/transactions/:id/corrections` |
| Act on a queued message | `POST /api/captures/:id/resolve` `{action: create\|link\|keep_mine\|use_sms, …}` | `POST /api/integrations/review/captures/:id/resolve` |
| Discard a queued message | `DELETE /api/captures/:id` | `DELETE /api/integrations/review/captures/:id` |
| Correction history | `GET /api/reconcile/history` | `GET /api/integrations/review/history` |

**Upload response statuses** (`data.status`):
- `created` (201)
- `updated` (200, it replaced lower-priority values)
- `queued` (202, with `reason`)
- `pending` (202, a notification waiting for its SMS)
- `duplicate` (200)
- `ignored` (200, with `reason`)

## Setup

1. Add `CAPTURE_ENCRYPTION_KEY` (at least 32 characters, e.g. `openssl rand -base64 48`) to every environment. Without it, the capture endpoints return 500.
2. Run `yarn migrate:captures` once. It copies pending `sms_review_items` into the new inbox and backfills `source: sms` from old `source:sms` tags.
3. On Vercel, schedule `GET /api/cron/promote-captures` every 5 minutes with `Authorization: Bearer $CRON_SECRET`, for example from an n8n Schedule node. The daily Vercel cron and lazy promotion cover it otherwise, just less promptly.

## Suggested n8n "Format SMS Reply" update

The live workflow replies "added to your review queue" for every non-`created` status. Suggested code for that node. It hasn't been applied; change it in n8n when ready.

```js
const result = $json;
if (!result.success) throw new Error(result.error?.message || 'Failed to process SMS');
const d = result.data;
const replies = {
  created: d.kind === 'repayment'
    ? '✅ Logged that as an EMI repayment.' + (d.isSettled ? ' Loan fully settled 🎉' : '')
    : '✅ Logged that as a transaction. Check it in Reconcile when you get a moment.',
  updated: '🔄 Updated an existing transaction with this SMS (SMS is the source of truth).',
  duplicate: '👍 Already have this one, nothing added.',
  ignored: 'ℹ️ Not a transaction (OTP, offer or reminder), ignored.',
  queued: "📥 Couldn't match this automatically. It's in Reconcile for you to check.",
};
return [{ json: { success: true, reply: replies[d.status] ?? replies.queued } }];
```
