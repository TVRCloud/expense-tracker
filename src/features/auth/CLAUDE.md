# Auth (UI)
Purpose: login, register, forgot and reset password screens. Specs: docs/pages/14-login.md to 17-reset-password.md ([index](../../../docs/README.md)).

## Files
- components/AuthShell.tsx: shared glass card and field layout for every auth screen.
- components/LoginForm.tsx: uses NextAuth `signIn` (credentials).
- components/RegisterForm.tsx, ForgotPasswordForm.tsx, ResetPasswordForm.tsx: forms posting to the auth routes.
- schemas/auth.schema.ts: zod schemas for the forms.

## Talks to
- `POST /api/auth/register`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, NextAuth at `/api/auth/[...nextauth]` (src/app/api/auth).
- Models: User, Session. Server pieces: src/lib/auth-options.ts, src/lib/email.ts.
- Mobile: none (the app uses an API key, not a login).

## Rules and gotchas
- Pages live in `src/app/(auth)/`. `src/proxy.ts` redirects signed-out users to `/login` and exempts these routes.
- Forgot-password always answers 200 so it cannot reveal which emails exist ([docs/authentication.md](../../../docs/authentication.md)).
- Self-deleted accounts have their email rewritten to a tombstone; register releases such addresses.

## Tests
- None in this dir.

## Last changed
- 10a7ed0 feat(ui): Apple-style redesign with full-width responsive layouts
