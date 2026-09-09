# Register

`/register` — no app shell, centered card only

**User story**
> As a new user, I want to create an account with my name, email, and a password, so I can start tracking my finances.

**What happens here**
Full name, email, password + confirm password (show/hide). Posts to
`/api/auth/register`; on success, toasts and redirects to `/login`.

**Edge cases to design for**
- Email already registered
- Password/confirm mismatch
- Weak password (what's the rule, and how is it communicated before submit?)

**Source:** `src/features/auth/components/RegisterForm.tsx`
