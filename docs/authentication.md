# Authentication

## Overview

Finance OS uses **NextAuth v4** with a `CredentialsProvider` (email + password) and JWT strategy with a 10-day expiry.

## Session tracking (JTI)

Every JWT contains a `jti` (JWT ID). When a user signs in, a `UserSession` document is created in MongoDB with that `jti`. On every token refresh (triggered by the `jwt` callback), the JTI is validated:

1. Fetch the `UserSession` document matching `jti`
2. If not found or `isActive === false`, set `token.error = "SessionTerminated"`
3. The client checks `session.error`; if set, calls `signOut()` and redirects to `/login`

This allows server-side session revocation (e.g., logout-from-all-devices).

## Flow

```
POST /api/auth/callback/credentials
  → verify email + password (bcryptjs, 12 rounds)
  → create UserSession { jti, user, ip, userAgent }
  → return JWT { id, role, avatar, jti }

Every page load / API call:
  → NextAuth middleware validates JWT
  → jwt callback validates JTI against MongoDB
  → if invalid → token.error = "SessionTerminated"
  → session callback propagates error to client
```

## Server-side auth guard

Every Route Handler calls `requireAuth()` at the top:

```typescript
const { user, errorResponse } = await requireAuth();
if (errorResponse) return errorResponse; // 401 or 403

// user.id, user.role, user.email are now available
```

For admin-only routes:

```typescript
const { user, errorResponse } = await requireAuth(["admin"]);
```

## Password reset

1. POST `/api/auth/forgot-password` — generates a 1-hour crypto token, stores bcrypt hash in `user.passwordResetToken`, **always returns 200** (prevents email enumeration)
2. Email contains link to `/reset-password/{raw-token}`
3. POST `/api/auth/reset-password` — validates token by hashing the raw token and comparing to the stored hash, checks expiry, updates password, clears token

## Role-based access

- **Server**: `requireAuth(["admin"])` in Route Handlers
- **Client**: `<RoleGuard allowedRoles={["admin"]}>...</RoleGuard>` wraps admin-only UI
- **App layout**: `/admin/*` pages use a server layout that redirects non-admin users to `/forbidden`
