"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  Sun, Lock, Bell, LogOut, ChevronRight, Shield, HelpCircle,
} from "lucide-react";
import { CURRENCY_ICON } from "@/lib/icons";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Avatar } from "@/components/_ui/Avatar";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import { useProfile } from "@/features/settings/hooks/useProfile";
import {
  PreferencesFields, AppearanceFields, NotificationFields,
  SecurityFields, PrivacyFields, HelpFields,
} from "./SettingsSubpages";

function SectionTrigger({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  sub?: string;
}) {
  return (
    <AccordionTrigger className="px-5 py-4 hover:no-underline [&>svg]:text-(--ink-3)">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-9 h-9 rounded-[10px] grid place-items-center flex-none"
          style={{ background: "var(--card-2)" }}
        >
          <Icon size={16} style={{ color: "var(--violet)" }} />
        </div>
        <div className="min-w-0 text-left">
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{label}</div>
          {sub && (
            <div className="text-xs mt-0.5 truncate font-normal" style={{ color: "var(--ink-3)" }}>{sub}</div>
          )}
        </div>
      </div>
    </AccordionTrigger>
  );
}

export function SettingsClient() {
  const { data: profile, isLoading } = useProfile();
  const pushOn = profile?.preferences?.pushNotifications ?? false;
  const emailOn = profile?.preferences?.emailNotifications ?? true;
  const notifSub = pushOn && emailOn ? "Push and email on" : pushOn ? "Push on" : emailOn ? "Email on" : "All off";
  const currency = profile?.preferences?.currency ?? "INR";

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {[92, 420].map((h, i) => (
          <Skeleton key={i} className="rounded-(--r-lg)" style={{ height: h }} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-8">

      {/* ── Profile summary ─────────────────────────────────── */}
      <Link href="/settings/profile">
        <Card radius="lg" className="p-5 flex items-center gap-4 transition-colors hover:bg-(--card-2)">
          <Avatar name={profile?.name ?? "User"} size={56} className="rounded-2xl flex-none" style={{ boxShadow: "0 8px 20px rgba(0,0,0,.28)" }} />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[15px] truncate" style={{ color: "var(--ink)" }}>
              {profile?.name ?? "—"}
            </div>
            <div className="text-sm mt-0.5 truncate" style={{ color: "var(--ink-3)" }}>
              {profile?.email}
            </div>
            <span
              className="inline-flex items-center mt-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-bold capitalize"
              style={{ background: "rgba(0,0,0,.10)", color: "var(--violet)" }}
            >
              {profile?.role ?? "user"}
            </span>
          </div>
          <ChevronRight size={18} style={{ color: "var(--ink-3)" }} className="flex-none" />
        </Card>
      </Link>

      {/* ── Everything else, one section open at a time ─────── */}
      <Card radius="lg" className="overflow-hidden">
        <Accordion type="single" collapsible>
          <AccordionItem value="preferences" className="border-(--line) px-0">
            <SectionTrigger icon={CURRENCY_ICON} label="Currency & Region" sub={`${currency} · week start`} />
            <AccordionContent className="px-5 pt-1 flex flex-col gap-4">
              <PreferencesFields />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="appearance" className="border-(--line) px-0">
            <SectionTrigger icon={Sun} label="Appearance" sub="Theme" />
            <AccordionContent className="px-5 pt-1">
              <AppearanceFields />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="notifications" className="border-(--line) px-0">
            <SectionTrigger icon={Bell} label="Notifications" sub={notifSub} />
            <AccordionContent className="px-5 pt-1 flex flex-col gap-4">
              <NotificationFields />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="security" className="border-(--line) px-0">
            <SectionTrigger icon={Lock} label="Security" sub="Password" />
            <AccordionContent className="px-5 pt-1 flex flex-col gap-3">
              <SecurityFields />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="privacy" className="border-(--line) px-0">
            <SectionTrigger icon={Shield} label="Privacy" />
            <AccordionContent className="px-5 pt-1 flex flex-col gap-3">
              <PrivacyFields />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="help" className="border-(--line) px-0 border-b-0">
            <SectionTrigger icon={HelpCircle} label="Help & Support" />
            <AccordionContent className="px-5 pt-1 flex flex-col gap-3">
              <HelpFields />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      {/* ── Sign out ────────────────────────────────────────── */}
      <Button
        type="button"
        variant="secondary"
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="h-auto flex items-center justify-center gap-2 rounded-(--r-md) py-4 font-bold"
        style={{ color: "var(--red)" }}
      >
        <LogOut size={16} />
        Sign out
      </Button>
    </div>
  );
}
