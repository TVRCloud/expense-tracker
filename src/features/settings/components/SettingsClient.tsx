"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Sun, Lock, Bell, LogOut, ChevronRight, Shield, HelpCircle, KeyRound } from "lucide-react";
import { CURRENCY_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Avatar } from "@/components/_ui/Avatar";
import { PageHeader } from "@/components/shared/PageHeader";
import { useProfile } from "@/features/settings/hooks/useProfile";
import { ProfileSettingsPage } from "./SettingsSubpages";
import { SettingsRow } from "./SettingsRow";
import { Group } from "./SettingsUi";

/**
 * Settings frame (rendered by settings/layout.tsx).
 * >=1024px: macOS System Settings, list left + detail right.
 * <1024px: iOS Settings drill-down. /settings shows the list, a subpage
 * shows only its detail (back chip lives in MobileHeader).
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHub = pathname === "/settings";

  return (
    <div className="page-stack">
      <div className={cn(!isHub && "hidden lg:block")}>
        <PageHeader title="Settings" subtitle="Manage your profile, preferences and security." />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] xl:gap-10">
        <aside
          className={cn(
            "min-w-0 lg:sticky lg:top-[calc(var(--topbar-h)+20px)] lg:max-h-[calc(100dvh-var(--topbar-h)-40px)] lg:overflow-y-auto",
            !isHub && "hidden lg:block"
          )}
        >
          <SettingsNav pathname={pathname} />
        </aside>
        <section className={cn("min-w-0", isHub && "hidden lg:block")}>
          <div className="max-w-3xl">{children}</div>
        </section>
      </div>
    </div>
  );
}

function SettingsNav({ pathname }: { pathname: string }) {
  const { data: profile, isLoading } = useProfile();
  const pushOn = profile?.preferences?.pushNotifications ?? false;
  const emailOn = profile?.preferences?.emailNotifications ?? true;
  const notifSub = pushOn && emailOn ? "Push and email on" : pushOn ? "Push on" : emailOn ? "Email on" : "All off";
  const currency = profile?.preferences?.currency ?? "INR";

  // "/settings" itself shows Profile in the detail pane on desktop.
  const is = (slug: string) => pathname === `/settings/${slug}` || (slug === "profile" && pathname === "/settings");

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5">
        {[76, 168, 168, 56].map((h, i) => (
          <Skeleton key={i} className="rounded-(--r-md)" style={{ height: h }} />
        ))}
      </div>
    );
  }

  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-6 pb-4">
      <div className="inset-group" style={{ "--inset": "76px" } as React.CSSProperties}>
        <Link
          href="/settings/profile"
          aria-current={is("profile") ? "page" : undefined}
          className={cn(
            "flex min-h-[76px] items-center gap-4 px-4 py-3 outline-none transition-colors hover:bg-(--card-2) active:bg-(--card-2) focus-visible:bg-(--card-2)",
            is("profile") && "bg-[color-mix(in_srgb,var(--violet)_10%,transparent)]"
          )}
        >
          <Avatar name={profile?.name ?? "User"} src={profile?.avatar ?? undefined} size={52} className="flex-none" />
          <div className="min-w-0 flex-1">
            <div className="truncate" style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>
              {profile?.name ?? "Your profile"}
            </div>
            <div className="mt-0.5 truncate" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
              {profile?.email}
            </div>
          </div>
          <ChevronRight size={16} className="flex-none" style={{ color: "var(--ink-3)" }} />
        </Link>
      </div>

      <Group inset={60}>
        <SettingsRow icon={CURRENCY_ICON} title="Currency & Region" subtitle={`${currency} · week start`} href="/settings/preferences" selected={is("preferences")} />
        <SettingsRow icon={Sun} title="Appearance" subtitle="Theme and glass" href="/settings/appearance" selected={is("appearance")} />
        <SettingsRow icon={Bell} title="Notifications" subtitle={notifSub} href="/settings/notifications" selected={is("notifications")} />
      </Group>

      <Group inset={60}>
        <SettingsRow icon={Lock} title="Security" subtitle="Password" href="/settings/security" selected={is("security")} />
        <SettingsRow icon={KeyRound} title="API keys" subtitle="Mobile app, n8n, integrations" href="/settings/api-keys" selected={is("api-keys")} />
        <SettingsRow icon={Shield} title="Privacy" subtitle="Data export and deletion" href="/settings/privacy" selected={is("privacy")} />
      </Group>

      <Group inset={60}>
        <SettingsRow icon={HelpCircle} title="Help & Support" href="/settings/help" selected={is("help")} />
      </Group>

      <Group>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex min-h-12 w-full items-center justify-center gap-2 px-4 py-3 outline-none transition-colors hover:bg-(--card-2) active:bg-(--card-2) focus-visible:bg-(--card-2)"
          style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--red)" }}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </Group>
    </nav>
  );
}

/** Detail pane shown at /settings on desktop (mobile shows the list instead). */
export function SettingsClient() {
  return <ProfileSettingsPage />;
}
