"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { signOut } from "next-auth/react";
import { Bell, BellOff, Check, HelpCircle, KeyRound, Lock, Monitor, Moon, Shield, Smartphone, Sun, User } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { Switch } from "@/components/_ui/Switch";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Button } from "@/components/_ui/Button";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { Input } from "@/components/_ui/Input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CURRENCY_ICON } from "@/lib/icons";
import { useChangePassword, useProfile, useUpdatePreferences, useUpdateProfile } from "@/features/settings/hooks/useProfile";
import { useGlassIntensity } from "@/components/providers/GlassIntensityProvider";
import { usePushNotification, type PushStatus } from "@/features/settings/hooks/usePushNotification";
import { parseDeviceLabel } from "@/lib/device-label";
import { DEFAULT_TIME_ZONE } from "@/lib/spend-limit-time";
import { timeZoneOptions } from "@/features/settings/timezones";
import { ApiKeysFields } from "./ApiKeysSection";
import { FieldLabel, FormBlock, Group, Row, Segmented } from "./SettingsUi";

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

/** Subpage frame: large title on mobile (drill-down), compact heading beside
 * the two-pane list on desktop. Content is a stack of grouped sections. */
function PageShell({
  title,
  children,
}: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 pb-6">
      <h2
        className="px-1 text-[28px] leading-[1.1] font-bold tracking-[-0.025em] lg:text-[19px] lg:leading-[1.2] lg:font-semibold lg:tracking-[-0.015em]"
        style={{ color: "var(--ink)" }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

const PRIMARY_BTN = "h-11 w-full font-semibold";

export function ProfileFields() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const [form, setForm] = useState({ name: "", avatar: "" });

  useEffect(() => {
    if (!profile) return;
    setForm({ name: profile.name ?? "", avatar: profile.avatar ?? "" });
  }, [profile]);

  if (isLoading) return <Skeleton className="h-64 rounded-(--r-md)" />;

  return (
    <>
      <div className="flex items-center gap-4 px-1">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full text-2xl font-semibold" style={{ background: "linear-gradient(150deg,var(--violet),var(--violet-2))", color: "var(--violet-fg)" }}>
          {form.avatar ? <Image src={form.avatar} alt={form.name} width={64} height={64} className="w-full h-full object-cover" /> : (form.name[0]?.toUpperCase() ?? "U")}
        </div>
        <div className="min-w-0">
          <div className="truncate" style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>{profile?.email}</div>
          <div className="capitalize" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>{profile?.role ?? "user"}</div>
        </div>
      </div>
      <Group>
        <FormBlock>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="settings-subpages-name-1">Name</FieldLabel>
            <Input id="settings-subpages-name-1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} aria-invalid={!form.name} />
            {!form.name && <p className="text-xs" style={{ color: "var(--red)" }}>Name can&apos;t be empty.</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="settings-subpages-avatar-url-2">Avatar URL</FieldLabel>
            <Input id="settings-subpages-avatar-url-2" value={form.avatar} onChange={(e) => setForm((f) => ({ ...f, avatar: e.target.value }))} placeholder="https://..." />
          </div>
        </FormBlock>
      </Group>
      <Button
        onClick={() => updateProfile.mutate({ name: form.name, avatar: form.avatar || undefined })}
        disabled={updateProfile.isPending || !form.name}
        className={PRIMARY_BTN}
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
      <ProfileFields />
    </PageShell>
  );
}

export function SecurityFields() {
  const changePassword = useChangePassword();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const tooShort = form.newPassword.length > 0 && form.newPassword.length < 8;
  const mismatch = form.confirm.length > 0 && form.newPassword !== form.confirm;

  return (
    <>
      <Group footer="Use at least 8 characters.">
        <FormBlock>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="settings-subpages-current-password-3">Current password</FieldLabel>
            <Input id="settings-subpages-current-password-3" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="settings-subpages-new-password-4">New password</FieldLabel>
            <Input id="settings-subpages-new-password-4" type="password" autoComplete="new-password" aria-invalid={tooShort} value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} />
            {tooShort && <p className="text-xs" style={{ color: "var(--red)" }}>Needs at least 8 characters.</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="settings-subpages-confirm-new-password-5">Confirm new password</FieldLabel>
            <Input id="settings-subpages-confirm-new-password-5" type="password" autoComplete="new-password" aria-invalid={mismatch} value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
            {mismatch && <p className="text-xs" style={{ color: "var(--red)" }}>Passwords don&apos;t match.</p>}
          </div>
        </FormBlock>
      </Group>
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
        className={PRIMARY_BTN}
      >
        {changePassword.isPending ? "Updating..." : "Update password"}
      </Button>
    </>
  );
}

export function SecuritySettingsPage() {
  return (
    <PageShell title="Security" icon={Lock}>
      <SecurityFields />
    </PageShell>
  );
}

export function ApiKeysSettingsPage() {
  return (
    <PageShell title="API keys" icon={KeyRound}>
      <ApiKeysFields />
    </PageShell>
  );
}

export function PreferencesFields() {
  const { data: profile, isLoading } = useProfile();
  const updatePreferences = useUpdatePreferences();
  const currency = profile?.preferences?.currency ?? "INR";
  const weekStart = String(profile?.preferences?.weekStartsOn ?? 1);
  const timezone = profile?.preferences?.timezone ?? DEFAULT_TIME_ZONE;

  if (isLoading) return <Skeleton className="h-56 rounded-(--r-md)" />;

  return (
    <>
      <Group title="Default currency">
        <FormBlock>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
            {CURRENCIES.map((c) => {
              const active = currency === c.code;
              return (
                <Button
                  key={c.code}
                  type="button"
                  variant="ghost"
                  aria-pressed={active}
                  onClick={() => updatePreferences.mutate({ currency: c.code })}
                  className="h-auto flex-col gap-0.5 rounded-(--r-sm) px-1 py-3"
                  style={
                    active
                      ? { background: "var(--violet)", color: "var(--violet-fg)" }
                      : { background: "var(--card-2)", color: "var(--ink-2)" }
                  }
                >
                  <span className="text-[16px] font-semibold leading-none">{c.symbol}</span>
                  <span className="mt-0.5 text-[11px] font-medium opacity-80">{c.code}</span>
                </Button>
              );
            })}
          </div>
        </FormBlock>
      </Group>

      <Group title="Region">
        <Row
          title="Week starts on"
          trailing={
            <Select value={weekStart} onValueChange={(v) => updatePreferences.mutate({ weekStartsOn: Number(v) })}>
              <SelectTrigger className="h-10 w-36 text-sm font-medium" aria-label="Week starts on">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Sunday</SelectItem>
                <SelectItem value="1">Monday</SelectItem>
                <SelectItem value="6">Saturday</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <Row
          title="Time zone"
          description="Where a day starts for your spend limit."
          trailing={
            <Select value={timezone} onValueChange={(v) => updatePreferences.mutate({ timezone: v })}>
              <SelectTrigger className="h-10 w-56 text-sm font-medium" aria-label="Time zone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {timeZoneOptions(timezone).map((z) => (
                  <SelectItem key={z} value={z}>{z}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </Group>
    </>
  );
}

export function PreferencesSettingsPage() {
  return (
    <PageShell title="Currency & Region" icon={CURRENCY_ICON}>
      <PreferencesFields />
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

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-2 px-4 py-3 text-xs"
      style={{ background: "color-mix(in srgb, var(--red) 8%, transparent)", color: "var(--red)" }}
    >
      <BellOff size={13} className="mt-0.5 flex-none" />
      <span>{children}</span>
    </div>
  );
}

export function NotificationFields() {
  const { data: profile, isLoading } = useProfile();
  const updatePreferences = useUpdatePreferences();
  const prefs = profile?.preferences;
  const push = usePushNotification();

  if (isLoading) return <Skeleton className="h-28 rounded-(--r-md)" />;

  return (
    <>
      <Group>
        <Row
          title="Push notifications"
          description="EMI reminders, credit due dates, and budget alerts"
          trailing={
            <>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
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
            </>
          }
        />

        {push.status === "blocked" && (
          <Notice>Notifications are blocked in your browser settings. To enable, allow notifications for this site in your browser.</Notice>
        )}

        {push.error && push.status !== "enabled" && <Notice>{push.error}</Notice>}

        {push.status === "enabled" && (
          <Row
            title="Test notification"
            description="Send a notification to this device"
            trailing={
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
                className="h-9 px-3.5 text-[13px]"
              >
                Send test
              </Button>
            }
          />
        )}

        <Row
          title="Email notifications"
          description="Weekly summaries and account alerts"
          trailing={
            <Switch
              checked={prefs?.emailNotifications ?? false}
              onCheckedChange={(value) => updatePreferences.mutate({ emailNotifications: value })}
              aria-label="Email notifications"
            />
          }
        />
      </Group>

      {push.status === "enabled" && push.devices.length > 0 && (
        <Group title="Subscribed devices" inset={48}>
          {push.devices.map((d) => (
            <div key={d.endpoint} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
              <Smartphone size={16} className="flex-none" style={{ color: "var(--ink-3)" }} />
              <span className="min-w-0 flex-1 truncate" style={{ font: "var(--text-body)", color: "var(--ink)" }}>
                {parseDeviceLabel(d.userAgent)}
              </span>
              {d.endpoint === push.myEndpoint && (
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "color-mix(in srgb, var(--violet) 14%, transparent)", color: "var(--violet)" }}>
                  This device
                </span>
              )}
            </div>
          ))}
        </Group>
      )}
    </>
  );
}

export function NotificationSettingsPage() {
  return (
    <PageShell title="Notifications" icon={Bell}>
      <NotificationFields />
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
      <Group title="Theme">
        <FormBlock>
          <div className="grid grid-cols-3 gap-3">
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
                  className="relative h-auto flex-col gap-2 rounded-(--r-md) py-5"
                  style={{
                    background: "var(--card-2)",
                    color: active ? "var(--ink)" : "var(--ink-2)",
                    boxShadow: active ? "inset 0 0 0 2px var(--violet)" : "none",
                  }}
                >
                  <Icon size={22} />
                  {label}
                  {active && <Check size={14} className="absolute top-2 right-2" style={{ color: "var(--violet)" }} />}
                </Button>
              );
            })}
          </div>
        </FormBlock>
      </Group>

      <Group title="Surfaces" footer="Full adds a specular highlight and pointer shine to cards and buttons.">
        <Row
          title="Glass intensity"
          trailing={
            <Segmented
              ariaLabel="Glass intensity"
              value={mounted ? glassIntensity : null}
              options={glassOptions}
              onChange={(value) => {
                setGlassIntensity(value);
                updatePreferences.mutate({ glassIntensity: value });
              }}
            />
          }
        />
      </Group>
    </>
  );
}

export function AppearanceSettingsPage() {
  return (
    <PageShell title="Appearance" icon={Sun}>
      <AppearanceFields />
    </PageShell>
  );
}

const PRIVACY_ITEMS: [string, string][] = [
  ["Private by default", "Your financial records are scoped to your authenticated account."],
  ["Session control", "Signing out invalidates your browser session and returns you to login."],
];

function TextRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-3.5">
      <div style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>{title}</div>
      <p className="mt-1 leading-relaxed" style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>{body}</p>
    </div>
  );
}

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
      <Group>
        {PRIVACY_ITEMS.map(([title, body]) => (
          <TextRow key={title} title={title} body={body} />
        ))}
      </Group>

      <Group title="Your data">
        <Row
          title="Download your data"
          description="A full JSON export of your accounts, transactions, budgets, goals, and loans."
          trailing={
            <Button asChild type="button" variant="secondary" className="h-9 px-3.5 text-[13px]">
              <a href="/api/me/export">Download</a>
            </Button>
          }
        />
      </Group>

      <Group title="Danger zone">
        <Row
          danger
          title="Delete account"
          description="Permanently deactivates your account and signs you out everywhere."
          trailing={
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="h-9 px-3.5 text-[13px]"
              style={{ color: "var(--red)" }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          }
        />
      </Group>
      {dialog}
    </>
  );
}

export function PrivacySettingsPage() {
  return (
    <PageShell title="Privacy" icon={Shield}>
      <PrivacyFields />
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
    <Group>
      {HELP_ITEMS.map(([title, body]) => (
        <TextRow key={title} title={title} body={body} />
      ))}
    </Group>
  );
}

export function HelpSettingsPage() {
  return (
    <PageShell title="Help & Support" icon={HelpCircle}>
      <HelpFields />
    </PageShell>
  );
}
