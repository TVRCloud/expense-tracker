# Login

`/login` — no app shell, centered card only

**User story**
> As a returning user, I want to sign in with my email and password quickly, and recover access if I forget my password.

**What happens here**
Email + password via NextAuth credentials provider. On success, routes to `/dashboard`.

**Key elements**
- Email, password (show/hide toggle)
- "Forgot password?" link → `/forgot-password`
- Link to `/register`

**Edge cases to design for**
- Wrong password / unknown email (error copy should not reveal which one is wrong)
- Rate-limited after repeated failures, if applicable

**Source:** `src/features/auth/components/LoginForm.tsx`
