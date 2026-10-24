# Encrypted backup and restore

A private copy of one person's data that they can keep anywhere and restore after a phone change or a server move. Integration routes only (`/api/integrations/backup`, `/api/integrations/backup/restore`); API contract in [api-contracts.md](api-contracts.md#backup-and-restore).

## Threat model

| Threat | What stops it |
| --- | --- |
| Someone gets the backup file (cloud drive, shared phone, email) | AES-256-GCM under a key from the person's passphrase (scrypt, N=131072, r=8, p=1, 128 MiB of memory per derivation, random 16 byte salt, random 12 byte IV). Nothing readable in the file besides the format, version, time it was made and the KDF settings. The passphrase is the only protection: at least 12 characters is enforced, a few random words is better, and a stolen file can be guessed against offline (roughly a third of a second per try on one core). There is no recovery if the passphrase is lost |
| The file is changed (or a different file is swapped in) | GCM tag over the ciphertext, and the header (format, version, time, KDF cost, salt, IV) is bound to it as additional data. A wrong passphrase, a flipped bit anywhere and a changed header all give the same answer (`reason: unreadable`), so the server is not a guessing oracle for which part was wrong |
| A hostile file sent to restore | The body is size bounded before it is read (24 MiB of encrypted data), the body is counted as it streams in and cut off past the cap (a missing or false Content-Length does not help), the KDF cost must equal exactly the one the file's version allows (a file cannot ask for a huge cost), the unpacked text is capped at 48 MiB (compression bomb), every field is checked by a strict whitelist schema (types, lengths, enums, money range, `http(s)` links only, list caps), unknown fields and any `user`, role or `deletedBy` in the file are dropped, a reference to a row that is not in the file rejects the whole file |
| Restore used to touch another person's data | Every restored row is owned by the caller; the file's ids are only used if no row has them, and a row id held by someone else gets a fresh id. Nothing is updated or deleted, so no other user's row can be overwritten |
| Restore used to wipe or corrupt your own data | Merge only: rows already there (same id, or same budget month and category, rule or subscription choice) are kept as they are and skipped. There is no replace mode. A dry run shows the counts first and writes nothing |
| Secrets leaking into a backup | Left out by construction (the export is a whitelist): API keys, sessions, the password hash, push subscriptions, raw captured messages, notifications, the hash-chained ledger, card statements and net worth history. The server's `CAPTURE_ENCRYPTION_KEY` is never read |
| Guessing the passphrase through the API | Hard limits per person per 10 minutes, counted atomically: 40 requests (checked before the body is read), 6 exports, 12 real restores and 30 dry runs (a dry run never uses up the restores) on top of the normal per-key limit; at most two key derivations at once per server process, a short queue behind them, and a 429 (`reason: busy`) beyond that |
| The passphrase leaking from the server | Sent in the POST body only (never in a URL), used for one call, never stored, never logged (the route logger records route and status only), not part of the idempotency fingerprint |

Out of scope: someone who has the person's API key and passphrase is the person; a compromised server sees data in the clear while it builds or opens a backup.

## Format

A JSON file. New files are version 2; version 1 (scrypt N=65536, made before the cost went up) still opens, because its lower cost stays on the whitelist, so an older backup restores. A file cannot mix the two (a version 1 header with the version 2 cost is refused). Shape:

```
{ "format": "expense-tracker-backup", "v": 2, "createdAt": ISO,
  "kdf": {"name": "scrypt", "N": 131072, "r": 8, "p": 1, "salt": base64(16)},
  "cipher": {"name": "aes-256-gcm", "iv": base64(12), "tag": base64(16)},
  "ciphertext": base64 }
```

The plain text is gzip of `{app: "expense-tracker", version: 1, createdAt, data}`. `data` has `accounts`, `transactions`, `budgets`, `goals`, `loans`, `repayments`, `rules`, `sinkingFunds`, `subscriptionDecisions`, `manualAssets` and `spendLimit` (one or null). Soft deleted rows are not included, except soft deleted accounts: they go in (still marked deleted) because live balances include transfers to and from them and their transactions need something to belong to. Amounts stay integer paise. Rows are written by `id`, with references by id.

## Restore rules

- Ids: a row keeps the file's id when no row has it. If someone else holds it, the row gets an id worked out from (the caller, the kind of row, the file's id), the same every time, so running the same restore again finds those rows and skips them instead of copying them. A recurring series or split group id that another person's rows already use is replaced the same way, so a restored row never joins a series that is not the caller's; the monthly top-up of open-ended series is also scoped to one person's rows.
- Rows that already exist here and sit in the trash (soft deleted) count as existing and are skipped, not brought back; the report says `N rows in the backup already exist in your trash and were not restored.`
- Order: accounts, loans, goals, budgets, rules, funds, assets, subscription choices, transactions, repayments, so every reference points at a row that exists.
- Rows are inserted directly, not replayed through the services: balances and remaining amounts come back exactly as they were in the file. If a transaction is added to an account that already exists here (a merge, not a new phone), that account's balance is not recalculated; the response says so in `warnings`.
- A restore is not one transaction (the app has no database transactions). If it stops half way, run it again: rows already written are kept and skipped, and the rest are added.
- Restored rows do not enter the audit ledger (`/api/logs/ledger`), which only records writes made through the app.
- Limits: 1,000 accounts, 50,000 transactions, 50,000 repayments, 20,000 budgets, 5,000 loans and subscription choices, 2,000 goals and rules, 1,000 funds and assets. A person above a limit cannot make a backup until we raise it (the error says which). Vercel functions accept at most 4.5 MB of request body, so a large restore needs the self-hosted server.

Code: `src/lib/backup-crypto.ts` (format, KDF, cipher), `src/lib/backup-service.ts` (what is exported, the schemas, restore), `src/lib/integrations/backup-http.ts` (bounded body, rate limit), routes under `src/app/api/integrations/backup/`. Tests: `src/test/backup.test.ts`.
