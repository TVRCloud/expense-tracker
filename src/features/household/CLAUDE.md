# Household
Purpose: share accounts (and optionally budgets) with a partner or family member as a viewer or an editor, accept an invite you received, and look at what someone shared with you (read only).

## Files
- components/HouseholdClient.tsx: `/household` page: "Shared with you" (pending invites with a code field and Accept or Decline; active shares with View and Leave), a read-only view of an owner's shared accounts and recent rows, "Shared by you" (role select, budgets switch, New code, Stop sharing or Cancel invite), and the invite form (email, account switches, role, include budgets with a note that budget totals cover all your accounts). The one-time code is shown once in a copy box.
- hooks/useHousehold.ts: query keys `["household", ...]`; `useShares`, `useSharedAccounts`, `useSharedTransactions`, `useInvite`, `useUpdateShare`, `useEndShare`, `useNewCode`, `useAcceptInvite`, `useDeclineInvite`.

## Talks to
- `/api/household/shares*` and `/api/household/shared/[ownerId]/accounts|transactions` (browser routes over src/lib/share-service.ts); `GET /api/accounts` for the account switches. Mobile: planned (TVRCloud/expense-tracker-mobile#65).

## Rules and gotchas
- Amounts are minor units of the owner's base currency (`currency` in the answer), shown with `formatMinor`.
- The web shared view is read only; editors add rows from the phone app. Realtime does not stream shared data: the page refetches on mutations and focus.
- Never show or store the invite code beyond the box that displays it. A pending invite for you is listed without a code; the person who invited you hands it over.
- Sidebar (Planning), command palette and `route-titles.ts` carry the `/household` entry.

## Tests
- Server side only: `src/test/household.test.ts`.

## Last changed
- feat(household): share accounts with a partner, viewer or editor
