"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";

const TITLES: Record<string, string> = {
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

export function DesktopTopbar() {
  const pathname = usePathname();
  const title = TITLES[pathname] ?? "Finance OS";

  return (
    <header
      className="hidden md:flex items-center justify-between fixed top-0 right-0 z-30"
      style={{
        left: "var(--sidebar-w)",
        height: 64,
        padding: "0 32px",
        background: "var(--card)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        borderBottom: "1px solid var(--glass-border)",
        boxShadow: "0 1px 24px rgba(28,18,68,.06), inset 0 -1px 0 rgba(255,255,255,.3)",
      }}
    >
      <h1
        className="font-extrabold tracking-tight"
        style={{ fontSize: 20, color: "var(--ink)", letterSpacing: "-0.3px" }}
      >
        {title}
      </h1>

      <Link
        href="/notifications"
        className="w-10 h-10 rounded-full grid place-items-center transition-opacity hover:opacity-75"
        style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
      >
        <Bell size={19} />
      </Link>
    </header>
  );
}
