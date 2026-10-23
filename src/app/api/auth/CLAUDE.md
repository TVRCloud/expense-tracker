# API: auth
Purpose: NextAuth endpoint plus register and password-reset routes.

## Files
- [...nextauth]/route.ts: NextAuth handler using `authOptions` (src/lib/auth-options.ts).
- register/route.ts, forgot-password/route.ts, reset-password/route.ts.

## Talks to
- Libs: auth-options, email, log-security, security-rate-limit, config.
- Models: User (plus Session through NextAuth callbacks).
- UI: src/features/auth. Mobile: none.

## Rules and gotchas
- Credentials login, JWT sessions, a `jti` per sign-in stored in the `Session` model. Full flow: [docs/authentication.md](../../../../docs/authentication.md). The doc calls the model `UserSession`; the code model is `Session`.
- Forgot-password always answers 200; the reset URL is never logged.
- Register releases an email left by a self-deleted account.
- Browser routes call `requireAuth()` (src/lib/auth-guard.ts); integration routes do not.

## Tests
- None specific.

## Last changed
- 8fb24ce deleted acc email lock
