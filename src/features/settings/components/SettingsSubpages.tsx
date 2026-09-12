"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "next-themes";
import { signOut } from "next-auth/react";
import { ArrowLeft, Bell, BellOff, Check, HelpCircle, Lock, Monitor, Moon, Shield, Smartphone, Sun, User } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { Switch } from "@/components/_ui/Switch";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { Input } from "@/components/_ui/Input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CURRENCY_ICON } from "@/lib/icons";
import { useChangePassword, useProfile, useUpdatePreferences, useUpdateProfile } from "@/features/settings/hooks/useProfile";
import { useGlassIntensity } from "@/components/providers/GlassIntensityProvider";
import { usePushNotification, type PushStatus } from "@/features/settings/hooks/usePushNotification";
import { parseDeviceLabel } from "@/lib/device-label";

const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "EUR", symbol: "€" },
  { code: "GBP", symbol: "£" },
  { code: "INR", symbol: "₹" },
  { code: "JPY", symbol: "¥" },
  { code: "AUD", symbol: "A$" },
  { code: "CAD", symbol: "C$" },
  { code: "SGD", symbol: "S$" },
  { code: "AED", symbol: "د.إ" },
  { code: "BRL", symbol: "R$" },
  { code: "CNY", symbol: "¥" },
  { code: "KRW", symbol: "₩" },
];

function PageShell({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Link href="/settings" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--violet)" }}>
        <ArrowLeft size={16} />
        Back to settings
      </Link>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-[12px] grid place-items-center" style={{ background: "rgba(0,0,0,.10)", color: "var(--violet)" }}>
          <Icon size={19} />
        </div>
        <h2 className="text-xl font-extrabold" style={{ color: "var(--ink)" }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Card radius="lg" className="p-5 flex flex-col gap-4">
      {children}
    </Card>
  );
}

// ── Field-level content, shared between the standalone /settings/* pages
// and the accordion sections on the /settings hub — one implementation,
// two places it renders (no PageShell/Panel chrome so it drops straight
// into an AccordionContent).

export function ProfileFields() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const [form, setForm] = useState({ name: "", avatar: "" });

  useEffect(() => {
    if (!profile) return;
    setForm({ name: profile.name ?? "", avatar: profile.avatar ?? "" });
  }, [profile]);

  if (isLoading) return <Skeleton className="h-40 rounded-(--r-md)" />;

  return (
    <>
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-[18px] grid place-items-center font-extrabold text-2xl overflow-hidden" style={{ background: "linear-gradient(150deg,var(--violet),var(--violet-2))", color: "var(--violet-fg)" }}>
          {form.avatar ? <Image src={form.avatar} alt={form.name} width={64} height={64} className="w-full h-full object-cover" /> : (form.name[0]?.toUpperCase() ?? "U")}
        </div>
        <div className="min-w-0">
          <div className="font-bold truncate" style={{ color: "var(--ink)" }}>{profile?.email}</div>
          <div className="text-sm capitalize" style={{ color: "var(--ink-3)" }}>{profile?.role ?? "user"}</div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Name</Label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Avatar URL</Label>
        <Input value={form.avatar} onChange={(e) => setForm((f) => ({ ...f, avatar: e.target.value }))} placeholder="https://..." />
      </div>
      <Button
        onClick={() => updateProfile.mutate({ name: form.name, avatar: form.avatar || undefined })}
        disabled={updateProfile.isPending || !form.name}
        className="h-auto py-3 rounded-(--r-sm) font-bold"
      >
        <Check size={16} />
        {updateProfile.isPending ? "Saving..." : "Save profile"}
      </Button>
    </>
  );
}

export function ProfileSettingsPage() {
  return (
    <PageShell title="Profile" icon={User}>
      <Panel><ProfileFields /></Panel>
    </PageShell>
  );
}

export function SecurityFields() {
  const changePassword = useChangePassword();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Current password</Label>
        <Input type="password" value={form.currentPassword} onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>New password</Label>
        <Input type="password" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Confirm new password</Label>
        <Input type="password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
      </div>
      <Button
        onClick={() => {
          if (form.newPassword !== form.confirm) {
            toast.error("Passwords don't match");
            return;
          }
          changePassword.mutate({ currentPassword: form.currentPassword, newPassword: form.newPassword });
          setForm({ currentPassword: "", newPassword: "", confirm: "" });
        }}
        disabled={changePassword.isPending || !form.currentPassword || form.newPassword.length < 8}
        className="h-auto py-3 rounded-(--r-sm) font-bold"
      >
        {changePassword.isPending ? "Updating..." : "Update password"}
      </Button>
    </>
  );
}

export function SecuritySettingsPage() {
  return (
    <PageShell title="Security" icon={Lock}>
      <Panel><SecurityFields /></Panel>
    </PageShell>
  );
}

export function PreferencesFields() {
  const { data: profile, isLoading } = useProfile();
  const updatePreferences = useUpdatePreferences();
  const currency = profile?.preferences?.currency ?? "INR";
  const weekStart = String(profile?.preferences?.weekStartsOn ?? 1);

  if (isLoading) return <Skeleton className="h-56 rounded-(--r-md)" />;

  return (
    <>
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "var(--ink-3)" }}>
          Default currency
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {CURRENCIES.map((c) => {
            const active = currency === c.code;
            return (
              <Button
                key={c.code}
                type="button"
                variant="ghost"
                aria-pressed={active}
                onClick={() => updatePreferences.mutate({ currency: c.code })}
                className="h-auto flex-col gap-0.5 rounded-(--r-sm) py-3 px-1"
                style={
                  active
                    ? { background: "var(--violet)", color: "var(--violet-fg)", boxShadow: "0 4px 14px rgba(0,0,0,.32)" }
                    : { background: "var(--card-2)", color: "var(--ink-2)" }
                }
              >
                <span className="text-[15px] font-bold leading-none">{c.symbol}</span>
                <span className="text-[10px] font-semibold mt-0.5">{c.code}</span>
              </Button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
          Week starts on
        </Label>
        <Select value={weekStart} onValueChange={(v) => updatePreferences.mutate({ weekStartsOn: Number(v) })}>
          <SelectTrigger className="h-10 text-sm font-medium w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Sunday</SelectItem>
            <SelectItem value="1">Monday</SelectItem>
            <SelectItem value="6">Saturday</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

export function PreferencesSettingsPage() {
  return (
    <PageShell title="Currency & Region" icon={CURRENCY_ICON}>
      <Panel><PreferencesFields /></Panel>
    </PageShell>
  );
}

const PUSH_STATUS_LABEL: Record<PushStatus, string> = {
  unsupported: "Not supported",
  blocked: "Blocked by browser",
  disabled: "Not enabled",
  enabled: "Enabled",
  loading: "Loading...",
};

const PUSH_STATUS_COLOR: Record<PushStatus, string> = {
  unsupported: "var(--ink-3)",
  blocked: "var(--red)",
  disabled: "var(--ink-2)",
  enabled: "var(--green)",
  loading: "var(--ink-3)",
};

export function NotificationFields() {
  const { data: profile, isLoading } = useProfile();
  const updatePreferences = useUpdatePreferences();
  const prefs = profile?.preferences;
  const push = usePushNotification();

  if (isLoading) return <Skeleton className="h-28 rounded-(--r-md)" />;

  return (
    <>
      {/* Push notifications row */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>Push notifications</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>EMI reminders, credit due dates, and budget alerts</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{
                color: PUSH_STATUS_COLOR[push.status],
                background: `color-mix(in srgb, ${PUSH_STATUS_COLOR[push.status]} 12%, transparent)`,
              }}
            >
              {PUSH_STATUS_LABEL[push.status]}
            </span>
            {push.status !== "unsupported" && push.status !== "blocked" && (
              <Switch
                checked={push.status === "enabled"}
                disabled={push.isLoading}
                aria-label={push.status === "enabled" ? "Disable push notifications" : "Enable push notifications"}
                onCheckedChange={(on) => {
                  const action = on ? push.subscribe() : push.unsubscribe();
                  action.catch((err: Error) => toast.error(err.message));
                }}
              />
            )}
          </div>
        </div>

        {push.status === "blocked" && (
          <div
            className="flex items-center gap-2 rounded-(--r-sm) px-3 py-2 text-xs"
            style={{ background: "color-mix(in srgb, var(--red) 10%, transparent)", color: "var(--red)" }}
          >
            <BellOff size={13} />
            Notifications are blocked in your browser settings. To enable, allow notifications for this site in your browser.
          </div>
        )}

        {push.error && push.status !== "enabled" && (
          <div
            className="flex items-center gap-2 rounded-(--r-sm) px-3 py-2 text-xs"
            style={{ background: "color-mix(in srgb, var(--red) 10%, transparent)", color: "var(--red)" }}
          >
            <BellOff size={13} />
            {push.error}
          </div>
        )}

        {push.status === "enabled" && (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                toast.promise(push.sendTest(), {
                  loading: "Sending test notification to this device...",
                  success: "Sent — check this device for the notification",
                  error: (err: Error) => err.message,
                });
              }}
              disabled={push.isLoading || !push.myEndpoint}
              className="h-auto self-start text-xs font-semibold px-3 py-1.5 rounded-(--r-sm)"
            >
              Send test notification to this device
            </Button>

            {push.devices.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-1">
                <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
                  Subscribed devices
                </div>
                {push.devices.map((d) => (
                  <div key={d.endpoint} className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-2)" }}>
                    <Smartphone size={13} style={{ color: "var(--ink-3)" }} />
                    {parseDeviceLabel(d.userAgent)}
                    {d.endpoint === push.myEndpoint && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, var(--violet) 15%, transparent)", color: "var(--violet)" }}>
                        this device
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Email notifications row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>Email notifications</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>Weekly summaries and account alerts</div>
        </div>
        <Switch
          checked={prefs?.emailNotifications ?? false}
          onCheckedChange={(value) => updatePreferences.mutate({ emailNotifications: value })}
          aria-label="Email notifications"
        />
      </div>
    </>
  );
}

export function NotificationSettingsPage() {
  return (
    <PageShell title="Notifications" icon={Bell}>
      <Panel><NotificationFields /></Panel>
    </PageShell>
  );
}

export function AppearanceFields() {
  const { theme, setTheme } = useTheme();
  const { glassIntensity, setGlassIntensity } = useGlassIntensity();
  const { data: profile } = useProfile();
  const updatePreferences = useUpdatePreferences();

  // next-themes (and our glass-intensity provider) only know the real value
  // after mount — SSR always renders the "no preference yet" state. Gating
  // `active` on `mounted` avoids a hydration mismatch on first paint (the
  // buttons briefly render unpressed, then correct instantly on mount).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const options = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Monitor },
  ] as const;

  const glassOptions = [
    { value: "subtle", label: "Subtle" },
    { value: "full", label: "Full" },
  ] as const;

  // Reconcile locally-applied glass intensity with the DB-synced value once
  // the profile loads, same as theme is reconciled from next-themes + DB.
  useEffect(() => {
    const dbValue = profile?.preferences?.glassIntensity;
    if (dbValue && dbValue !== glassIntensity) {
      setGlassIntensity(dbValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {options.map(({ value, label, Icon }) => {
          const active = mounted && theme === value;
          return (
            <Button
              key={value}
              type="button"
              variant="ghost"
              aria-pressed={active}
              onClick={() => {
                setTheme(value);
                updatePreferences.mutate({ theme: value });
              }}
              className="h-auto flex-col gap-2 rounded-(--r-md) py-5 font-bold"
              style={active ? { background: "var(--violet)", color: "var(--violet-fg)" } : { background: "var(--card-2)", color: "var(--ink-2)" }}
            >
              <Icon size={20} />
              {label}
            </Button>
          );
        })}
      </div>

      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "var(--ink-3)" }}>
          Glass intensity
        </div>
        <div className="grid grid-cols-2 gap-2">
          {glassOptions.map(({ value, label }) => {
            const active = mounted && glassIntensity === value;
            return (
              <Button
                key={value}
                type="button"
                variant="ghost"
                aria-pressed={active}
                onClick={() => {
                  setGlassIntensity(value);
                  updatePreferences.mutate({ glassIntensity: value });
                }}
                className="h-auto flex-col gap-2 rounded-(--r-md) py-5 font-bold"
                style={active ? { background: "var(--violet)", color: "var(--violet-fg)" } : { background: "var(--card-2)", color: "var(--ink-2)" }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function AppearanceSettingsPage() {
  return (
    <PageShell title="Appearance" icon={Sun}>
      <Panel><AppearanceFields /></Panel>
    </PageShell>
  );
}

const PRIVACY_ITEMS: [string, string][] = [
  ["Private by default", "Your financial records are scoped to your authenticated account."],
  ["Session control", "Signing out invalidates your browser session and returns you to login."],
];

export function PrivacyFields() {
  const { confirm, dialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete your account?",
      description: "This signs you out everywhere and blocks future logins. Your data is retained per policy but the account itself is deactivated immediately. This can't be undone from here.",
      confirmLabel: "Delete account",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await apiClient.delete("/me");
      toast.success("Account deleted");
      await signOut({ callbackUrl: "/login" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete account");
      setDeleting(false);
    }
  };

  return (
    <>
      {PRIVACY_ITEMS.map(([title, body]) => (
        <div key={title} className="rounded-(--r-md) p-4" style={{ background: "var(--card-2)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>{title}</div>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>{body}</p>
        </div>
      ))}

      <div className="rounded-(--r-md) p-4" style={{ background: "var(--card-2)" }}>
        <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>Download your data</div>
        <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>
          A full JSON export of your accounts, transactions, budgets, goals, and loans.
        </p>
        <a href="/api/me/export">
          <Button type="button" variant="secondary" className="h-auto mt-3 px-3.5 py-2 rounded-(--r-sm) font-bold text-sm">
            Download my data
          </Button>
        </a>
      </div>

      <div className="rounded-(--r-md) p-4" style={{ background: "color-mix(in srgb, var(--red) 8%, transparent)" }}>
        <div className="text-sm font-bold" style={{ color: "var(--red)" }}>Delete account</div>
        <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>
          Permanently deactivates your account and signs you out everywhere.
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void handleDelete()}
          disabled={deleting}
          className="h-auto mt-3 px-3.5 py-2 rounded-(--r-sm) font-bold text-sm"
          style={{ color: "var(--red)" }}
        >
          {deleting ? "Deleting..." : "Delete my account"}
        </Button>
      </div>
      {dialog}
    </>
  );
}

export function PrivacySettingsPage() {
  return (
    <PageShell title="Privacy" icon={Shield}>
      <Panel><PrivacyFields /></Panel>
    </PageShell>
  );
}

const HELP_ITEMS: [string, string][] = [
  ["Transactions", "Use the add button to record income, expenses, and transfers between accounts."],
  ["Budgets", "Create monthly category budgets and track spending against each limit."],
  ["Loans", "Record money borrowed or lent, then add repayments from the loan detail controls."],
  ["Account support", "For account access issues, use password reset from the login screen."],
];

export function HelpFields() {
  return (
    <>
      {HELP_ITEMS.map(([title, body]) => (
        <div key={title} className="rounded-(--r-md) p-4" style={{ background: "var(--card-2)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>{title}</div>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>{body}</p>
        </div>
      ))}
    </>
  );
}

export function HelpSettingsPage() {
  return (
    <PageShell title="Help & Support" icon={HelpCircle}>
      <Panel><HelpFields /></Panel>
    </PageShell>
  );
}
