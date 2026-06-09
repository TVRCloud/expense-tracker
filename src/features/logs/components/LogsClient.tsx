"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Fingerprint,
  KeyRound,
  Lock,
  Search,
  ShieldCheck,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import apiClient from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type OtpStatus = {
  isEnabled: boolean;
  hasPendingSetup: boolean;
  recoveryCodesRemaining: number;
  unlocked: boolean;
};

type SetupPayload = {
  label: string;
  secret: string;
  qrCodeDataUrl: string;
};

type LedgerBlock = {
  _id: string;
  sequence: number;
  scope: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  hash: string;
  previousHash: string;
  createdAt: string;
};

type LedgerResponse = {
  data: LedgerBlock[];
  total: number;
  skip: number;
  limit: number;
};

type VerifyResponse = {
  valid: boolean;
  checkedBlocks: number;
  latestHash?: string;
  failedAtSequence?: number;
  reason?: string;
};

const SCOPES = [
  { value: "", label: "All" },
  { value: "transaction", label: "Transactions" },
  { value: "account", label: "Accounts" },
  { value: "budget", label: "Budgets" },
  { value: "goal", label: "Goals" },
  { value: "loan", label: "Loans" },
  { value: "repayment", label: "Repayments" },
  { value: "credit_statement", label: "Statements" },
];

const LOG_DEVICE_KEY = "finance_os_logs_device_unlock_id";
const LOG_DEVICE_HEADER = "x-logs-device-id";

function randomDeviceId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getLogsDeviceId() {
  if (typeof window === "undefined") return "";
  const existing = sessionStorage.getItem(LOG_DEVICE_KEY);
  if (existing) return existing;
  const next = randomDeviceId();
  sessionStorage.setItem(LOG_DEVICE_KEY, next);
  return next;
}

function logsHeaders() {
  return { headers: { [LOG_DEVICE_HEADER]: getLogsDeviceId() } };
}

function useOtpStatus() {
  return useQuery<{ data: OtpStatus }>({
    queryKey: ["logs", "otp-status"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: OtpStatus }>("/logs/otp/status", logsHeaders());
      return res.data;
    },
  });
}

function compactHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function compactValue(value: string, start = 8, end = 6) {
  if (!value) return "None";
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function BlockPayload({ value }: { value: unknown }) {
  if (!value) return <span style={{ color: "var(--ink-3)" }}>None</span>;
  return (
    <pre
      className="max-h-56 overflow-auto rounded-[var(--r-sm)] p-3 text-xs"
      style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function RecoveryCodesPanel({ codes, onDone }: { codes: string[]; onDone?: () => void }) {
  const copyRecoveryCodes = async () => {
    await navigator.clipboard.writeText(codes.join("\n"));
    toast.success("Recovery codes copied");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {codes.map((item) => (
          <div
            key={item}
            className="rounded-[var(--r-sm)] px-3 py-2 font-mono text-sm font-bold"
            style={{ background: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }}
          >
            {item}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={copyRecoveryCodes}
          className="flex items-center gap-2 px-4 py-3 rounded-[var(--r-sm)] font-bold"
          style={{ background: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }}
        >
          <Clipboard size={17} />
          Copy codes
        </button>
        {onDone && (
          <button
            onClick={onDone}
            className="px-4 py-3 rounded-[var(--r-sm)] font-bold"
            style={{ background: "var(--violet)", color: "#fff" }}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

function SetupPanel({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const setup = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: SetupPayload }>("/logs/otp/setup");
      return res.data.data;
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const verify = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: { recoveryCodes?: string[] } }>("/logs/otp/verify", {
        code,
        mode: "setup",
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes ?? []);
      void qc.invalidateQueries({ queryKey: ["logs", "otp-status"] });
      toast.success("Authenticator enabled");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full grid place-items-center" style={{ background: "var(--card-2)" }}>
          <Fingerprint size={22} style={{ color: "var(--violet)" }} />
        </div>
        <div>
          <h2 className="font-extrabold text-xl" style={{ color: "var(--ink)" }}>Secure logs access</h2>
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>Authenticator setup is required before logs can open.</p>
        </div>
      </div>

      {!setup.data && recoveryCodes.length === 0 && (
        <button
          onClick={() => setup.mutate()}
          disabled={setup.isPending}
          className="w-fit px-4 py-3 rounded-[var(--r-sm)] font-bold"
          style={{ background: "var(--violet)", color: "#fff" }}
        >
          {setup.isPending ? "Creating..." : "Create authenticator setup"}
        </button>
      )}

      {setup.data && recoveryCodes.length === 0 && (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <div className="rounded-[var(--r-md)] p-4" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
            <Image
              src={setup.data.qrCodeDataUrl}
              alt="Authenticator QR code"
              width={228}
              height={228}
              unoptimized
              className="w-full rounded-[var(--r-sm)]"
            />
          </div>
          <div className="flex flex-col gap-3">
            <div className="rounded-[var(--r-md)] p-4" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
              <div className="text-xs font-bold uppercase" style={{ color: "var(--ink-3)" }}>Manual key</div>
              <div className="mt-2 break-all font-mono text-sm" style={{ color: "var(--ink)" }}>{setup.data.secret}</div>
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              maxLength={8}
              placeholder="6-digit code"
              className="rounded-[var(--r-sm)] px-4 py-3 font-bold outline-none"
              style={{ background: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }}
            />
            <button
              onClick={() => verify.mutate()}
              disabled={verify.isPending || code.length < 6}
              className="w-fit px-4 py-3 rounded-[var(--r-sm)] font-bold disabled:opacity-60"
              style={{ background: "var(--violet)", color: "#fff" }}
            >
              {verify.isPending ? "Verifying..." : "Enable logs access"}
            </button>
          </div>
        </div>
      )}

      {recoveryCodes.length > 0 && (
        <RecoveryCodesPanel codes={recoveryCodes} onDone={onDone} />
      )}
    </section>
  );
}

function UnlockPanel() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"unlock" | "recovery">("unlock");

  const verify = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post("/logs/otp/verify", { code, mode }, logsHeaders());
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["logs"] });
      toast.success("Logs unlocked");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <section className="flex max-w-md flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full grid place-items-center" style={{ background: "var(--card-2)" }}>
          <Lock size={22} style={{ color: "var(--violet)" }} />
        </div>
        <div>
          <h2 className="font-extrabold text-xl" style={{ color: "var(--ink)" }}>Logs locked</h2>
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>Enter an authenticator or recovery code.</p>
        </div>
      </div>

      <div className="flex gap-2">
        {(["unlock", "recovery"] as const).map((item) => (
          <button
            key={item}
            onClick={() => setMode(item)}
            className="px-3 py-2 rounded-[var(--r-sm)] text-sm font-bold"
            style={{
              background: mode === item ? "var(--violet)" : "var(--card)",
              color: mode === item ? "#fff" : "var(--ink-2)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            {item === "unlock" ? "Authenticator" : "Recovery"}
          </button>
        ))}
      </div>

      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode={mode === "unlock" ? "numeric" : "text"}
        placeholder={mode === "unlock" ? "6-digit code" : "Recovery code"}
        className="rounded-[var(--r-sm)] px-4 py-3 font-bold outline-none"
        style={{ background: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }}
      />
      <button
        onClick={() => verify.mutate()}
        disabled={verify.isPending || code.length < 6}
        className="w-fit px-4 py-3 rounded-[var(--r-sm)] font-bold disabled:opacity-60"
        style={{ background: "var(--violet)", color: "#fff" }}
      >
        {verify.isPending ? "Checking..." : "Unlock logs"}
      </button>
    </section>
  );
}

type ManagementMode = "rotate" | "recovery" | "disable" | null;

function LogsManagementPanel({ status }: { status: OtpStatus }) {
  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<ManagementMode>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [rotationSetup, setRotationSetup] = useState<SetupPayload | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const resetForm = () => {
    setCurrentPassword("");
    setCode("");
    setNewCode("");
    setRotationSetup(null);
  };

  const openMode = (nextMode: Exclude<ManagementMode, null>) => {
    setIsOpen(true);
    setMode(nextMode);
    setRecoveryCodes([]);
    resetForm();
  };

  const rotateStart = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: SetupPayload }>("/logs/otp/rotate/start", {
        currentPassword,
        code,
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      setRotationSetup(data);
      toast.success("Scan the new authenticator setup");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rotateConfirm = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: { recoveryCodes?: string[] } }>("/logs/otp/rotate/confirm", {
        code: newCode,
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes ?? []);
      resetForm();
      void qc.invalidateQueries({ queryKey: ["logs"] });
      toast.success("Authenticator rotated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const regenerateRecovery = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: { recoveryCodes?: string[] } }>("/logs/otp/recovery/regenerate", {
        currentPassword,
        code,
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes ?? []);
      resetForm();
      void qc.invalidateQueries({ queryKey: ["logs"] });
      toast.success("Recovery codes regenerated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const disable = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post("/logs/otp/disable", { currentPassword, code });
      return res.data;
    },
    onSuccess: () => {
      resetForm();
      setMode(null);
      sessionStorage.removeItem(LOG_DEVICE_KEY);
      void qc.invalidateQueries({ queryKey: ["logs"] });
      toast.success("Authenticator disabled");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-sm)] px-3 py-2.5" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
        <div>
          <div className="text-sm font-extrabold" style={{ color: "var(--ink)" }}>Authenticator management</div>
          <div className="text-sm" style={{ color: "var(--ink-2)" }}>
            {status.recoveryCodesRemaining} recovery codes remaining
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => openMode("rotate")} className="px-3 py-2 rounded-[var(--r-sm)] text-sm font-bold" style={{ background: "var(--card-2)", color: "var(--ink)" }}>
            Rotate
          </button>
          <button onClick={() => openMode("recovery")} className="px-3 py-2 rounded-[var(--r-sm)] text-sm font-bold" style={{ background: "var(--card-2)", color: "var(--ink)" }}>
            Recovery codes
          </button>
          <button onClick={() => openMode("disable")} className="px-3 py-2 rounded-[var(--r-sm)] text-sm font-bold" style={{ background: "var(--card-2)", color: "var(--red)" }}>
            Disable
          </button>
          <button
            onClick={() => {
              setIsOpen((current) => !current);
              if (isOpen) {
                setMode(null);
                setRecoveryCodes([]);
                resetForm();
              }
            }}
            className="grid h-9 w-9 place-items-center rounded-[var(--r-sm)]"
            style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
            aria-label={isOpen ? "Collapse authenticator management" : "Expand authenticator management"}
          >
            <ChevronDown size={17} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {isOpen && recoveryCodes.length > 0 && <RecoveryCodesPanel codes={recoveryCodes} />}

      {isOpen && mode && recoveryCodes.length === 0 && (
        <div className="rounded-[var(--r-sm)] p-4" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
          <div className="mb-3 font-extrabold" style={{ color: "var(--ink)" }}>
            {mode === "rotate" ? "Rotate authenticator" : mode === "recovery" ? "Regenerate recovery codes" : "Disable authenticator"}
          </div>

          {!rotationSetup && (
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="Current password"
                className="rounded-[var(--r-sm)] px-4 py-3 font-bold outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)" }}
              />
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                placeholder="Current authenticator code"
                className="rounded-[var(--r-sm)] px-4 py-3 font-bold outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)" }}
              />
              <div className="flex gap-2 md:col-span-2">
                <button
                  onClick={() => {
                    if (mode === "rotate") rotateStart.mutate();
                    if (mode === "recovery") regenerateRecovery.mutate();
                    if (mode === "disable") disable.mutate();
                  }}
                  disabled={
                    !currentPassword ||
                    code.length < 6 ||
                    rotateStart.isPending ||
                    regenerateRecovery.isPending ||
                    disable.isPending
                  }
                  className="px-4 py-3 rounded-[var(--r-sm)] font-bold disabled:opacity-60"
                  style={{ background: mode === "disable" ? "var(--red)" : "var(--violet)", color: "#fff" }}
                >
                  {mode === "rotate" ? "Start rotation" : mode === "recovery" ? "Regenerate" : "Disable"}
                </button>
                <button
                  onClick={() => { setMode(null); resetForm(); }}
                  className="px-4 py-3 rounded-[var(--r-sm)] font-bold"
                  style={{ background: "var(--card-2)", color: "var(--ink)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {rotationSetup && (
            <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
              <div className="rounded-[var(--r-md)] p-4" style={{ background: "var(--card-2)" }}>
                <Image src={rotationSetup.qrCodeDataUrl} alt="New authenticator QR code" width={188} height={188} unoptimized className="w-full rounded-[var(--r-sm)]" />
              </div>
              <div className="flex flex-col gap-3">
                <div className="break-all rounded-[var(--r-sm)] p-3 font-mono text-sm" style={{ background: "var(--card-2)", color: "var(--ink)" }}>
                  {rotationSetup.secret}
                </div>
                <input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  inputMode="numeric"
                  placeholder="New authenticator code"
                  className="rounded-[var(--r-sm)] px-4 py-3 font-bold outline-none"
                  style={{ background: "var(--card-2)", color: "var(--ink)" }}
                />
                <button
                  onClick={() => rotateConfirm.mutate()}
                  disabled={newCode.length < 6 || rotateConfirm.isPending}
                  className="w-fit px-4 py-3 rounded-[var(--r-sm)] font-bold disabled:opacity-60"
                  style={{ background: "var(--violet)", color: "#fff" }}
                >
                  Confirm rotation
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function LogBlockRow({
  block,
  isExpanded,
  onToggle,
}: {
  block: LedgerBlock;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const createdAt = new Date(block.createdAt);
  const relativeTime = formatDistanceToNow(createdAt, { addSuffix: true });

  return (
    <article
      className="overflow-hidden rounded-[var(--r-sm)]"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-black/[0.02]"
      >
        <div className="hidden items-center gap-3 md:grid md:grid-cols-[78px_1fr_96px_130px_150px_150px_32px]">
          <span className="rounded-[var(--r-sm)] px-2 py-1 text-center text-xs font-extrabold" style={{ background: "var(--card-2)", color: "var(--violet)" }}>
            #{block.sequence}
          </span>
          <span className="min-w-0 truncate text-sm font-extrabold capitalize" style={{ color: "var(--ink)" }}>
            {block.scope.replaceAll("_", " ")}
          </span>
          <span className="text-xs font-bold uppercase tracking-normal" style={{ color: "var(--ink-3)" }}>
            {block.action}
          </span>
          <span className="truncate text-xs font-semibold" style={{ color: "var(--ink-3)" }}>
            {relativeTime}
          </span>
          <span className="truncate font-mono text-xs" style={{ color: "var(--ink-3)" }} title={block.entityId}>
            {compactValue(block.entityId)}
          </span>
          <span className="truncate font-mono text-xs" style={{ color: "var(--ink-3)" }} title={block.hash}>
            {compactHash(block.hash)}
          </span>
          <span className="grid h-8 w-8 place-items-center rounded-[var(--r-sm)]" style={{ background: "var(--card-2)", color: "var(--ink-2)" }}>
            <ChevronDown size={16} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </span>
        </div>

        <div className="flex flex-col gap-2 md:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-[var(--r-sm)] px-2 py-1 text-xs font-extrabold" style={{ background: "var(--card-2)", color: "var(--violet)" }}>
                  #{block.sequence}
                </span>
                <span className="min-w-0 truncate text-sm font-extrabold capitalize" style={{ color: "var(--ink)" }}>
                  {block.scope.replaceAll("_", " ")}
                </span>
              </div>
              <div className="mt-1 text-xs font-bold uppercase" style={{ color: "var(--ink-3)" }}>
                {block.action} · {relativeTime}
              </div>
            </div>
            <span className="grid h-8 w-8 flex-none place-items-center rounded-[var(--r-sm)]" style={{ background: "var(--card-2)", color: "var(--ink-2)" }}>
              <ChevronDown size={16} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono" style={{ color: "var(--ink-3)" }}>
            <span className="truncate" title={block.entityId}>{compactValue(block.entityId)}</span>
            <span className="truncate text-right" title={block.hash}>{compactHash(block.hash)}</span>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t px-3 pb-3 pt-3" style={{ borderColor: "color-mix(in srgb, var(--ink) 10%, transparent)" }}>
          <div className="mb-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="font-bold uppercase" style={{ color: "var(--ink-3)" }}>Entity id</div>
              <div className="mt-1 break-all font-mono" style={{ color: "var(--ink-2)" }}>{block.entityId}</div>
            </div>
            <div>
              <div className="font-bold uppercase" style={{ color: "var(--ink-3)" }}>Created</div>
              <div className="mt-1 font-semibold" style={{ color: "var(--ink-2)" }}>{format(createdAt, "d MMM yyyy, h:mm a")}</div>
            </div>
            <div>
              <div className="font-bold uppercase" style={{ color: "var(--ink-3)" }}>Hash</div>
              <div className="mt-1 break-all font-mono" style={{ color: "var(--ink-2)" }}>{block.hash}</div>
            </div>
            <div>
              <div className="font-bold uppercase" style={{ color: "var(--ink-3)" }}>Previous hash</div>
              <div className="mt-1 break-all font-mono" style={{ color: "var(--ink-2)" }}>{block.previousHash}</div>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-bold uppercase" style={{ color: "var(--ink-3)" }}>Before</div>
              <BlockPayload value={block.before} />
            </div>
            <div>
              <div className="mb-2 text-xs font-bold uppercase" style={{ color: "var(--ink-3)" }}>After</div>
              <BlockPayload value={block.after} />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function LedgerView({ status }: { status: OtpStatus }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState("");
  const [entityId, setEntityId] = useState("");
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [skip, setSkip] = useState(0);
  const limit = 25;

  const params = useMemo(() => {
    const search = new URLSearchParams();
    search.set("skip", String(skip));
    search.set("limit", String(limit));
    if (scope) search.set("scope", scope);
    if (entityId) search.set("entityId", entityId);
    return search.toString();
  }, [entityId, scope, skip]);

  const ledger = useQuery<LedgerResponse>({
    queryKey: ["logs", "ledger", params],
    queryFn: async () => {
      const res = await apiClient.get<LedgerResponse>(`/logs/ledger?${params}`, logsHeaders());
      return res.data;
    },
  });

  const verify = useQuery<{ data: VerifyResponse }>({
    queryKey: ["logs", "ledger", "verify"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: VerifyResponse }>("/logs/ledger/verify", logsHeaders());
      return res.data;
    },
  });

  const lockLogs = useMutation({
    mutationFn: () => apiClient.post("/logs/otp/lock", {}, logsHeaders()),
    onSuccess: () => {
      sessionStorage.removeItem(LOG_DEVICE_KEY);
      void qc.invalidateQueries({ queryKey: ["logs"] });
      toast.success("Logs locked");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const blocks = ledger.data?.data ?? [];
  const total = ledger.data?.total ?? 0;
  const canPrev = skip > 0;
  const canNext = skip + limit < total;
  const pageLabel = total === 0 ? "0" : `${skip + 1}-${Math.min(skip + limit, total)} of ${total}`;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-sm)] px-3 py-2.5" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 flex-none place-items-center rounded-[var(--r-sm)]" style={{ background: "var(--card-2)" }}>
            <ShieldCheck size={19} style={{ color: "var(--violet)" }} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-extrabold" style={{ color: "var(--ink)" }}>Immutable logs</h2>
            <p className="text-xs font-semibold" style={{ color: "var(--ink-2)" }}>{total} blocks</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-xs font-bold"
            style={{ background: "var(--card-2)", color: verify.data?.data.valid ? "var(--green)" : "var(--red)" }}
          >
            {verify.data?.data.valid ? <CheckCircle2 size={15} /> : <KeyRound size={15} />}
            {verify.isLoading ? "Verifying" : verify.data?.data.valid ? "Chain valid" : "Check failed"}
          </div>
          <button
            onClick={() => lockLogs.mutate()}
            disabled={lockLogs.isPending}
            className="flex items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-xs font-bold disabled:opacity-60"
            style={{ background: "var(--card-2)", color: "var(--ink)" }}
          >
            <Lock size={15} />
            Lock logs now
          </button>
        </div>
      </div>

      <LogsManagementPanel status={status} />

      <div className="flex flex-col gap-2 rounded-[var(--r-sm)] p-2 sm:flex-row sm:items-center" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
        <select
          value={scope}
          onChange={(e) => { setScope(e.target.value); setSkip(0); setExpandedBlockId(null); }}
          className="h-10 rounded-[var(--r-sm)] px-3 text-sm font-bold outline-none sm:w-52"
          style={{ background: "var(--card-2)", color: "var(--ink)" }}
        >
          {SCOPES.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[var(--r-sm)] px-3" style={{ background: "var(--card-2)" }}>
          <Search size={16} style={{ color: "var(--ink-3)" }} />
          <input
            value={entityId}
            onChange={(e) => { setEntityId(e.target.value); setSkip(0); setExpandedBlockId(null); }}
            placeholder="Entity id"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
            style={{ color: "var(--ink)" }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="px-2 text-xs font-bold whitespace-nowrap" style={{ color: "var(--ink-2)" }}>
            {pageLabel}
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={() => { setSkip(Math.max(0, skip - limit)); setExpandedBlockId(null); }}
              disabled={!canPrev}
              className="h-9 rounded-[var(--r-sm)] px-3 text-xs font-bold disabled:opacity-50"
              style={{ background: "var(--card-2)", color: "var(--ink)" }}
            >
              Previous
            </button>
            <button
              onClick={() => { setSkip(skip + limit); setExpandedBlockId(null); }}
              disabled={!canNext}
              className="h-9 rounded-[var(--r-sm)] px-3 text-xs font-bold disabled:opacity-50"
              style={{ background: "var(--card-2)", color: "var(--ink)" }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div className="hidden rounded-[var(--r-sm)] px-3 py-2 text-[11px] font-extrabold uppercase md:grid md:grid-cols-[78px_1fr_96px_130px_150px_150px_32px] md:gap-3" style={{ background: "var(--card-2)", color: "var(--ink-3)" }}>
        <span>Seq</span>
        <span>Scope</span>
        <span>Action</span>
        <span>Time</span>
        <span>Entity</span>
        <span>Hash</span>
        <span />
      </div>

      {ledger.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-14 rounded-[var(--r-sm)]" />)}
        </div>
      ) : blocks.length === 0 ? (
        <div className="rounded-[var(--r-sm)] px-4 py-6 text-center text-sm font-semibold" style={{ background: "var(--card)", color: "var(--ink-2)", boxShadow: "var(--shadow-sm)" }}>
          No log blocks found
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {blocks.map((block) => (
            <LogBlockRow
              key={block._id}
              block={block}
              isExpanded={expandedBlockId === block._id}
              onToggle={() => setExpandedBlockId((current) => current === block._id ? null : block._id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function LogsClient() {
  const qc = useQueryClient();
  const status = useOtpStatus();
  const data = status.data?.data;

  if (status.isLoading) {
    return <Skeleton className="h-48 rounded-[var(--r-md)]" />;
  }

  if (!data?.isEnabled) {
    return <SetupPanel onDone={() => void qc.invalidateQueries({ queryKey: ["logs", "otp-status"] })} />;
  }

  if (!data.unlocked) {
    return <UnlockPanel />;
  }

  return <LedgerView status={data} />;
}
