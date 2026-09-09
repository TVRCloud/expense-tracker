# Settings

`/settings` (hub) and `/settings/{profile,preferences,appearance,notifications,security,privacy,help}` (standalone)

**User story**
> As a user, I want to update my profile, currency, theme, and notification preferences from one place, so I don't have to hunt across the app to change how it looks or behaves.

**What happens here**
The hub page is an accordion (one section open at a time) over six sections, each of
which also exists as its own standalone route reusing the exact same field components —
useful for deep-linking, or if the redesign wants to split these into separate pages.

**Sections**
| Section | Route | Fields |
|---|---|---|
| Profile | `/settings/profile` | Avatar, name, email (read-only), role badge |
| Preferences | `/settings/preferences` | Currency (12 supported), week-start, region |
| Appearance | `/settings/appearance` | Light / dark / system theme |
| Notifications | `/settings/notifications` | Push enable/disable (per-device label), email toggle |
| Security | `/settings/security` | Change password |
| Privacy | `/settings/privacy` | Privacy/data controls |
| Help | `/settings/help` | Help & support links |

**Edge cases to design for**
- Redesigning a field component means redesigning it in two places at once (hub + standalone) unless they're unified further
- Push notification toggle when the browser has denied permission (needs a clear "how to re-enable" message, not a silent failure)

**Source:** `src/features/settings/components/SettingsClient.tsx`, `SettingsSubpages.tsx`
