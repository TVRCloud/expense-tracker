"use client";

import { useState, type CSSProperties } from "react";
import { Copy, Users } from "lucide-react";
import { toast } from "sonner";
import { formatMinor } from "@/lib/money-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  useAcceptInvite,
  useDeclineInvite,
  useEndShare,
  useInvite,
  useNewCode,
  useOwnAccounts,
  useShares,
  useSharedAccounts,
  useSharedTransactions,
  useUpdateShare,
  type OwnedShare,
  type ReceivedShare,
  type ShareRole,
} from "../hooks/useHousehold";

const ROLE_LABEL: Record<ShareRole, string> = { viewer: "Can view", editor: "Can view and add" };
const INSET = { "--inset": "16px" } as CSSProperties;
const CARD = { background: "var(--card)", boxShadow: "var(--shadow-sm)" } as CSSProperties;

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
}

function CodeBox({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <div className="rounded-(--r-lg) p-4 space-y-2" style={{ ...CARD, outline: "2px solid var(--green)" }}>
      <div style={{ font: "var(--text-body)", color: "var(--ink)" }}>Give this code to them</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 break-all text-sm select-all" style={{ color: "var(--ink)" }}>{code}</code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            toast.success("Code copied");
          }}
        >
          <Copy size={14} /> Copy
        </Button>
      </div>
      <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
        It is shown once and works once, for 7 days. Lost it? Ask for a new code on the invite.
      </p>
      <Button variant="ghost" size="sm" onClick={onClose}>Done</Button>
    </div>
  );
}

function InviteForm({ onCode }: { onCode: (code: string) => void }) {
  const { data: accounts } = useOwnAccounts();
  const invite = useInvite();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [includeBudgets, setIncludeBudgets] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const ready = email.includes("@") && picked.size > 0 && !invite.isPending;

  async function submit() {
    try {
      const res = await invite.mutateAsync({ email: email.trim(), accountIds: [...picked], role, includeBudgets });
      onCode(res.code);
      setEmail("");
      setPicked(new Set());
      setIncludeBudgets(false);
      setRole("viewer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the invite");
    }
  }

  return (
    <div className="rounded-(--r-lg) p-5 space-y-4" style={CARD}>
      <div>
        <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>Share with someone</h2>
        <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
          They sign in with the email you enter, and need the code you give them.
        </p>
      </div>
      <Input type="email" placeholder="Their email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Their email" />
      <div className="inset-group" style={INSET}>
        {(accounts ?? []).map((a) => (
          <label key={a._id} className="flex items-center gap-3 px-4 min-h-[48px] py-2">
            <span className="flex-1 min-w-0 truncate text-[15px]" style={{ color: "var(--ink)" }}>{a.name}</span>
            <Switch
              checked={picked.has(a._id)}
              onCheckedChange={(on) =>
                setPicked((s) => {
                  const next = new Set(s);
                  if (on) next.add(a._id);
                  else next.delete(a._id);
                  return next;
                })
              }
              aria-label={`Share ${a.name}`}
            />
          </label>
        ))}
        {accounts && accounts.length === 0 && (
          <div className="px-4 py-3 text-sm" style={{ color: "var(--ink-3)" }}>Add an account first.</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={role} onValueChange={(v) => setRole(v as ShareRole)}>
          <SelectTrigger aria-label="What they can do" className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="viewer">{ROLE_LABEL.viewer}</SelectItem>
            <SelectItem value="editor">{ROLE_LABEL.editor}</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink-2)" }}>
          <Switch checked={includeBudgets} onCheckedChange={setIncludeBudgets} aria-label="Include my budgets" />
          Include my budgets
        </label>
      </div>
      {includeBudgets && (
        <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
          Budget totals count your spending across all your accounts, not only the ones you share.
        </p>
      )}
      <Button onClick={submit} disabled={!ready}>Send invite</Button>
    </div>
  );
}

function OwnedRow({ share, accountNames, onCode }: { share: OwnedShare; accountNames: Map<string, string>; onCode: (c: string) => void }) {
  const update = useUpdateShare();
  const end = useEndShare();
  const newCode = useNewCode();
  const names = share.accountIds.map((id) => accountNames.get(id) ?? "Account").join(", ");
  const statusText =
    share.status === "active" ? `Joined ${when(share.acceptedAt)}` : share.status === "expired" ? "Invite expired" : `Waiting, code valid to ${when(share.inviteExpiresAt)}`;

  async function run(fn: () => Promise<unknown>, fail: string) {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : fail);
    }
  }

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="truncate text-[15px]" style={{ color: "var(--ink)" }}>{share.member.name ?? share.member.email}</div>
          <div className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{statusText} · {names}</div>
        </div>
        <Select value={share.role} onValueChange={(v) => run(() => update.mutateAsync({ id: share.id, role: v as ShareRole }), "Could not change this")}>
          <SelectTrigger aria-label={`What ${share.member.email} can do`} className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="viewer">{ROLE_LABEL.viewer}</SelectItem>
            <SelectItem value="editor">{ROLE_LABEL.editor}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink-2)" }}>
          <Switch
            checked={share.includeBudgets}
            onCheckedChange={(on) => run(() => update.mutateAsync({ id: share.id, includeBudgets: on }), "Could not change this")}
            aria-label={`Budgets for ${share.member.email}`}
          />
          Budgets
        </label>
        {share.status !== "active" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => run(async () => onCode((await newCode.mutateAsync(share.id)).code), "Could not make a new code")}
          >
            New code
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => run(() => end.mutateAsync(share.id), "Could not stop sharing")}>
          {share.status === "active" ? "Stop sharing" : "Cancel invite"}
        </Button>
      </div>
    </div>
  );
}

function ReceivedRow({ share, onView, viewing }: { share: ReceivedShare; onView: (id: string | null) => void; viewing: boolean }) {
  const accept = useAcceptInvite();
  const decline = useDeclineInvite();
  const end = useEndShare();
  const [code, setCode] = useState("");
  const owner = share.owner.name ?? "Someone";

  async function run(fn: () => Promise<unknown>, fail: string) {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : fail);
    }
  }

  if (share.status === "pending") {
    return (
      <div className="px-4 py-3 space-y-2">
        <div className="text-[15px]" style={{ color: "var(--ink)" }}>
          {owner} invited you to see {share.accountCount === 1 ? "an account" : `${share.accountCount} accounts`}
        </div>
        <div className="text-xs" style={{ color: "var(--ink-3)" }}>{ROLE_LABEL[share.role]} · code valid to {when(share.inviteExpiresAt)}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-64" placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value.trim())} aria-label="Invite code" />
          <Button
            disabled={code.length < 20 || accept.isPending}
            onClick={() => run(async () => { await accept.mutateAsync({ id: share.id, code }); toast.success("You can now see the shared accounts"); }, "That code did not work")}
          >
            Accept
          </Button>
          <Button variant="ghost" onClick={() => run(() => decline.mutateAsync(share.id), "Could not decline")}>Decline</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="truncate text-[15px]" style={{ color: "var(--ink)" }}>{owner}</div>
        <div className="text-xs" style={{ color: "var(--ink-3)" }}>{ROLE_LABEL[share.role]}</div>
      </div>
      <Button variant={viewing ? "default" : "outline"} size="sm" onClick={() => onView(viewing ? null : share.owner.id)}>
        {viewing ? "Hide" : "View"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => run(async () => { onView(null); await end.mutateAsync(share.id); }, "Could not leave")}>
        Leave
      </Button>
    </div>
  );
}

function SharedView({ ownerId }: { ownerId: string }) {
  const accounts = useSharedAccounts(ownerId);
  const txns = useSharedTransactions(ownerId);
  if (accounts.isLoading || txns.isLoading) return <Skeleton className="h-40 rounded-(--r-lg)" />;
  if (!accounts.data || !txns.data) return <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>This share is no longer available.</p>;
  const currency = accounts.data.currency;
  const names = new Map(accounts.data.accounts.map((a) => [a.id, a.name]));
  return (
    <section className="space-y-2">
      <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>{accounts.data.owner.name ?? "Shared"} accounts</h2>
      <div className="inset-group" style={INSET}>
        {accounts.data.accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-4 min-h-[48px] py-2">
            <div className="flex-1 min-w-0 truncate text-[15px]" style={{ color: "var(--ink)" }}>{a.name}</div>
            <div className="tnum text-[15px]" style={{ color: "var(--ink)" }}>{formatMinor(a.balance, currency)}</div>
          </div>
        ))}
      </div>
      <h3 className="pt-2" style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>Recent</h3>
      <div className="inset-group" style={INSET}>
        {txns.data.data.length === 0 && <div className="px-4 py-3 text-sm" style={{ color: "var(--ink-3)" }}>Nothing yet.</div>}
        {txns.data.data.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 min-h-[48px] py-2">
            <div className="flex-1 min-w-0">
              <div className="truncate text-[15px] capitalize" style={{ color: "var(--ink)" }}>{t.description ?? t.category}</div>
              <div className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
                {t.account ? names.get(t.account) : "Another account"} · {when(t.date)}
                {t.addedBy?.name ? ` · added by ${t.addedBy.name}` : ""}
              </div>
            </div>
            <div className="tnum text-[15px]" style={{ color: t.type === "income" ? "var(--green)" : "var(--ink)" }}>
              {t.type === "income" ? "+" : t.type === "expense" ? "-" : ""}{formatMinor(t.amount, currency)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HouseholdClient() {
  const { data, isLoading } = useShares();
  const { data: accounts } = useOwnAccounts();
  const [code, setCode] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="page-stack">
        <PageHeader title="Household" subtitle="Share accounts with a partner or family" />
        <Skeleton className="h-44 rounded-(--r-lg)" />
        <Skeleton className="h-40 rounded-(--r-lg)" />
      </div>
    );
  }

  const accountNames = new Map((accounts ?? []).map((a) => [a._id, a.name]));
  const nothing = data.owned.length === 0 && data.received.length === 0;

  return (
    <div className="page-stack">
      <PageHeader title="Household" subtitle="Share accounts with a partner or family. You stay in control and can stop at any time." />
      {code && <CodeBox code={code} onClose={() => setCode(null)} />}

      {data.received.length > 0 && (
        <section className="space-y-2">
          <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>Shared with you</h2>
          <div className="inset-group" style={INSET}>
            {data.received.map((s) => (
              <ReceivedRow key={s.id} share={s} viewing={viewing === s.owner.id} onView={setViewing} />
            ))}
          </div>
        </section>
      )}
      {viewing && <SharedView ownerId={viewing} />}

      <section className="space-y-2">
        <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>Shared by you</h2>
        {data.owned.length > 0 ? (
          <div className="inset-group" style={INSET}>
            {data.owned.map((s) => (
              <OwnedRow key={s.id} share={s} accountNames={accountNames} onCode={setCode} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-(--r-lg) py-10 text-center px-6" style={CARD}>
            <Users size={28} style={{ color: "var(--ink-3)" }} />
            <p style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>{nothing ? "Nothing shared yet" : "You have not shared anything"}</p>
            <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Pick accounts below to invite someone.</p>
          </div>
        )}
      </section>

      <InviteForm onCode={setCode} />
    </div>
  );
}
