# API: users
Purpose: admin user management.

## Files
- route.ts: `GET` list with search. [id]/route.ts: `GET`, `PATCH` role, active flag, name.

## Talks to
- Libs: regex (`escapeRegExp`), perf/session-cache, integrations/auth (forget keys).
- Models: User, Session. UI: src/features/admin.

## Rules and gotchas
- All handlers use `requireAuth(["admin"])`.
- Changing role or `isActive` ends the user's sessions and drops cached API keys; a name-only edit does not.
- Search text is regex-escaped before use.

## Tests
- None.

## Last changed
- 0ed47fb perf: cut round trips and full scans on home-screen reads
