# Offline

`/offline`

**User story**
> As a user with no network connection, I want a clear "you're offline" state instead of a broken blank screen, so I know it's not a bug.

**What happens here**
Static PWA fallback served by the service worker when there's no network and nothing
cached to show instead. Icon, "You're offline" heading, short retry message. No feature
module behind it — pure static UI.

**Source:** `src/app/(app)/offline/page.tsx`
