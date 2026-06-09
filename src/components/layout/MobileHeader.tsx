"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronLeft, Settings } from "lucide-react";

const TITLES: Record<string, string> = {
  "/dashboard": "Home",
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

export function MobileHeader() {
  const pathname = usePathname();
  const router = useRouter();

  const title = TITLES[pathname] ?? "Finance OS";
  const isHome = pathname === "/dashboard";

  return (
    <header
      className="md:hidden"
      style={{
        background: `linear-gradient(180deg, var(--hdr-1) 0%, var(--hdr-2) 52%, var(--bg) 100%)`,
        padding: "16px 20px 20px",
      }}
    >
      <div className="flex items-center justify-between">
        <button
          onClick={() => (isHome ? router.push("/settings") : router.back())}
          className="w-11 h-11 rounded-full grid place-items-center"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          {isHome ? <Settings size={21} /> : <ChevronLeft size={21} />}
        </button>

        <span className="font-extrabold text-[22px]" style={{ color: "var(--ink)" }}>
          {title}
        </span>

        <button
          onClick={() => router.push("/notifications")}
          className="w-11 h-11 rounded-full grid place-items-center"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <Bell size={21} />
        </button>
      </div>
    </header>
  );
}
