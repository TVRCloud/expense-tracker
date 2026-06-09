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

const NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/logs", label: "Logs", icon: KeyRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const isDark = mounted && resolvedTheme === "dark";
  const navItems = session?.user?.role === "admin"
    ? [...NAV, { href: "/admin/users", label: "Admin", icon: Shield }]
    : NAV;

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
            background: "linear-gradient(150deg,var(--violet),var(--violet-2))",
            boxShadow: "0 8px 18px rgba(107,70,245,.34)",
          }}
        >
          <Wallet size={20} />
        </div>
        <span className="font-extrabold text-xl tracking-tight" style={{ color: "var(--ink)" }}>
          exp<b style={{ color: "var(--violet)" }}>s</b>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-[14px] font-semibold text-[15px] transition-all",
                active
                  ? "text-white"
                  : "hover:text-[var(--ink)]"
              )}
              style={
                active
                  ? {
                      background: "var(--violet)",
                      color: "#fff",
                      boxShadow: "0 10px 22px rgba(107,70,245,.28)",
                    }
                  : { color: "var(--ink-2)" }
              }
            >
              <Icon size={21} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Add Transaction */}
      <Link
        href="/transactions/add"
        className="mt-5 flex items-center justify-center gap-2 px-4 py-[14px] rounded-[15px] font-bold text-[15px] transition-all hover:brightness-110"
        style={{ background: "var(--fab)", color: "var(--fab-ink)" }}
      >
        <Plus size={19} />
        <span>Add Transaction</span>
      </Link>

      {/* Footer */}
      <div className="mt-auto flex flex-col gap-3">
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
          {/* Animated switch */}
          <span
            className="relative w-[42px] h-6 rounded-full flex-none transition-colors duration-200"
            style={{ background: isDark ? "var(--violet)" : "var(--line-2)" }}
          >
            <span
              className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-transform duration-200 shadow"
              style={{ left: 3, transform: isDark ? "translateX(18px)" : "translateX(0)" }}
            />
          </span>
        </button>

        {/* Profile */}
        <div className="flex items-center gap-3 px-2 py-1">
          <div
            className="w-10 h-10 rounded-[13px] grid place-items-center text-white font-bold text-lg flex-none"
            style={{ background: "linear-gradient(150deg,var(--violet),var(--violet-2))" }}
          >
            {session?.user?.name?.[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm truncate" style={{ color: "var(--ink)" }}>
              {session?.user?.name ?? "User"}
            </div>
            <div className="text-xs truncate" style={{ color: "var(--ink-3)" }}>
              {session?.user?.email ?? ""}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="ml-auto p-1 rounded-lg transition-opacity hover:opacity-70"
            style={{ color: "var(--ink-3)" }}
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
