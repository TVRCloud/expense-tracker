"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clipboard, Fingerprint, KeyRound, Lock, Search, ShieldCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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

function useOtpStatus() {
  return useQuery<{ data: OtpStatus }>({
    queryKey: ["logs", "otp-status"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: OtpStatus }>("/logs/otp/status");
      return res.data;
    },
  });
}

function compactHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function BlockPayload({ value }: { value: unknown }) {
  if (!value) return <span style={{ color: "var(--ink-3)" }}>None</span>;
  return (
    <pre
      className="max-h-44 overflow-auto rounded-[var(--r-sm)] p-3 text-xs"
      style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
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

  const copyRecoveryCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
    toast.success("Recovery codes copied");
  };

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
        <div className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {recoveryCodes.map((item) => (
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
            <button
              onClick={onDone}
              className="px-4 py-3 rounded-[var(--r-sm)] font-bold"
              style={{ background: "var(--violet)", color: "#fff" }}
            >
              Continue
            </button>
          </div>
        </div>
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
      const res = await apiClient.post("/logs/otp/verify", { code, mode });
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

function LedgerView() {
  const [scope, setScope] = useState("");
  const [entityId, setEntityId] = useState("");
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
      const res = await apiClient.get<LedgerResponse>(`/logs/ledger?${params}`);
      return res.data;
    },
  });

  const verify = useQuery<{ data: VerifyResponse }>({
    queryKey: ["logs", "ledger", "verify"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: VerifyResponse }>("/logs/ledger/verify");
      return res.data;
    },
  });

  const blocks = ledger.data?.data ?? [];
  const total = ledger.data?.total ?? 0;
  const canPrev = skip > 0;
  const canNext = skip + limit < total;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full grid place-items-center" style={{ background: "var(--card-2)" }}>
            <ShieldCheck size={22} style={{ color: "var(--violet)" }} />
          </div>
          <div>
            <h2 className="font-extrabold text-xl" style={{ color: "var(--ink)" }}>Immutable logs</h2>
            <p className="text-sm" style={{ color: "var(--ink-2)" }}>
              {total} blocks
            </p>
          </div>
        </div>

        <div
          className="flex items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-sm font-bold"
          style={{ background: "var(--card)", color: verify.data?.data.valid ? "var(--green)" : "var(--red)", boxShadow: "var(--shadow-sm)" }}
        >
          {verify.data?.data.valid ? <CheckCircle2 size={17} /> : <KeyRound size={17} />}
          {verify.isLoading ? "Verifying" : verify.data?.data.valid ? "Chain valid" : "Check failed"}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
        <select
          value={scope}
          onChange={(e) => { setScope(e.target.value); setSkip(0); }}
          className="rounded-[var(--r-sm)] px-4 py-3 font-bold outline-none"
          style={{ background: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }}
        >
          {SCOPES.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <div className="flex items-center gap-2 rounded-[var(--r-sm)] px-4 py-3" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
          <Search size={17} style={{ color: "var(--ink-3)" }} />
          <input
            value={entityId}
            onChange={(e) => { setEntityId(e.target.value); setSkip(0); }}
            placeholder="Entity id"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
            style={{ color: "var(--ink)" }}
          />
        </div>
      </div>

      {ledger.isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-32 rounded-[var(--r-md)]" />)}
        </div>
      ) : blocks.length === 0 ? (
        <div className="rounded-[var(--r-md)] p-8 text-center font-semibold" style={{ background: "var(--card)", color: "var(--ink-2)", boxShadow: "var(--shadow-sm)" }}>
          No log blocks found
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {blocks.map((block) => (
            <article
              key={block._id}
              className="rounded-[var(--r-md)] p-4"
              style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ background: "var(--card-2)", color: "var(--violet)" }}>
                      #{block.sequence}
                    </span>
                    <span className="font-extrabold" style={{ color: "var(--ink)" }}>{block.scope}</span>
                    <span className="text-sm font-bold" style={{ color: "var(--ink-3)" }}>{block.action}</span>
                  </div>
                  <div className="mt-1 text-xs font-semibold" style={{ color: "var(--ink-3)" }}>
                    {formatDistanceToNow(new Date(block.createdAt), { addSuffix: true })}
                  </div>
                </div>
                <div className="text-right text-xs font-mono" style={{ color: "var(--ink-3)" }}>
                  <div>{compactHash(block.hash)}</div>
                  <div>{block.entityId}</div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-bold uppercase" style={{ color: "var(--ink-3)" }}>Before</div>
                  <BlockPayload value={block.before} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-bold uppercase" style={{ color: "var(--ink-3)" }}>After</div>
                  <BlockPayload value={block.after} />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={() => setSkip(Math.max(0, skip - limit))}
          disabled={!canPrev}
          className="px-4 py-2 rounded-[var(--r-sm)] font-bold disabled:opacity-50"
          style={{ background: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }}
        >
          Previous
        </button>
        <span className="text-sm font-bold" style={{ color: "var(--ink-2)" }}>
          {total === 0 ? "0" : `${skip + 1}-${Math.min(skip + limit, total)}`} of {total}
        </span>
        <button
          onClick={() => setSkip(skip + limit)}
          disabled={!canNext}
          className="px-4 py-2 rounded-[var(--r-sm)] font-bold disabled:opacity-50"
          style={{ background: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }}
        >
          Next
        </button>
      </div>
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

  return <LedgerView />;
}
