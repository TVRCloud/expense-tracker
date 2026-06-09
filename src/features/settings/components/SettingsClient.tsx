"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { signOut } from "next-auth/react";
import {
  Sun, Moon, Monitor, Lock, Bell, CreditCard,
  User, LogOut, Check, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useProfile,
  useUpdateProfile,
  useUpdatePreferences,
  useChangePassword,
} from "@/features/settings/hooks/useProfile";

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

const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-(--r-lg) overflow-hidden"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      {children}
    </div>
  );
}

function CardHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div
      className="flex items-center gap-3 px-5 py-4"
      style={{ borderBottom: "1px solid var(--line)" }}
    >
      <div
        className="w-8 h-8 rounded-[10px] grid place-items-center flex-none"
        style={{ background: "rgba(0,0,0,.10)" }}
      >
        <Icon size={15} style={{ color: "var(--violet)" }} />
      </div>
      <span className="font-bold text-[14px]" style={{ color: "var(--ink)" }}>
        {title}
      </span>
    </div>
  );
}

function Row({
  label,
  sub,
  right,
  border = true,
}: {
  label: string;
  sub?: string;
  right: React.ReactNode;
  border?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 px-5 py-4"
      style={border ? { borderBottom: "1px solid var(--line)" } : undefined}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
          {label}
        </div>
        {sub && (
          <div className="text-xs mt-0.5 leading-snug" style={{ color: "var(--ink-3)" }}>
            {sub}
          </div>
        )}
      </div>
      <div className="flex-none">{right}</div>
    </div>
  );
}

export function SettingsClient() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const updatePreferences = useUpdatePreferences();
  const changePassword = useChangePassword();
  const { theme, setTheme } = useTheme();

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });

  const currency = profile?.preferences?.currency ?? "USD";
  const language = profile?.preferences?.language ?? "en";
  const weekStart = String(profile?.preferences?.weekStartsOn ?? 1);
  const pushOn = profile?.preferences?.pushNotifications ?? false;
  const emailOn = profile?.preferences?.emailNotifications ?? true;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {[160, 280, 140, 160, 120].map((h, i) => (
          <Skeleton key={i} className="rounded-(--r-lg)" style={{ height: h }} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-8">

      {/* ── Profile ─────────────────────────────────────────── */}
      <Card>
        <CardHeader icon={User} title="Profile" />
        <div className="p-5 flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl grid place-items-center text-white font-extrabold text-2xl flex-none select-none"
            style={{
              background: "linear-gradient(150deg,var(--violet),var(--violet-2))",
              boxShadow: "0 8px 20px rgba(0,0,0,.28)",
            }}
          >
            {profile?.name?.[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { updateProfile.mutate({ name }); setEditingName(false); }
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="flex-1 rounded-(--r-sm) px-3 py-2 text-sm font-bold outline-none"
                  style={{
                    background: "var(--card-2)",
                    color: "var(--ink)",
                    border: "1.5px solid var(--violet)",
                  }}
                />
                <button
                  onClick={() => { updateProfile.mutate({ name }); setEditingName(false); }}
                  className="w-8 h-8 rounded-full grid place-items-center"
                  style={{ background: "var(--violet)", color: "#fff" }}
                >
                  <Check size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setName(profile?.name ?? ""); setEditingName(true); }}
                className="flex items-center gap-2 font-bold text-[15px] hover:opacity-75 transition-opacity"
                style={{ color: "var(--ink)" }}
              >
                {profile?.name ?? "—"}
                <span className="text-xs font-semibold" style={{ color: "var(--violet)" }}>Edit</span>
              </button>
            )}
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
        </div>
      </Card>

      {/* ── Currency ────────────────────────────────────────── */}
      <Card>
        <CardHeader icon={CreditCard} title="Currency & Preferences" />
        <div className="p-5 flex flex-col gap-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "var(--ink-3)" }}>
              Default Currency
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {CURRENCIES.map((c) => {
                const active = currency === c.code;
                return (
                  <button
                    key={c.code}
                    onClick={() => updatePreferences.mutate({ currency: c.code })}
                    className="flex flex-col items-center gap-0.5 rounded-(--r-sm) py-3 px-1 transition-all"
                    style={
                      active
                        ? { background: "var(--violet)", color: "#fff", boxShadow: "0 4px 14px rgba(0,0,0,.32)" }
                        : { background: "var(--card-2)", color: "var(--ink-2)" }
                    }
                  >
                    <span className="text-[15px] font-bold leading-none">{c.symbol}</span>
                    <span className="text-[10px] font-semibold mt-0.5">{c.code}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
                Language
              </label>
              <Select value={language} onValueChange={(v) => updatePreferences.mutate({ language: v })}>
                <SelectTrigger className="h-10 text-sm font-medium" style={{ background: "var(--card-2)", border: "1.5px solid var(--line)", color: "var(--ink)" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { code: "en", label: "English" },
                    { code: "es", label: "Español" },
                    { code: "fr", label: "Français" },
                    { code: "de", label: "Deutsch" },
                    { code: "ja", label: "日本語" },
                    { code: "zh", label: "中文" },
                    { code: "ar", label: "العربية" },
                    { code: "hi", label: "हिन्दी" },
                  ].map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
                Week starts on
              </label>
              <Select value={weekStart} onValueChange={(v) => updatePreferences.mutate({ weekStartsOn: Number(v) })}>
                <SelectTrigger className="h-10 text-sm font-medium" style={{ background: "var(--card-2)", border: "1.5px solid var(--line)", color: "var(--ink)" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Sunday</SelectItem>
                  <SelectItem value="1">Monday</SelectItem>
                  <SelectItem value="6">Saturday</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Appearance ──────────────────────────────────────── */}
      <Card>
        <CardHeader icon={Sun} title="Appearance" />
        <div className="p-5">
          <div className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "var(--ink-3)" }}>
            Theme
          </div>
          <div className="flex gap-2">
            {THEMES.map(({ value, label, Icon }) => {
              const active = theme === value;
              return (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className="flex-1 flex flex-col items-center gap-2 py-4 rounded-(--r-md) font-semibold text-sm transition-all"
                  style={
                    active
                      ? { background: "var(--violet)", color: "#fff", boxShadow: "0 4px 14px rgba(0,0,0,.30)" }
                      : { background: "var(--card-2)", color: "var(--ink-2)" }
                  }
                >
                  <Icon size={20} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ── Notifications ───────────────────────────────────── */}
      <Card>
        <CardHeader icon={Bell} title="Notifications" />
        <Row
          label="Push notifications"
          sub="Budget alerts and reminders on your device"
          right={
            <Switch
              checked={pushOn}
              onCheckedChange={(v) => updatePreferences.mutate({ pushNotifications: v })}
            />
          }
        />
        <Row
          label="Email notifications"
          sub="Weekly summaries and account alerts"
          border={false}
          right={
            <Switch
              checked={emailOn}
              onCheckedChange={(v) => updatePreferences.mutate({ emailNotifications: v })}
            />
          }
        />
      </Card>

      {/* ── Security ────────────────────────────────────────── */}
      <Card>
        <CardHeader icon={Lock} title="Security" />
        {!showPw ? (
          <button
            onClick={() => setShowPw(true)}
            className="flex items-center justify-between w-full px-5 py-4 transition-opacity hover:opacity-75"
          >
            <span className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
              Change password
            </span>
            <ChevronRight size={16} style={{ color: "var(--ink-3)" }} />
          </button>
        ) : (
          <form
            className="p-5 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (pwForm.next !== pwForm.confirm) { toast.error("Passwords don't match"); return; }
              changePassword.mutate({ currentPassword: pwForm.current, newPassword: pwForm.next });
              setPwForm({ current: "", next: "", confirm: "" });
              setShowPw(false);
            }}
          >
            {(["current", "next", "confirm"] as const).map((key) => (
              <div key={key} className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
                  {key === "current" ? "Current password" : key === "next" ? "New password" : "Confirm new password"}
                </label>
                <input
                  type="password"
                  value={pwForm[key]}
                  onChange={(e) => setPwForm((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder="••••••••"
                  className="rounded-(--r-sm) px-4 py-2.5 text-sm outline-none"
                  style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
                />
              </div>
            ))}
            <div className="flex gap-3 mt-1">
              <button
                type="submit"
                disabled={changePassword.isPending || !pwForm.current || !pwForm.next}
                className="flex-1 py-2.5 rounded-(--r-sm) text-sm font-bold disabled:opacity-50"
                style={{ background: "var(--violet)", color: "#fff" }}
              >
                {changePassword.isPending ? "Updating…" : "Update"}
              </button>
              <button
                type="button"
                onClick={() => setShowPw(false)}
                className="px-5 py-2.5 rounded-(--r-sm) text-sm font-bold"
                style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </Card>

      {/* ── Sign out ────────────────────────────────────────── */}
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="flex items-center justify-center gap-2 rounded-(--r-md) py-4 text-sm font-bold transition-opacity hover:opacity-80"
        style={{ background: "var(--card)", color: "var(--red)", boxShadow: "var(--shadow-sm)" }}
      >
        <LogOut size={16} />
        Sign out
      </button>
    </div>
  );
}
