# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

No release tags exist in this repo yet, so entries are grouped by the dates of the merged pull requests and commits in `git log`. The app version in `package.json` is `0.1.0`. Newest first. Hand-curated; keep each line short.

## [Unreleased]

### Added
- Documentation: docs index, feature map, ADRs, per-directory `CLAUDE.md` files, doc check script, this changelog (#55).

## 2026-10-16

### Added
- Live updates on every screen over SSE, plus an event stream and a polling endpoint for the mobile app: `GET /api/integrations/events` and `GET /api/integrations/changes` (#50).
- App-update endpoints for the Android companion: `GET /api/integrations/app-update` and `.../download` (#49).
- GitHub issue forms and a pull request template (#52, #54).

### Changed
- Apple-style redesign with full-width responsive layouts.
- Hard-delete events are no longer broadcast to every user; mutations also refresh budgets, analytics, notifications and upcoming installments.

## 2026-09-30

### Added
- Bank SMS is matched to an account by bank and instrument when no last digits are saved; accounts accept SMS match digits.
- `GET /api/integrations/home`: accounts, month stats, latest transactions and review counts in one request.

### Changed
- Dashboard is server-rendered with its first data.
- Fewer round trips and full scans on home-screen reads; API-key and session checks are cached for 30 seconds.
- Apple-style polish pass on the web app.

### Fixed
- Paid recurring installments without a payment date were missing from monthly stats.

## 2026-09-26

### Added
- Support for the Flutter companion app: capture upload, source priority, reconcile inbox with corrections, phone review routes (#42, #43, #44).

### Removed
- Sentry (the SDK, build wrapper and tunnel route).

### Changed
- shadcn/ui updated to the latest new-york, Tailwind v4 set.

## 2026-09-05 to 2026-09-17

### Added
- n8n integration API under `/api/integrations/*` with API keys, idempotency, rate limits and a bank SMS endpoint (#28 series, PRs #29 to #40).
- Public landing page.
- Serwist-based service worker (replacing the earlier PWA setup).

### Fixed
- Security fixes and API optimisation (September 9 commits); notification fix; UI bug fixes.

## 2026-08-06

### Removed
- socket.io; realtime moved off the custom socket server.

### Fixed
- Push notification bugs.

## 2026-07-08 to 2026-07-09

### Fixed
- Recurring salary payment handling (#16, #22).
- Icon inconsistency and a related bug (#18).

### Added
- Sentry (#20; removed on 2026-09-26).

## 2026-06-05 to 2026-06-10

### Added
- First version: expense tracking, accounts, budgets, goals, loans, analytics, notifications, push, PWA.
- Hash-chained ledger and the OTP-protected Logs page (#4).
- Credit-card billing cycles and statements (#8).
- New UI and UI/UX improvements (#13).

### Changed
- Amount calculations fixed and new features added (#10).

### Fixed
- Security patch (#6).
- Realtime data and PWA push notifications (#14).
