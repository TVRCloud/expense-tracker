# Anomalies
Purpose: unusual-spend alerts on the web: the list with a way to answer each one (this was me, report, dismiss), a mute for the category, and the switch for the whole feature.

## Files
- components/AnomaliesClient.tsx: `/alerts` page: the settings card (switch, muted category chips, a field to mute another), a Waiting / All tab, and one row per alert with a plain sentence built from the numbers the rule kept (`describe`), and the answer buttons. Report only shows for alerts about an expense; it tags the expense `anomaly-reported` and no answer ever removes the tag, the person does (the answer's `tagged` says whether the tag is on; a loan or card payment row, or ten tags already, refuses it and the toast says "Reported, not tagged").
- hooks/useAnomalies.ts: `useAnomalies(status)` (key `["anomalies", status]`), `useAnomalySettings()` (`["anomalies", "settings"]`), `useAnswerAnomaly()`, `useChangeAnomalySettings()` (sends `{enabled}`, `{add}` or `{remove}`, refetches on settle).

## Talks to
- `GET /api/anomalies`, `PATCH /api/anomalies/:id`, `GET` and `PATCH /api/anomalies/settings`; the app uses `/api/integrations/anomalies` (TVRCloud/expense-tracker-mobile#69).
- Libs: src/lib/anomaly-rules.ts, anomaly-service.ts, anomaly-settings.ts. Model: Anomaly; settings on `User.preferences.anomalies`.

## Rules and gotchas
- Alerts are on by default for every account; the switch is the first card on the page.
- Alerts are created on the server when an expense is created, never from this page. The rules, thresholds and what is not checked are in [docs/api-contracts.md](../../../docs/api-contracts.md#anomaly-alerts).
- Amounts are minor units of the base currency, shown with `formatMinor` and the alert's own `currency`.
- Muting sends one name (`add`), not the whole list, so two changes cannot overwrite each other.
- Realtime resource `anomalies` (and the notification it comes with) invalidates the `["anomalies"]` keys.

## Tests
- `src/lib/anomaly-rules.test.ts` (rule boundaries), `src/test/integrations.test.ts` ("anomaly alerts"), `src/test/backup.test.ts` (alert settings in a backup).

## Last changed
- feat(anomalies): unusual-spend alerts with rules, answers, mute and a web page
