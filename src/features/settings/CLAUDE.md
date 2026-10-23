# Settings
Purpose: profile, preferences, appearance, notifications, security, API keys, privacy, help, and the `/account` page. Page specs: [docs/pages/10-settings.md](../../../docs/pages/10-settings.md), [11-account.md](../../../docs/pages/11-account.md).

## Files
- components/SettingsClient.tsx, SettingsRow.tsx, SettingsUi.tsx: frame, rows, grouped-section primitives.
- components/SettingsSubpages.tsx: every `/settings/*` subpage and its fields.
- components/AccountClient.tsx, ProfileCard.tsx, BalanceBanner.tsx: `/account` page pieces.
- components/ApiKeysSection.tsx: mint and revoke keys; raw key shown once.
- timezones.ts: IANA zone list for the Time zone picker in Currency & Region (same `isValidTimeZone` check as the server).
- hooks/useProfile.ts (`["me"]`), useApiKeys.ts (`["api-keys"]`), usePushNotification.ts (`["push-status"]`).

## Talks to
- `/api/me`, `/api/me/password`, `/api/me/preferences`, `/api/me/export`, `/api/me/api-keys`, `/api/push/{status,subscribe,unsubscribe,test}`.
- Models: User, ApiKey, PushSubscription, Session. Mobile: Connect screen consumes a key minted here.

## Rules and gotchas
- Creating a key needs the password again; the raw key is returned once ([docs/n8n-integration.md](../../../docs/n8n-integration.md)).
- `DELETE /api/me` soft-deletes: email is tombstoned and sessions end.
- `preferences.timezone` sets where a day starts for spend limits (default `Asia/Kolkata`); the server rejects an unknown zone.
- Updating the profile updates the cache so `useCurrency()` reflects the change at once.

## Tests
- `src/test/integrations.test.ts` (`/api/me/api-keys`, time zone preference); `timezones.test.ts`.

## Last changed
- 10a7ed0 feat(ui): Apple-style redesign with full-width responsive layouts
