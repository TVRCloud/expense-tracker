"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ArrowLeftRight, Plus, BarChart2, Wallet } from "lucide-react";
import { motion } from "framer-motion";

const ITEMS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/transactions", label: "History", icon: ArrowLeftRight },
  { href: "/transactions/add", label: "Add", icon: Plus, fab: true },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/accounts", label: "Wallet", icon: Wallet },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <div className="fixed left-0 right-0 bottom-0 z-40 md:hidden pointer-events-none pb-[calc(8px+env(safe-area-inset-bottom,0px))] px-4">
      <nav
        className="pointer-events-auto max-w-[420px] mx-auto flex items-center justify-around rounded-[26px] p-1.5"
        style={{
          background: "var(--card)",
          backdropFilter: "blur(28px) saturate(180%)",
          WebkitBackdropFilter: "blur(28px) saturate(180%)",
          border: "1px solid var(--glass-border)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.18), 0 2px 10px rgba(0,0,0,0.08)",
        }}
      >
        {ITEMS.map(({ href, label, icon: Icon, fab }) => {
          if (fab) {
            return (
              <Link
                key={href}
                href={href}
                className="relative -top-5 w-13 h-13 rounded-full grid place-items-center text-white shrink-0 active:scale-95 transition-transform"
                style={{
                  background: "var(--fab)",
                  color: "var(--fab-ink)",
                  boxShadow: "0 10px 24px rgba(0,0,0,0.30), 0 0 0 4px var(--bg)",
                }}
                aria-label="Add transaction"
              >
                <Icon size={24} />
              </Link>
            );
          }

          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));

          return (
            <Link
              key={href}
              href={href}
              className="relative flex flex-col items-center justify-center py-2 px-3 min-w-[60px] text-[10.5px] font-bold transition-transform active:scale-95"
              style={{ color: active ? "var(--ink)" : "var(--ink-3)" }}
            >
              {active && (
                <motion.div
                  layoutId="mobile-floating-pill"
                  className="absolute inset-0 rounded-[20px]"
                  style={{ background: "color-mix(in srgb, var(--violet) 12%, transparent)" }}
                  transition={{ type: "spring", stiffness: 420, damping: 30 }}
                />
              )}
              <Icon size={20} className="relative z-10 mb-0.5" />
              <span className="relative z-10 tracking-tight">{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
