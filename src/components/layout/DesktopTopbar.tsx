"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Plus, Search } from "lucide-react";
import { ROUTE_TITLES } from "@/lib/route-titles";
import { Button } from "@/components/_ui/Button";

export function DesktopTopbar() {
  const pathname = usePathname();
  const title = ROUTE_TITLES[pathname] ?? "Finance OS";

  return (
    <header
      className="hidden md:flex items-center justify-between fixed top-0 right-0 z-30 chrome"
      style={{
        left: "var(--sidebar-w)",
        height: "var(--topbar-h)",
        padding: "0 var(--gutter)",
      }}
    >
      {/* Small title: hidden while the page's large title is on screen. */}
      <span
        className="topbar-title font-semibold"
        style={{ fontSize: 15, letterSpacing: "-0.01em", color: "var(--ink)" }}
      >
        {title}
      </span>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => document.dispatchEvent(new CustomEvent("open-command-palette"))}
          className="h-9 px-3.5 rounded-full text-sm font-medium gap-2 min-w-[min(260px,28vw)] justify-start"
          style={{ background: "var(--card-2)", color: "var(--ink-3)" }}
        >
          <Search size={15} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md" style={{ background: "var(--card)", color: "var(--ink-3)" }}>
            ⌘K
          </kbd>
        </Button>
        <Link
          href="/notifications"
          aria-label="Notifications"
          className="w-9 h-9 rounded-full grid place-items-center transition-colors hover:brightness-95"
          style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
        >
          <Bell size={17} />
        </Link>
        <Link
          href="/transactions/add"
          className="h-9 px-4 rounded-full inline-flex items-center gap-1.5 text-sm font-semibold btn-interactive"
          style={{ background: "var(--fab)", color: "var(--fab-ink)" }}
        >
          <Plus size={16} />
          Add
        </Link>
      </div>
    </header>
  );
}
