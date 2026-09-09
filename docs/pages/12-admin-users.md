# Admin Users

`/admin/users` — admin role only

**User story**
> As an admin, I want to search all users and change a user's role or active status, so I can manage access without touching the database directly.

**What happens here**
Role-gated (`RoleGuard`) — only shown in Sidebar and reachable if `session.user.role === "admin"`.
A searchable, sortable, paginated table (TanStack Table) of every user.

**Key elements**
- Search input
- Sortable "User" column (avatar, name, email)
- Role / active-status controls
- Pagination, page size 20

**Edge cases to design for**
- A non-admin hitting this URL directly (should redirect/403, not flash the table)
- Deactivating your own admin account (should probably be blocked or heavily confirmed)

**Source:** `src/features/admin/components/AdminUsersClient.tsx`
