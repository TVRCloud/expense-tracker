# Forgot Password

`/forgot-password` — no app shell, centered card only

**User story**
> As a user who can't remember my password, I want to request a reset link by email without the app telling anyone whether my email is registered.

**What happens here**
Single email field, posts to `/api/auth/forgot-password`. Success state always reads
"check your email" — deliberately, to avoid confirming whether an account exists for
that address.

**Edge cases to design for**
- Keep the success state identical whether or not the email is registered — don't let a future redesign accidentally leak this

**Source:** `src/features/auth/components/ForgotPasswordForm.tsx`
