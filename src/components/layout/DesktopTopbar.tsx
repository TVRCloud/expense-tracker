"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Search } from "lucide-react";
import { ROUTE_TITLES } from "@/lib/route-titles";
import { Button } from "@/components/_ui/Button";

export function DesktopTopbar() {
  const pathname = usePathname();
  const title = ROUTE_TITLES[pathname] ?? "Finance OS";

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

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => document.dispatchEvent(new CustomEvent("open-command-palette"))}
          className="h-9 px-3 rounded-full text-sm font-medium gap-2"
          style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
        >
          <Search size={15} />
          Search
          <kbd className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--card)", color: "var(--ink-3)" }}>
            ⌘K
          </kbd>
        </Button>
        <Link
          href="/notifications"
          aria-label="Notifications"
          className="w-10 h-10 rounded-full grid place-items-center transition-opacity hover:opacity-75"
          style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
        >
          <Bell size={19} />
        </Link>
      </div>
    </header>
  );
}
