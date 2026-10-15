"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronLeft } from "lucide-react";
import { useSession } from "next-auth/react";
import { getGreeting } from "@/lib/utils";
import { ROUTE_TITLES } from "@/lib/route-titles";
import { Button } from "@/components/_ui/Button";
import { Avatar } from "@/components/_ui/Avatar";

/**
 * Mobile top chrome: translucent 52px bar, safe-area aware. Home shows
 * avatar + greeting; other pages show a back chip and a small centred title
 * that fades in only once the page's large title (PageHeader) scrolls away.
 */
export function MobileHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  // Nested routes (e.g. /settings/profile) fall back to their section title.
  const section = "/" + pathname.split("/").filter(Boolean)[0];
  const title = ROUTE_TITLES[pathname] ?? ROUTE_TITLES[section] ?? "Finance OS";
  const isHome = pathname === "/dashboard";
  const userName = session?.user?.name ?? "";
  const greeting = getGreeting();

  return (
    <header
      className="chrome md:hidden sticky top-0 z-30"
      style={{
        borderBottom: "1px solid var(--line)",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <div className="flex h-13 items-center justify-between gap-2 px-3.5">
        {isHome ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/settings")}
            aria-label="Open settings"
            className="size-10 shrink-0 rounded-full p-0"
          >
            <Avatar name={userName || "User"} size={36} />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            // A PWA opened on a deep link has nothing to go back to.
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/dashboard"))}
            aria-label="Go back"
            className="size-10 shrink-0 rounded-full"
            style={{ background: "var(--card-2)", color: "var(--ink)" }}
          >
            <ChevronLeft size={20} />
          </Button>
        )}

        {isHome ? (
          <div className="min-w-0 flex-1 px-1 text-left">
            <div className="text-[11px] font-medium" style={{ color: "var(--ink-2)" }}>
              {greeting}
            </div>
            <div
              className="truncate text-[16px] font-semibold leading-tight tracking-[-0.015em]"
              style={{ color: "var(--ink)" }}
            >
              {userName || "there"}
            </div>
          </div>
        ) : (
          <span
            className="topbar-title min-w-0 flex-1 truncate px-2 text-center text-[16px] font-semibold tracking-[-0.015em]"
            style={{ color: "var(--ink)" }}
          >
            {title}
          </span>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => router.push("/notifications")}
          aria-label="Notifications"
          className="size-10 shrink-0 rounded-full"
          style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
        >
          <Bell size={18} />
        </Button>
      </div>
    </header>
  );
}
