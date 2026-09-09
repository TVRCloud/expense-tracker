# Reset Password

`/reset-password/[token]` — no app shell, centered card only

**User story**
> As a user with a reset link in hand, I want to set a new password and get back into my account right away.

**What happens here**
New password + confirm (show/hide), token comes from the URL segment. Posts to
`/api/auth/reset-password`; shows a success state and auto-redirects to `/login` after
~2.5 seconds.

**Edge cases to design for**
- Expired or already-used token (clear error, link back to `/forgot-password`)
- Password/confirm mismatch

**Source:** `src/features/auth/components/ResetPasswordForm.tsx`
