"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localToday, toBps, toMinor } from "../amount-input";
import { HOLDING_KIND_LABELS, useAddHolding, type HoldingKind, type NewHolding } from "../hooks/useHoldings";

const KINDS = Object.keys(HOLDING_KIND_LABELS) as HoldingKind[];


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 min-w-0">
      <span className="text-xs" style={{ color: "var(--ink-3)" }}>{label}</span>
      {children}
    </label>
  );
}

export function AddHolding({ onDone }: { onDone: () => void }) {
  const add = useAddHolding();
  const [kind, setKind] = useState<HoldingKind>("stock");
  const [name, setName] = useState("");
  const [invested, setInvested] = useState("");
  const [current, setCurrent] = useState("");
  const [units, setUnits] = useState("");
  const [sipAmount, setSipAmount] = useState("");
  const [sipDay, setSipDay] = useState("5");
  const [sipStart, setSipStart] = useState(localToday());
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [fdStart, setFdStart] = useState(localToday());
  const [maturity, setMaturity] = useState("");
  const isFd = kind === "fixed_deposit";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Name this holding");
    const body: NewHolding = { name: name.trim(), kind };
    if (isFd) {
      const p = toMinor(principal);
      const r = toBps(rate);
      if (p === null || p < 1) return toast.error("Enter the amount deposited");
      if (r === null) return toast.error("Enter the interest rate, like 7.25");
      if (!maturity || maturity <= fdStart) return toast.error("Maturity must be after the start");
      body.fd = { principal: p, rateBps: r, startDay: fdStart, maturityDay: maturity };
    } else {
      const inv = toMinor(invested);
      if (inv === null) return toast.error("Enter what you have put in");
      body.investedAmount = inv;
      if (current.trim()) {
        const cur = toMinor(current);
        if (cur === null) return toast.error("Enter today's value as an amount");
        body.currentValue = cur;
      }
      if (units.trim()) body.units = units.trim();
      if (sipAmount.trim()) {
        const amount = toMinor(sipAmount);
        const day = Number(sipDay);
        if (amount === null || amount < 1) return toast.error("Enter the SIP amount");
        if (!Number.isInteger(day) || day < 1 || day > 31) return toast.error("The SIP day is 1 to 31");
        body.sip = { amount, dayOfMonth: day, startDay: sipStart, active: true };
      }
    }
    add.mutate(body, {
      onSuccess: () => {
        toast.success("Holding added");
        onDone();
      },
      onError: (err) => {
        const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
        toast.error(message && message !== "Validation failed" ? message : "Could not add this holding");
      },
    });
  }

  return (
    <form onSubmit={submit} className="rounded-(--r-lg) p-4 space-y-3" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <Select value={kind} onValueChange={(v) => setKind(v as HoldingKind)}>
            <SelectTrigger aria-label="Kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => <SelectItem key={k} value={k}>{HOLDING_KIND_LABELS[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Name">
          <Input aria-label="Name" placeholder={isFd ? "Bank FD" : "Nifty 50 index fund"} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
      </div>

      {isFd ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount deposited">
            <Input aria-label="Amount deposited" inputMode="decimal" placeholder="100000" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </Field>
          <Field label="Interest rate (% a year)">
            <Input aria-label="Interest rate" inputMode="decimal" placeholder="7.25" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field label="Started on">
            <Input aria-label="Started on" type="date" value={fdStart} onChange={(e) => setFdStart(e.target.value)} />
          </Field>
          <Field label="Matures on">
            <Input aria-label="Matures on" type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} />
          </Field>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Put in so far">
              <Input aria-label="Put in so far" inputMode="decimal" placeholder="50000" value={invested} onChange={(e) => setInvested(e.target.value)} />
            </Field>
            <Field label="Worth today (optional)">
              <Input aria-label="Worth today" inputMode="decimal" placeholder="Same as put in" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="Units (optional)">
              <Input aria-label="Units" inputMode="decimal" placeholder="12.5" value={units} onChange={(e) => setUnits(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Monthly SIP (optional)">
              <Input aria-label="Monthly SIP" inputMode="decimal" placeholder="5000" value={sipAmount} onChange={(e) => setSipAmount(e.target.value)} />
            </Field>
            <Field label="SIP day of month">
              <Input aria-label="SIP day of month" inputMode="numeric" value={sipDay} onChange={(e) => setSipDay(e.target.value)} disabled={!sipAmount.trim()} />
            </Field>
            <Field label="SIP started on">
              <Input aria-label="SIP started on" type="date" value={sipStart} onChange={(e) => setSipStart(e.target.value)} disabled={!sipAmount.trim()} />
            </Field>
          </div>
        </>
      )}

      <p className="text-xs" style={{ color: "var(--ink-3)" }}>
        A holding is separate from your accounts. Do not enter the same money here and as an investment account.
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={add.isPending}><Plus size={16} /> Add holding</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
