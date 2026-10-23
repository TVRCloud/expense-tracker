# Architecture decision records

An ADR is a short note that records one decision: why it was needed, what was chosen, and what follows. It stops people (and Claude) from reversing a decision without knowing the reason.

Write one when a change picks between real options, is hard to undo, or affects several features. Do not write one for routine work. Never edit an accepted ADR to change history: add a new one and mark the old one `Superseded by ADR-000N`.

Files are `NNNN-short-title.md`. Cite the source (a doc, a code comment or a commit) so every claim can be checked.

## Template

```md
# ADR-000N: Title

Status: Proposed | Accepted | Superseded by ADR-000N
Date: YYYY-MM-DD (or the commit date)

## Context
What forced a decision. Facts only.

## Decision
What we do.

## Consequences
What gets easier, what gets harder, what to watch.

## Source
Doc, code comment or commit that records this.
```

## Index

The ADRs below were written after the fact from docs, code comments and git history. Dates are commit dates. Where the original reasoning was not written down, the ADR says so.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-realtime-via-sse-and-change-streams.md) | Realtime via SSE and MongoDB change streams | Accepted |
| [0002](0002-sms-as-source-of-truth-and-reconcile.md) | Bank SMS as source of truth, with a reconcile inbox | Accepted |
| [0003](0003-api-keys-for-integrations.md) | Per-caller API keys for the integration API | Accepted |
| [0004](0004-persistent-idempotency.md) | MongoDB-backed idempotency for integration writes | Accepted |
| [0005](0005-hash-chained-ledger.md) | Hash-chained ledger behind a TOTP-gated Logs page | Accepted |
| [0006](0006-pwa-with-serwist.md) | PWA service worker with Serwist | Accepted |
