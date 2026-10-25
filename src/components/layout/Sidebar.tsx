"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  ArrowLeftRight,
  BarChart2,
  Wallet,
  Sun,
  Moon,
  LogOut,
  Bell,
  Settings,
  Shield,
  KeyRound,
  ClipboardCheck,
  PiggyBank,
  Target,
  Landmark,
  Repeat,
  Scale,
  Receipt,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/_ui/Button";
import { Avatar } from "@/components/_ui/Avatar";

const NAV_GROUPS = [
  {
    label: "Main",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
      { href: "/reconcile", label: "Reconcile", icon: ClipboardCheck },
    ],
  },
  {
    label: "Reports",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart2 },
      { href: "/accounts", label: "Accounts", icon: Wallet },
      { href: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Planning",
    items: [
      { href: "/budgets", label: "Budgets", icon: PiggyBank },
      { href: "/goals", label: "Goals", icon: Target },
      { href: "/loans", label: "Loans", icon: Landmark },
      { href: "/subscriptions", label: "Subscriptions", icon: Repeat },
      { href: "/net-worth", label: "Net worth", icon: Scale },
      { href: "/investments", label: "Investments", icon: TrendingUp },
      { href: "/tax", label: "Tax", icon: Receipt },
    ],
  },
  {
    label: "Access",
    items: [
      { href: "/logs", label: "Logs", icon: KeyRound },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const isDark = mounted && resolvedTheme === "dark";
  const isAdmin = session?.user?.role === "admin";

  const groups = isAdmin
    ? [
        ...NAV_GROUPS.slice(0, 2),
        {
          label: "Access",
          items: [
            ...NAV_GROUPS[2].items,
            { href: "/admin/users", label: "Admin", icon: Shield },
          ],
        },
      ]
    : NAV_GROUPS;

  return (
    <aside
      className="hidden md:flex flex-col sticky top-0 h-screen"
      style={{
        width: "var(--sidebar-w)",
        flex: "none",
        background: "color-mix(in srgb, var(--card-2) 55%, var(--bg))",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        borderRight: "1px solid var(--line)",
        padding: "20px 12px 16px",
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-2 pb-6 xl:px-3">
        <div
          className="w-9 h-9 rounded-[11px] grid place-items-center flex-none"
          style={{ background: "var(--fab)", color: "var(--fab-ink)" }}
        >
          <Wallet size={18} />
        </div>
        <span className="hidden xl:block font-semibold text-[17px] leading-none" style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}>
          Finance OS
        </span>
      </div>

      {/* Nav — labels collapse to an icon rail below xl */}
      <nav className="flex flex-col gap-5 flex-1 overflow-y-auto overflow-x-hidden -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
        {groups.map(({ label, items }) => (
          <div key={label}>
            <div
              className="hidden xl:block text-[12px] font-medium px-3 mb-1.5"
              style={{ color: "var(--ink-3)" }}
            >
              {label}
            </div>
            <div className="flex flex-col gap-0.5">
              {items.map(({ href, label: itemLabel, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    title={itemLabel}
                    aria-label={itemLabel}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-center xl:justify-start gap-3 h-10 px-0 xl:px-3 rounded-[11px] text-[14px] transition-colors duration-150 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-(--violet)",
                      active ? "font-semibold" : "font-medium hover:bg-(--card-2)"
                    )}
                    style={
                      active
                        ? { background: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }
                        : { color: "var(--ink-2)" }
                    }
                  >
                    <Icon size={19} strokeWidth={active ? 2.25 : 1.9} className="flex-none" />
                    <span className="hidden xl:inline truncate">{itemLabel}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="mt-4 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          title={isDark ? "Light mode" : "Dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className="flex items-center justify-center xl:justify-start gap-3 h-10 px-0 xl:px-3 rounded-[11px] text-[14px] font-medium hover:bg-(--card-2) transition-colors"
          style={{ color: "var(--ink-2)" }}
        >
          {isDark ? <Sun size={19} /> : <Moon size={19} />}
          <span className="hidden xl:inline">{isDark ? "Light mode" : "Dark mode"}</span>
        </button>

        <div className="flex items-center gap-3 px-1.5 xl:px-2 py-2 mt-1 rounded-[13px] justify-center xl:justify-start" style={{ borderTop: "1px solid var(--line)" }}>
          <Avatar name={session?.user?.name ?? "User"} size={34} />
          <div className="hidden xl:block min-w-0 flex-1">
            <div className="font-semibold text-[13px] truncate" style={{ color: "var(--ink)" }}>
              {session?.user?.name ?? "User"}
            </div>
            <div className="text-[11px] truncate" style={{ color: "var(--ink-3)" }}>
              {session?.user?.email ?? ""}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="hidden xl:grid p-1.5 rounded-xl h-auto w-auto"
            style={{ color: "var(--ink-3)" }}
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </Button>
        </div>
      </div>
    </aside>
  );
}
