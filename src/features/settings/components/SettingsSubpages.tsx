"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "next-themes";
import { ArrowLeft, Bell, BellOff, Check, HelpCircle, Lock, Monitor, Moon, Shield, Smartphone, Sun, User } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useChangePassword, useProfile, useUpdatePreferences, useUpdateProfile } from "@/features/settings/hooks/useProfile";
import { usePushNotification, type PushStatus } from "@/features/settings/hooks/usePushNotification";
import { parseDeviceLabel } from "@/lib/device-label";

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
    <section className="rounded-[var(--r-lg)] p-5 flex flex-col gap-4" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
      {children}
    </section>
  );
}

export function ProfileSettingsPage() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const [form, setForm] = useState({ name: "", avatar: "" });

  useEffect(() => {
    if (!profile) return;
    setForm({ name: profile.name ?? "", avatar: profile.avatar ?? "" });
  }, [profile]);

  return (
    <PageShell title="Profile" icon={User}>
      <Panel>
        {isLoading ? (
          <Skeleton className="h-40 rounded-[var(--r-md)]" />
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-[18px] grid place-items-center text-white font-extrabold text-2xl overflow-hidden" style={{ background: "linear-gradient(150deg,var(--violet),var(--violet-2))" }}>
                {form.avatar ? <Image src={form.avatar} alt={form.name} width={64} height={64} className="w-full h-full object-cover" /> : (form.name[0]?.toUpperCase() ?? "U")}
              </div>
              <div className="min-w-0">
                <div className="font-bold truncate" style={{ color: "var(--ink)" }}>{profile?.email}</div>
                <div className="text-sm capitalize" style={{ color: "var(--ink-3)" }}>{profile?.role ?? "user"}</div>
              </div>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Name</span>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Avatar URL</span>
              <input value={form.avatar} onChange={(e) => setForm((f) => ({ ...f, avatar: e.target.value }))} placeholder="https://..." className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
            </label>
            <button
              onClick={() => updateProfile.mutate({ name: form.name, avatar: form.avatar || undefined })}
              disabled={updateProfile.isPending || !form.name}
              className="inline-flex items-center justify-center gap-2 rounded-(--r-sm) py-3 text-sm font-bold disabled:opacity-50"
              style={{ background: "var(--violet)", color: "#fff" }}
            >
              <Check size={16} />
              {updateProfile.isPending ? "Saving..." : "Save profile"}
            </button>
          </>
        )}
      </Panel>
    </PageShell>
  );
}

export function SecuritySettingsPage() {
  const changePassword = useChangePassword();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });

  return (
    <PageShell title="Security" icon={Lock}>
      <Panel>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Current password</span>
          <input type="password" value={form.currentPassword} onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>New password</span>
          <input type="password" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Confirm new password</span>
          <input type="password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
        </label>
        <button
          onClick={() => {
            if (form.newPassword !== form.confirm) {
              toast.error("Passwords don't match");
              return;
            }
            changePassword.mutate({ currentPassword: form.currentPassword, newPassword: form.newPassword });
            setForm({ currentPassword: "", newPassword: "", confirm: "" });
          }}
          disabled={changePassword.isPending || !form.currentPassword || form.newPassword.length < 8}
          className="rounded-(--r-sm) py-3 text-sm font-bold disabled:opacity-50"
          style={{ background: "var(--violet)", color: "#fff" }}
        >
          {changePassword.isPending ? "Updating..." : "Update password"}
        </button>
      </Panel>
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

export function NotificationSettingsPage() {
  const { data: profile, isLoading } = useProfile();
  const updatePreferences = useUpdatePreferences();
  const prefs = profile?.preferences;
  const push = usePushNotification();

  return (
    <PageShell title="Notifications" icon={Bell}>
      <Panel>
        {isLoading ? (
          <Skeleton className="h-28 rounded-[var(--r-md)]" />
        ) : (
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

              {push.status === "enabled" && (
                <>
                  <button
                    onClick={() => {
                      toast.promise(push.sendTest(), {
                        loading: "Sending test notification to this device...",
                        success: "Sent — check this device for the notification",
                        error: (err: Error) => err.message,
                      });
                    }}
                    disabled={push.isLoading || !push.myEndpoint}
                    className="self-start text-xs font-semibold px-3 py-1.5 rounded-(--r-sm) transition-opacity disabled:opacity-50"
                    style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
                  >
                    Send test notification to this device
                  </button>

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
              <Switch checked={prefs?.emailNotifications ?? false} onCheckedChange={(value) => updatePreferences.mutate({ emailNotifications: value })} />
            </div>
          </>
        )}
      </Panel>
    </PageShell>
  );
}

export function AppearanceSettingsPage() {
  const { theme, setTheme } = useTheme();
  const updatePreferences = useUpdatePreferences();
  const options = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Monitor },
  ] as const;

  return (
    <PageShell title="Appearance" icon={Sun}>
      <Panel>
        <div className="grid grid-cols-3 gap-2">
          {options.map(({ value, label, Icon }) => {
            const active = theme === value;
            return (
              <button
                key={value}
                onClick={() => {
                  setTheme(value);
                  updatePreferences.mutate({ theme: value });
                }}
                className="flex flex-col items-center gap-2 rounded-[var(--r-md)] py-5 text-sm font-bold"
                style={active ? { background: "var(--violet)", color: "#fff" } : { background: "var(--card-2)", color: "var(--ink-2)" }}
              >
                <Icon size={20} />
                {label}
              </button>
            );
          })}
        </div>
      </Panel>
    </PageShell>
  );
}

export function PrivacySettingsPage() {
  return (
    <PageShell title="Privacy" icon={Shield}>
      <Panel>
        {[
          ["Private by default", "Your financial records are scoped to your authenticated account."],
          ["Session control", "Signing out invalidates your browser session and returns you to login."],
          ["Data changes", "Account deletion is intentionally not exposed here until a confirmation flow is implemented."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-[var(--r-md)] p-4" style={{ background: "var(--card-2)" }}>
            <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>{title}</div>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>{body}</p>
          </div>
        ))}
      </Panel>
    </PageShell>
  );
}

export function HelpSettingsPage() {
  return (
    <PageShell title="Help & Support" icon={HelpCircle}>
      <Panel>
        {[
          ["Transactions", "Use the add button to record income, expenses, and transfers between accounts."],
          ["Budgets", "Create monthly category budgets and track spending against each limit."],
          ["Loans", "Record money borrowed or lent, then add repayments from the loan detail controls."],
          ["Account support", "For account access issues, use password reset from the login screen."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-[var(--r-md)] p-4" style={{ background: "var(--card-2)" }}>
            <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>{title}</div>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--ink-3)" }}>{body}</p>
          </div>
        ))}
      </Panel>
    </PageShell>
  );
}
