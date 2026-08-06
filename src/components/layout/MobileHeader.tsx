"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronLeft } from "lucide-react";
import { useSession } from "next-auth/react";
import { getGreeting } from "@/lib/utils";

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
  const { data: session } = useSession();

  const title = TITLES[pathname] ?? "Finance OS";
  const isHome = pathname === "/dashboard";
  const userName = session?.user?.name ?? "";
  const userInitial = userName[0]?.toUpperCase() ?? "U";
  const greeting = getGreeting();

  return (
    <header
      className="md:hidden sticky top-0 z-30 transition-all duration-200"
      style={{
        background: "var(--card)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderBottom: "1px solid var(--glass-border)",
        padding: "12px 18px",
      }}
    >
      <div className="flex items-center justify-between">
        {/* Left: avatar on home, back button elsewhere */}
        {isHome ? (
          <button
            onClick={() => router.push("/settings")}
            className="w-10 h-10 rounded-full grid place-items-center text-white font-bold text-sm shrink-0 active:scale-95 transition-transform"
            style={{
              background: "var(--fab)",
              color: "var(--fab-ink)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            {userInitial}
          </button>
        ) : (
          <button
            onClick={() => router.back()}
            className="w-10 h-10 rounded-full grid place-items-center active:scale-95 transition-transform"
            style={{ background: "var(--card-2)", color: "var(--ink)" }}
          >
            <ChevronLeft size={20} />
          </button>
        )}

        {/* Center: greeting on home, page title elsewhere */}
        {isHome ? (
          <div className="text-left flex-1 px-3">
            <div className="text-[11px] font-medium tracking-tight" style={{ color: "var(--ink-2)" }}>
              {greeting}
            </div>
            <div className="font-extrabold text-[16.5px] leading-tight truncate" style={{ color: "var(--ink)" }}>
              {userName || "there"}
            </div>
          </div>
        ) : (
          <span className="font-extrabold text-[18px] tracking-tight truncate flex-1 text-center px-2" style={{ color: "var(--ink)" }}>
            {title}
          </span>
        )}

        {/* Right: notifications bell */}
        <button
          onClick={() => router.push("/notifications")}
          className="w-10 h-10 rounded-full grid place-items-center shrink-0 active:scale-95 transition-transform"
          style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
        >
          <Bell size={19} />
        </button>
      </div>
    </header>
  );
}
