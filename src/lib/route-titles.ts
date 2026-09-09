// Single source of truth for page titles shown in DesktopTopbar/MobileHeader.
// Previously duplicated between the two with a real inconsistency
// ("/dashboard" was "Home" on mobile vs "Dashboard" on desktop) — mobile's
// copy was unreachable in practice since MobileHeader shows a greeting
// instead of a title on the dashboard route, so "Dashboard" is canonical.
export const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/transactions": "Transactions",
  "/transactions/add": "Add Transaction",
  "/analytics": "Analytics",
  "/accounts": "Accounts",
  "/notifications": "Notifications",
  "/logs": "Logs",
  "/settings": "Settings",
  "/budgets": "Budgets",
  "/goals": "Goals",
  "/loans": "Loans",
  "/admin/users": "User Management",
};
