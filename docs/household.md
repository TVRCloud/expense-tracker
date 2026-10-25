# Household sharing

An owner shares chosen accounts (and optionally their budgets) with one other person as a viewer or an editor. Nothing about existing routes changes: every current query still filters by `user`. Sharing is a separate layer with its own routes (`/api/integrations/shares`, `/api/integrations/shared/{ownerId}/...`, and browser twins under `/api/household/...`). API contract: [api-contracts.md](api-contracts.md#household-sharing). Code: `src/lib/share-service.ts`, model `src/models/Share.ts`.

## How it works

1. The owner invites an email address with `POST /shares` (accounts, role, `includeBudgets`). The answer carries a one-time **code** (32 random bytes, base64url). Only its sha256 is stored.
2. The invitee sees the pending invite in `GET /shares` (owner name and number of accounts, never the code) and accepts with `POST /shares/{id}/accept {code}`. Accepting needs the code **and** that the caller's account email equals the invited address; the code works once.
3. While the share is `active`, the member can read the shared accounts, their transactions, a summary and (if allowed) the owner's budgets, and an `editor` can add plain income or expense rows to a shared account.
4. The owner can change accounts, role or budgets and can end the share at any time; the member can leave. Both take effect on the very next request: nothing about a share is cached.

Limits: 10 live shares per owner, 5 live shares per account, 20 accounts per share, invites expire after 7 days. Ended shares are kept 90 days (audit) and then removed by a TTL index.

## Permission matrix

| Caller | `GET shares` | invite, change, revoke | accept, decline | read shared accounts, transactions, summary | read shared budgets | add a transaction |
| --- | --- | --- | --- | --- | --- | --- |
| Owner | own shares | yes | no (404) | no: not a member of yourself (404) | no (404) | no (404) |
| Active viewer | own received shares | no (404) | no (404, already active) | yes, shared accounts only | only with `includeBudgets` | 403 `FORBIDDEN` |
| Active editor | same | no (404) | no | yes | only with `includeBudgets` | yes, shared accounts only |
| Pending invitee (right email) | sees the invite, no code | no | accept with the code, or decline | 404 | 404 | 404 |
| Stranger, wrong email, declined, revoked, expired | nothing | no (404) | 404 | 404 | 404 | 404 |

Every miss is the same `404 NOT_FOUND` with the same body, so a share cannot be told apart from one that never existed.

## Threat model

| Threat | What stops it |
| --- | --- |
| A member reads accounts that were not shared | Every shared route first calls `loadActiveShare(memberId, ownerId)` (active share, caller is the member, owner still active). Reads then use the share's account ids intersected with the owner's live, non-archived accounts, and the transaction query is constrained to `user = owner` and those accounts. An `accountId` from the client is only ever compared with that set; one outside it is a 404. Stats, summary and transfers are computed from the same set |
| A member learns about an unshared account through a transfer | A transfer to or from an account that is not shared shows no counterparty: the unshared side is `null`. Its name, id and balance never appear |
| IDOR by guessing ids | Ids are only used through the access check above; invalid ObjectIds are a 404. Share ids alone grant nothing (accept needs the code and the invited email) |
| Existence leak | Revoked, pending, expired, declined, never shared and unknown owner all answer the same 404 |
| Guessing the invite code | 256 bits of randomness, 7 day expiry, single use (the hash is removed on accept, decline, revoke and expiry), compared as sha256 hashes in constant time, 10 tries per person per 10 minutes (429 after) |
| Someone registers a partner's address first | The invitee still needs the code the owner handed out, and the owner sees who accepted (name and email) and can revoke at once |
| The code leaking from the server | Never stored (hash only), never logged, never in a notification, and kept out of the idempotency record (a retry of the invite replays the share without the code; `POST shares/{id}/code` makes a new one) |
| A viewer or a hostile editor writes | Viewers get 403. An editor can only add one plain income or expense to a shared account: the body is strict (tags, splits, recurrence, transfers, foreign amounts, unknown fields are a 400), through the owner's `createTransaction`, with the member as the ledger actor and `addedBy` on the row. No edits or deletes in this phase |
| An editor spoils the owner's data or currency | Amounts are paise of the owner's base currency (the answer says which; a base the app cannot handle is refused as for the owner). The owner's budget and spend limit alerts run as for any write, and the owner is told ("X added an expense to Joint"). The write **locks the owner's base currency** like any first money row, so an owner with no data yet who has an editor add a row can no longer change their base currency. A row an editor adds does **not** round up into the owner's goal (it is not the owner's own spending) |
| An editor acts on a share that just changed | The write re-reads the live share (active, caller is the member, role editor, account still in it) right before it runs, so a revoke, a role change or a removed account made after the request began is honoured. A small window between that read and the insert remains: at worst one row lands that the owner can delete |
| Two invites at once pass the limits | After the insert (and after an account change) the limits are counted again and the new invite is taken back when they are over; in a tie both go and the owner retries. A change to a share's accounts is written alone first and role or budgets only after the check passes, so a refused change never grants more access; the undo only reverts what that request wrote and is retried once. The limits are never exceeded for good |
| The owner probing who is registered | A pending invite shows the typed address and no name, whether or not it is registered. A name appears only after the person accepts |
| Private data in shared rows | The shared transaction answer is a fixed whitelist: id, account, type, amount, category, subcategory, description, date, transfer side (if shared), who added it. Never the owner's notes (they can be private), tags, attachments or receipts, capture messages, sources, API keys, backups or settings. An editor can still write a note on a row they add; it is kept on the owner's row but not shown back in the shared list |
| Budgets reveal more than the shared accounts | Only with `includeBudgets`, which the owner turns on knowing that budget totals count the owner's spending in that category across all their accounts (the invite screen says so) |
| Data streaming to someone who should not get it | No realtime resource is added: shared data is never pushed to a member (they refresh). The owner and the member learn about invites, accepts, revokes and editor writes through ordinary in-app notifications (`type: system`, `meta.kind: household_*`) |
| Account deletion leaves a share behind | `DELETE /api/me` ends every share the person owns or belongs to, and pending invites addressed to their email (so a later owner of the freed address cannot use an old code) (before locking the account, and once more last for an invite accepted by a request already running). A deactivated owner stops being readable at once (`loadActiveShare` checks `isActive`) |
| Backups | Shares are not part of a backup (sharing must be re-created after a restore), and a backup contains only the caller's own rows: `addedBy`, other people's emails and invite hashes are not in the payload |

Out of scope: streaming the owner's data to members, shared tags or receipts, member edits and deletes, transfers by editors, per-category sharing, roles beyond viewer and editor, sending invites by email (the owner gives the code to the person).
