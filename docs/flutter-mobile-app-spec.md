# Flutter Companion App — Spec

Status: draft, for a companion Android app that reads bank SMS/notifications and forwards them
to this backend. Backend-side changes required by this spec will be implemented by this
repo's maintainer (Claude) so the API contract stays authoritative; the Flutter client itself
is built separately.

## 1. Purpose

Android-only companion app. Listens for bank transaction SMS/notifications on the phone,
forwards the raw text to this backend, and lets the parsed result show up as a transaction
(or, if unparseable, a review item) in the existing web app. It is **not** a full reimplementation
of the web app — no local parsing of bank formats, no local ledger of truth. The phone is a sensor;
this backend is the source of truth.

Minimal scope, v1: this is a capture-and-forward utility, not a mobile rebuild of the web app.
No transactions list, no budgets/goals/loans screens, no analytics. If the user wants to browse
their finances, they open the web app. The phone app's only job is: capture → forward → show
that it's working.

iOS is out of scope — iOS does not allow third-party notification/SMS access.

## 2. Existing backend surface to reuse (do not reinvent)

This backend already has an external-integration API designed for exactly this kind of
caller: `/api/integrations/*`, currently used by n8n (see `docs/n8n-integration.md`). The
Flutter app should authenticate and call the same way, not through the browser's cookie-session
routes.

- Auth: `Authorization: Bearer <API_KEY>` header, verified in `src/lib/integrations/auth.ts`
  with a timing-safe comparison.
- Every response: `{ success, requestId, data }` on success, `{ success: false, requestId, error: { code, message } }` on failure.
- Rate limited per route (`N8N_RATE_LIMIT` / `N8N_RATE_WINDOW_MS`), plus a fixed
  10-failed-auth-attempts-per-10-minutes-per-IP lockout.
- Idempotency via `Idempotency-Key` header — required on write endpoints in general, **optional**
  on the SMS endpoint (see below).

### 2.1 Primary endpoint: `POST /api/integrations/sms`

This is the one call that matters for the core feature. Forward the raw notification/SMS text
verbatim — do not parse bank formats client-side.

```
POST /api/integrations/sms
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "text": "<raw SMS or notification body, max 2000 chars>",
  "receivedAt": "<ISO 8601, optional>"
}
```

Server-side parser (`src/lib/integrations/sms-parser.ts`) currently recognizes:
- Credit card spend alerts → creates an expense transaction, matched to an account by last-4 digits.
- Loan EMI payment confirmations → creates a repayment, matched by lender loan ID.

Anything else is queued into a review list (`sms_review_items`), and the user gets a normal
in-app notification to resolve it manually — the phone app does not need to handle that case at all.

Responses:
- `201 { data: { status: "created", kind: "transaction" | "repayment", id, isSettled? } }`
- `202 { data: { status: "queued", reviewItemId } }`
- `4xx/5xx` per the standard error envelope above.

Idempotency: if `Idempotency-Key` is omitted, the server hashes the message text itself, so
re-forwarding the same SMS is naturally deduped. Prefer omitting the header unless the app
needs a stronger guarantee (e.g. keyed off the Android notification's own ID).

### 2.2 Only other endpoint needed: `GET /api/integrations/summary`

Server-cached 5 min. Used purely to show a one-line "current balance" on the app's single
screen, so the user gets a sanity check that captured SMS are actually landing. Nothing else
under `/api/integrations/*` is needed for v1 — no accounts list, no transactions list, no
budgets/goals.

There is currently no integrations endpoint to review/discard queued SMS review items —
that only exists on the session-cookie route (`GET/DELETE /api/sms-review[...]`). Out of scope
for v1: unmatched SMS just sit in the review queue and the user resolves them from the web app,
same as they do for n8n-sourced ones today. No mobile UI for this.

## 3. Auth model — done, backend-side

Implemented: `/api/integrations/*` now authenticates against an `api_keys` collection
(`src/models/ApiKey.ts`), not the old single-env-var scheme. n8n and the mobile app each get
their own independently-revocable key, minted with:

```
yarn api-keys create --label mobile --email <the app's user account email>
```

This prints the raw key once (not recoverable afterwards) — put it straight into the Flutter
app's secure storage (see §4), it's the only value the app needs to authenticate. Revoke a lost
phone's key with `yarn api-keys revoke --id <apiKeyId>` — this does not affect n8n's key.
Rate limiting is per-key, so the phone and n8n never compete for the same quota. Full detail:
`docs/n8n-integration.md`.

## 4. Client-side security requirements (for the Flutter build)

These apply regardless of who builds the Dart code — call them out explicitly to Gemini:

- Store the API key in `flutter_secure_storage` (Android Keystore-backed), never
  `SharedPreferences`, never hardcoded in source, never committed to the app's repo.
- Never log the raw SMS/notification text or the API key — not to console, not to any
  crash-reporting/analytics SDK. Raw SMS text is financial PII.
- All calls over HTTPS only; no cleartext traffic exception in `AndroidManifest.xml`.
- Request `RECEIVE_SMS`/`READ_SMS` or the notification-listener permission with a clear
  in-app rationale before prompting the OS dialog — Play Store review requires this for
  financial apps and will reject otherwise.
- Notification-listener/SMS-receiver service should filter to known bank/NBFC sender IDs
  before ever forwarding text, to avoid leaking unrelated personal messages to the backend.
- Retry/backoff on `429`/`5xx` — do not hammer the endpoint; respect `Retry-After` if present.
- On `401`, stop and surface a "reconnect account" state — don't retry with a stale key in a loop.

## 5. Design system to mirror (for the few screens that exist)

Source of truth: `src/app/globals.css`.

- Typography: Plus Jakarta Sans for UI/body text; JetBrains Mono for all money figures
  ("ledger precision" — every amount in the app, anywhere, uses the mono font).
- Color roles, not literal hex reuse — pull actual values from `globals.css` `@theme inline`
  block at build time so light/dark stay in sync with the web app:
  - Functional/neutral UI surfaces: near-black/charcoal (light) / silver (dark) — despite the
    CSS variable being named `--violet`, it is not purple, it's neutral. Don't theme the mobile
    app purple based on the variable name.
  - Gold/amber accent reserved strictly for hero touchpoints — primary balance figure, main FAB,
    active tab indicator. Not used as a general accent color.
  - Income green / expense red are WCAG-AA tuned in the source — reuse those exact values,
    don't reinvent.
- Radii: large cards ~26px, medium ~18px, small ~13px (smaller on compact/mobile widths).
- Signature surface treatment: "liquid glass" cards — background blur (~22px) + saturation
  boost (~160%) + soft border/shadow, used on card surfaces only. Do not apply glass to full-screen
  backgrounds or gradients/blobs — the web app deliberately keeps the base background flat/solid
  and confines glass to card surfaces.
- Component inventory needed (small): buttons, one card style, badges/status pill, switch,
  skeleton loading state. That's it — no tables, no calendar/date picker, no tabs.

## 6. Screens (v1, minimal)

Two screens only:

1. **Home** — one glass card: current balance (`GET /summary`, mono digits, count-up on
   change), connection status pill (API key valid / capture service running), a short log of
   the last ~10 captures with a one-word outcome each (`created` / `queued for review` /
   `failed`) so the user can tell at a glance that things are working. No tap-through detail,
   no editing.
2. **Settings** — API key (masked, paste-to-set, stored in secure storage), notification-listener
   permission toggle/status, SMS-receiver permission toggle/status, theme (light/dark/system).

Everything else from the earlier full-parity draft (transactions, accounts, budgets, goals,
loans, notifications center, analytics, admin, logs) is **cut** for v1. Revisit only if this
minimal version proves the capture pipeline works and more is actually wanted.

## 7. Animation guidance

Keep motion purposeful, not decorative — matches the "ledger precision" tone, not a playful
consumer-fintech feel:

- Balance figure and any amount that changes (after a new SMS-derived transaction lands):
  animate the digit roll/count-up, not a generic fade — reinforces "a real number just changed."
  Use monospace tabular figures so digit width doesn't jitter mid-animation.
- List insertion (new transaction arriving from a background SMS parse): insert with a brief
  highlight/glow on the new row, then settle — the point is to make it obvious something arrived
  in the background without the user doing anything.
- Card open/close (glass surfaces): scale + blur transition rather than a hard cut, consistent
  with the glass material.
- Avoid bouncy/springy overshoot on financial figures specifically — overshoot reads as playful
  and undermines trust in a number; reserve spring physics for structural nav (page/tab
  transitions), not for values.
- Respect `prefers-reduced-motion` equivalent (Android "remove animations" accessibility
  setting) — disable count-up/glow, keep instant state changes.

## 8. Backend status

Done — the `api_keys` auth change in §3 is implemented, tested (`npm run test`,
`src/test/integrations.test.ts`), and documented in `docs/n8n-integration.md`. Nothing else on
the backend blocks starting the Flutter build: `POST /api/integrations/sms` and
`GET /api/integrations/summary` are live and stable. Mint a mobile key (§3) whenever ready to
point the app at real data instead of mocks.

Still assumed for v1 unless you say otherwise: single-user model (one account, multiple
independently-revocable keys) is sufficient — no per-mobile-user auth/login flow needed.
