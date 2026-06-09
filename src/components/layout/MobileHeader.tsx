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
      className="md:hidden"
      style={{
        background: `linear-gradient(180deg, var(--hdr-1) 0%, var(--hdr-2) 52%, var(--bg) 100%)`,
        padding: "16px 20px 20px",
      }}
    >
      <div className="flex items-center justify-between">
        {/* Left: avatar on home, back button elsewhere */}
        {isHome ? (
          <button
            onClick={() => router.push("/settings")}
            className="w-11 h-11 rounded-full grid place-items-center text-white font-bold text-base flex-none"
            style={{
              background: "var(--fab)",
              color: "var(--fab-ink)",
              boxShadow: "var(--shadow-sm)",
              fontSize: 16,
            }}
          >
            {userInitial}
          </button>
        ) : (
          <button
            onClick={() => router.back()}
            className="w-11 h-11 rounded-full grid place-items-center"
            style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
          >
            <ChevronLeft size={21} />
          </button>
        )}

        {/* Center: greeting on home, page title elsewhere */}
        {isHome ? (
          <div className="text-left">
            <div className="text-[12px] font-medium" style={{ color: "var(--ink-2)" }}>
              {greeting}
            </div>
            <div className="font-extrabold text-[18px] leading-tight" style={{ color: "var(--ink)" }}>
              {userName || "there"}
            </div>
          </div>
        ) : (
          <span className="font-extrabold text-[22px]" style={{ color: "var(--ink)" }}>
            {title}
          </span>
        )}

        {/* Right: notifications bell */}
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
