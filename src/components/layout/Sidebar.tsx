"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { motion } from "motion/react";
import {
  LayoutDashboard,
  ArrowLeftRight,
  BarChart2,
  Wallet,
  Plus,
  Sun,
  Moon,
  LogOut,
  Bell,
  Settings,
  Shield,
  KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_GROUPS = [
  {
    label: "Main",
    items: [
      { href: "/dashboard", label: "Home", icon: LayoutDashboard },
      { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
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
      className="hidden md:flex flex-col sticky top-0 h-screen glass-surface"
      style={{
        width: "var(--sidebar-w)",
        borderRight: "1px solid var(--glass-border)",
        padding: "26px 18px",
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-2 pb-7">
        <div
          className="w-10 h-10 rounded-[12px] grid place-items-center text-white flex-none"
          style={{
            background: "var(--fab)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <Wallet size={20} />
        </div>
        <div>
          <span className="font-extrabold text-[19px] tracking-tight leading-none block" style={{ color: "var(--ink)" }}>
            Finance <span style={{ color: "var(--violet)" }}>OS</span>
          </span>
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--ink-3)" }}>
            exps
          </span>
        </div>
      </div>

      {/* Nav with section groups */}
      <nav className="flex flex-col gap-4 flex-1 overflow-y-auto">
        {groups.map(({ label, items }) => (
          <div key={label}>
            <div
              className="text-[9.5px] font-bold uppercase tracking-widest px-4 mb-1"
              style={{ color: "var(--ink-3)", letterSpacing: "0.1em" }}
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
                    className={cn(
                      "relative flex items-center gap-3 px-4 py-2.5 rounded-[14px] font-semibold text-[14.5px] transition-all duration-200 active:scale-[0.98]",
                      active ? "text-(--ink)" : "hover:text-(--ink) hover:bg-(--card-2)/50"
                    )}
                    style={
                      active
                        ? { background: "var(--card-2)", color: "var(--ink)", fontWeight: 700 }
                        : { color: "var(--ink-2)" }
                    }
                  >
                    {active && (
                      <motion.span
                        layoutId="sidebar-active-indicator"
                        className="absolute left-0 rounded-r-full"
                        style={{ width: 3, top: 8, bottom: 8, background: "var(--amber)" }}
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                    <Icon size={20} className="transition-transform duration-200 group-hover:scale-105" />
                    <span>{itemLabel}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Add Transaction */}
      <Link
        href="/transactions/add"
        className="mt-5 flex items-center justify-center gap-2 px-4 py-3.5 rounded-[15px] font-bold text-[15px] transition-all hover:brightness-110"
        style={{ background: "var(--fab)", color: "var(--fab-ink)" }}
      >
        <Plus size={19} />
        <span>Add Transaction</span>
      </Link>

      {/* Footer */}
      <div className="mt-4 flex flex-col gap-3">
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="flex items-center justify-between px-4 py-3 rounded-[14px] font-semibold text-sm transition-all"
          style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
        >
          <span className="flex items-center gap-3">
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
            <span>{isDark ? "Light mode" : "Dark mode"}</span>
          </span>
          <span
            className="relative w-10.5 h-6 rounded-full flex-none transition-colors duration-200"
            style={{ background: isDark ? "var(--violet)" : "var(--line-2)" }}
          >
            <span
              className="absolute top-0.75 w-4.5 h-4.5 rounded-full bg-white transition-transform duration-200 shadow"
              style={{ left: 3, transform: isDark ? "translateX(18px)" : "translateX(0)" }}
            />
          </span>
        </button>

        {/* Profile card */}
        <div
          className="flex items-center gap-3 px-3 py-3 rounded-[14px]"
          style={{
            background: "var(--card-2)",
            borderTop: "1px solid var(--line)",
          }}
        >
          <div
            className="w-9 h-9 rounded-[10px] grid place-items-center text-white font-bold text-base flex-none"
            style={{ background: "var(--card-2)", color: "var(--ink)", flexShrink: 0 }}
          >
            {session?.user?.name?.[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[13px] truncate" style={{ color: "var(--ink)" }}>
              {session?.user?.name ?? "User"}
            </div>
            <div className="text-[11px] truncate" style={{ color: "var(--ink-3)" }}>
              {session?.user?.email ?? ""}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="p-1.5 rounded-xl transition-opacity hover:opacity-70 flex-none"
            style={{ color: "var(--ink-3)", background: "var(--card)" }}
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
