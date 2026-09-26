"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { format, formatDistanceToNow } from "date-fns";
import { Clipboard, KeyRound, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
import { Skeleton } from "@/components/_ui/Skeleton";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  apiKeyStatus, useApiKeys, useCreateApiKey, useRevokeApiKey,
  type ApiKeyRecord, type ApiKeyStatus, type CreatedApiKey,
} from "@/features/settings/hooks/useApiKeys";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "7", label: "7 days" },
  { value: "never", label: "Never expires" },
];

const STATUS_STYLE: Record<ApiKeyStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "var(--green)" },
  expired: { label: "Expired", color: "var(--ink-3)" },
  revoked: { label: "Revoked", color: "var(--red)" },
};

function fieldLabel(text: string) {
  return (
    <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>{text}</Label>
  );
}

function formatDate(value?: string | null) {
  return value ? format(new Date(value), "d MMM yyyy") : null;
}

// Shown once, right after creation. The raw key is only held in component
// state and dropped as soon as the user clicks Done; the server can't return
// it again.
function NewKeyPanel({ created, onDone }: { created: CreatedApiKey; onDone: () => void }) {
  // QR for the phone app's Connect screen: server URL + key, rendered locally
  // (never sent anywhere) and dropped with the key when the panel closes.
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => {
    if (!showQr) return;
    let cancelled = false;
    void QRCode.toDataURL(JSON.stringify({ url: window.location.origin, key: created.key }), { margin: 1, width: 220 }).then(
      (url: string) => !cancelled && setQr(url)
    );
    return () => {
      cancelled = true;
    };
  }, [showQr, created.key]);

  const copy = async () => {
    await navigator.clipboard.writeText(created.key);
    toast.success("API key copied");
  };

  return (
    <div className="rounded-(--r-md) p-4 flex flex-col gap-3" style={{ background: "var(--card-2)" }}>
      <div className="flex items-start gap-2">
        <TriangleAlert size={16} className="flex-none mt-0.5" style={{ color: "var(--amber)" }} />
        <p className="text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
          Copy <strong>{created.label}</strong> now and store it somewhere safe, like your app&apos;s secure storage or a
          password manager. You won&apos;t be able to see it again.
        </p>
      </div>
      <code
        className="block break-all rounded-(--r-sm) px-3 py-2 font-mono text-xs select-all"
        style={{ background: "var(--card)", color: "var(--ink)" }}
      >
        {created.key}
      </code>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copy()} className="h-auto px-3.5 py-2 rounded-(--r-sm) font-bold text-sm">
          <Clipboard size={15} />
          Copy key
        </Button>
        <Button type="button" variant="secondary" onClick={() => setShowQr((v) => !v)} className="h-auto px-3.5 py-2 rounded-(--r-sm) font-bold text-sm">
          {showQr ? "Hide QR code" : "Show QR for phone app"}
        </Button>
        <Button type="button" onClick={onDone} className="h-auto px-3.5 py-2 rounded-(--r-sm) font-bold text-sm">
          I&apos;ve saved it
        </Button>
      </div>
      {showQr && qr && (
        <div className="flex flex-col items-start gap-1.5">
          <Image src={qr} alt="QR code containing this API key and the server address" width={220} height={220} unoptimized className="rounded-(--r-sm) bg-white p-2" />
          <span className="text-xs" style={{ color: "var(--ink-3)" }}>
            Scan from Expense Companion › Connect. Anyone who scans this gets the key, so don&apos;t screenshot or share it.
          </span>
        </div>
      )}
    </div>
  );
}

function CreateKeyForm({ onCreated, onCancel }: { onCreated: (k: CreatedApiKey) => void; onCancel: () => void }) {
  const createKey = useCreateApiKey();
  const [form, setForm] = useState({ label: "", expiry: "90", currentPassword: "" });

  const submit = () => {
    createKey.mutate(
      {
        label: form.label.trim(),
        expiresInDays: form.expiry === "never" ? null : Number(form.expiry),
        currentPassword: form.currentPassword,
      },
      {
        onSuccess: (created) => {
          setForm({ label: "", expiry: "90", currentPassword: "" });
          onCreated(created);
        },
        // Never keep the password around after a failed attempt either.
        onError: () => setForm((f) => ({ ...f, currentPassword: "" })),
      }
    );
  };

  return (
    <form
      className="rounded-(--r-md) p-4 flex flex-col gap-3"
      style={{ background: "var(--card-2)" }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        {fieldLabel("Name")}
        <Input
          value={form.label}
          maxLength={50}
          placeholder="e.g. Android phone, n8n"
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        {fieldLabel("Expires")}
        <Select value={form.expiry} onValueChange={(expiry) => setForm((f) => ({ ...f, expiry }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {EXPIRY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        {fieldLabel("Confirm with your password")}
        <Input
          type="password"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={createKey.isPending || !form.label.trim() || !form.currentPassword}
          className="h-auto px-3.5 py-2 rounded-(--r-sm) font-bold text-sm"
        >
          {createKey.isPending ? "Creating..." : "Create key"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="h-auto px-3.5 py-2 rounded-(--r-sm) font-bold text-sm">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function KeyRow({ apiKey, onRevoke, revoking }: { apiKey: ApiKeyRecord; onRevoke?: () => void; revoking?: boolean }) {
  const status = apiKeyStatus(apiKey);
  const style = STATUS_STYLE[status];
  const expires = formatDate(apiKey.expiresAt);

  const details = [
    `Created ${formatDate(apiKey.createdAt)}${apiKey.createdVia === "cli" ? " (CLI)" : ""}`,
    status === "revoked"
      ? `Revoked ${formatDate(apiKey.revokedAt) ?? ""}`
      : expires
        ? `${status === "expired" ? "Expired" : "Expires"} ${expires}`
        : "Never expires",
    apiKey.lastUsedAt
      ? `Last used ${formatDistanceToNow(new Date(apiKey.lastUsedAt), { addSuffix: true })}${apiKey.lastUsedIp && apiKey.lastUsedIp !== "unknown" ? ` from ${apiKey.lastUsedIp}` : ""}`
      : "Never used",
  ];

  return (
    <div className="rounded-(--r-md) p-4 flex items-start gap-3" style={{ background: "var(--card-2)" }}>
      <KeyRound size={16} className="flex-none mt-0.5" style={{ color: status === "active" ? "var(--violet)" : "var(--ink-3)" }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold truncate" style={{ color: "var(--ink)" }}>{apiKey.label}</span>
          <span className="font-mono text-xs" style={{ color: "var(--ink-3)" }}>…{apiKey.lastFour}</span>
          <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: style.color }}>{style.label}</span>
        </div>
        <div className="text-xs mt-1 flex flex-col gap-0.5" style={{ color: "var(--ink-3)" }}>
          {details.map((d) => <span key={d}>{d}</span>)}
        </div>
      </div>
      {onRevoke && (
        <Button
          type="button"
          variant="secondary"
          onClick={onRevoke}
          disabled={revoking}
          className="h-auto px-3 py-1.5 rounded-(--r-sm) font-bold text-xs flex-none"
          style={{ color: "var(--red)" }}
        >
          Revoke
        </Button>
      )}
    </div>
  );
}

export function ApiKeysFields() {
  const { data: keys, isLoading } = useApiKeys();
  const revokeKey = useRevokeApiKey();
  const { confirm, dialog } = useConfirm();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  if (isLoading) return <Skeleton className="h-40 rounded-(--r-md)" />;

  const active = (keys ?? []).filter((k) => apiKeyStatus(k) === "active");
  const history = (keys ?? []).filter((k) => apiKeyStatus(k) !== "active");

  const handleRevoke = async (k: ApiKeyRecord) => {
    const ok = await confirm({
      title: `Revoke "${k.label}"?`,
      description: "Anything using this key (the mobile app, n8n, a script) stops working right away. This can't be undone; you'd need to create a new key.",
      confirmLabel: "Revoke key",
      destructive: true,
    });
    if (ok) revokeKey.mutate(k._id);
  };

  return (
    <>
      <p className="text-sm leading-relaxed" style={{ color: "var(--ink-3)" }}>
        API keys let apps like the mobile companion or n8n add and read your data. Each key acts as you, so create a
        separate one for each app and revoke any you no longer use.
      </p>

      {created && <NewKeyPanel created={created} onDone={() => setCreated(null)} />}

      {creating ? (
        <CreateKeyForm
          onCreated={(k) => {
            setCreating(false);
            setCreated(k);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Button
          type="button"
          onClick={() => {
            setCreated(null);
            setCreating(true);
          }}
          className="h-auto py-3 rounded-(--r-sm) font-bold"
        >
          <Plus size={16} />
          Create API key
        </Button>
      )}

      {active.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-3)" }}>No active keys.</p>
      ) : (
        active.map((k) => (
          <KeyRow key={k._id} apiKey={k} onRevoke={() => void handleRevoke(k)} revoking={revokeKey.isPending} />
        ))
      )}

      {history.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-sm font-bold text-left"
            style={{ color: "var(--violet)" }}
          >
            {showHistory ? "Hide" : "Show"} revoked and expired keys ({history.length})
          </button>
          {showHistory && history.map((k) => <KeyRow key={k._id} apiKey={k} />)}
        </>
      )}
      {dialog}
    </>
  );
}
