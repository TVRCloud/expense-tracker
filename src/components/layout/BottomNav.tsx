"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ArrowLeftRight, Plus, BarChart2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/transactions/add", label: "Add", icon: Plus, fab: true },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/accounts", label: "Accounts", icon: Wallet },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed left-0 right-0 bottom-0 z-40 grid md:hidden"
      style={{
        gridTemplateColumns: "repeat(5,1fr)",
        alignItems: "end",
        padding: "10px 14px calc(14px + env(safe-area-inset-bottom))",
        background: "var(--card)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        borderTop: "1px solid var(--glass-border)",
        boxShadow: "0 -8px 30px rgba(28,18,68,.08), inset 0 1px 0 rgba(255,255,255,.55)",
      }}
    >
      {ITEMS.map(({ href, label, icon: Icon, fab }) => {
        if (fab) {
          return (
            <Link
              key={href}
              href={href}
              className="w-[60px] h-[60px] rounded-full grid place-items-center mx-auto text-white"
              style={{
                background: "var(--fab)",
                boxShadow: "0 12px 26px rgba(27,19,56,.4)",
                border: "5px solid var(--bg)",
                marginTop: "-34px",
              }}
            >
              <Icon size={26} />
            </Link>
          );
        }
        const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));
        return (
          <Link
            key={href}
            href={href}
            className={cn("flex flex-col items-center gap-1 text-[11px] font-semibold transition-colors")}
            style={{ color: active ? "var(--violet)" : "var(--ink-3)" }}
          >
            <Icon size={23} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
