"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronLeft } from "lucide-react";
import { useSession } from "next-auth/react";
import { getGreeting } from "@/lib/utils";
import { ROUTE_TITLES } from "@/lib/route-titles";
import { Button } from "@/components/_ui/Button";
import { Avatar } from "@/components/_ui/Avatar";

export function MobileHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const title = ROUTE_TITLES[pathname] ?? "Finance OS";
  const isHome = pathname === "/dashboard";
  const userName = session?.user?.name ?? "";
  const greeting = getGreeting();

  return (
    <header
      className="md:hidden sticky top-0 z-30 transition-all duration-200"
      style={{
        background: "var(--card)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        borderBottom: "1px solid var(--glass-border)",
        padding: "12px 18px",
      }}
    >
      <div className="flex items-center justify-between">
        {/* Left: avatar on home, back button elsewhere */}
        {isHome ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/settings")}
            aria-label="Open settings"
            className="w-10 h-10 rounded-full p-0 shrink-0 active:scale-95"
          >
            <Avatar name={userName || "User"} size={40} />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            aria-label="Go back"
            className="w-10 h-10 rounded-full active:scale-95"
            style={{ background: "var(--card-2)", color: "var(--ink)" }}
          >
            <ChevronLeft size={20} />
          </Button>
        )}

        {/* Center: greeting on home, page title elsewhere */}
        {isHome ? (
          <div className="text-left flex-1 px-3">
            <div className="text-[11px] font-medium tracking-tight" style={{ color: "var(--ink-2)" }}>
              {greeting}
            </div>
            <div className="font-extrabold text-[16.5px] leading-tight truncate" style={{ color: "var(--ink)" }}>
              {userName || "there"}
            </div>
          </div>
        ) : (
          <span className="font-extrabold text-[18px] tracking-tight truncate flex-1 text-center px-2" style={{ color: "var(--ink)" }}>
            {title}
          </span>
        )}

        {/* Right: notifications bell */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => router.push("/notifications")}
          aria-label="Notifications"
          className="w-10 h-10 rounded-full shrink-0 active:scale-95"
          style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
        >
          <Bell size={19} />
        </Button>
      </div>
    </header>
  );
}
