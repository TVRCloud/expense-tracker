"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ArrowLeftRight, Plus, BarChart2, Wallet } from "lucide-react";
import { MotionConfig, motion } from "motion/react";

const ITEMS = [
  // Same names as the sidebar, so a place is called one thing everywhere.
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/transactions/add", label: "Add", icon: Plus, fab: true },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/accounts", label: "Accounts", icon: Wallet },
];

/**
 * Mobile tab bar: edge-to-edge translucent chrome with a hairline top
 * border, safe-area aware. Active tab = tinted pill (shared-layout spring,
 * critically damped) + heavier icon stroke. "Add" is the single prominent
 * action, inline in the bar rather than floating over content.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <MotionConfig reducedMotion="user">
      <nav
        aria-label="Primary"
        className="chrome fixed inset-x-0 bottom-0 z-40 md:hidden"
        style={{
          borderTop: "1px solid var(--line)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="mx-auto flex max-w-[560px] items-center justify-between px-2 pt-1.5 pb-1.5">
          {ITEMS.map(({ href, label, icon: Icon, fab }) => {
            if (fab) {
              return (
                <Link
                  key={href}
                  href={href}
                  aria-label="Add transaction"
                  className="btn-interactive grid size-12 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--violet)_35%,transparent)]"
                  style={{
                    background: "var(--fab)",
                    color: "var(--fab-ink)",
                    boxShadow: "0 6px 16px rgba(0,0,0,0.22)",
                  }}
                >
                  <Icon size={24} strokeWidth={2.4} />
                </Link>
              );
            }

            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className="btn-interactive relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-(--r-md) px-1 py-1.5 text-[10.5px] font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-(--violet)"
                style={{ color: active ? "var(--ink)" : "var(--ink-3)" }}
              >
                {active && (
                  <motion.span
                    layoutId="bottom-nav-pill"
                    className="absolute inset-x-1 inset-y-0.5 rounded-(--r-md)"
                    style={{ background: "color-mix(in srgb, var(--violet) 12%, transparent)" }}
                    // Critically damped (2·√420 ≈ 41): a tap has no momentum.
                    transition={{ type: "spring", stiffness: 420, damping: 41 }}
                  />
                )}
                <Icon size={21} strokeWidth={active ? 2.5 : 1.9} className="relative z-10" />
                <span className="relative z-10 max-w-full truncate">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </MotionConfig>
  );
}
