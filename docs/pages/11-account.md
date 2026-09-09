# Account

`/account`

**User story**
> As a user, I want a quick summary of my total balance and profile, and a clear way to sign out or permanently delete my account, separate from the deeper settings menu.

**What happens here**
A profile-first summary page, distinct from `/settings` — total balance banner, profile
card, settings-style navigation rows, sign-out, and the destructive delete-account flow.

**Key elements**
- Total balance banner
- Profile card
- Settings-style nav rows (shortcuts into `/settings/*`)
- Sign out
- Delete account (confirm dialog copy: "signs you out everywhere and blocks future logins")

**Edge cases to design for**
- Delete-account confirm needs to read as genuinely irreversible — this is the one place on the "Auto-Clarity" list where compressed/casual copy is the wrong call
- Overlap with `/settings/profile` — decide during redesign whether these two pages should merge

**Source:** `src/features/settings/components/AccountClient.tsx`
