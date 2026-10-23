# Admin
Purpose: admin-only user list with role and active-status edits. Page spec: [docs/pages/12-admin-users.md](../../../docs/pages/12-admin-users.md).

## Files
- components/AdminUsersClient.tsx: `/admin/users` table, search, role and status toggles.

## Talks to
- `GET /api/users`, `PATCH /api/users/:id` (both `requireAuth(["admin"])`).
- Models: User, Session.

## Rules and gotchas
- Changing a user's role or `isActive` ends all of that user's sessions (server, src/app/api/users/[id]/route.ts). A name-only edit does not.
- Admin-only is enforced by the API (`requireAuth(["admin"])`). The page wraps itself in `RoleGuard`, which only hides UI. There is no `src/app/(app)/admin/layout.tsx`, although [docs/authentication.md](../../../docs/authentication.md) describes one.
- No mobile counterpart.

## Tests
- None.

## Last changed
- 10a7ed0 feat(ui): Apple-style redesign with full-width responsive layouts
