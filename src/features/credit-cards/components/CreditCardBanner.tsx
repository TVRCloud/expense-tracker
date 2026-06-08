"use client";

import { format } from "date-fns";
import { CreditCard, AlertTriangle } from "lucide-react";
import { type IAccount } from "@/types/models";
import { CreditUtilizationBar } from "./CreditUtilizationBar";
import { getDueDateStatus, getCurrentCycle } from "@/lib/credit-card";
import { useCurrency } from "@/hooks/useCurrency";

const NETWORK_LABELS: Record<string, string> = {
  visa: "VISA",
  mastercard: "MC",
  amex: "AMEX",
  rupay: "RUPAY",
  discover: "DISC",
  diners: "DINERS",
};

interface CreditCardBannerProps {
  account: IAccount;
  currentBalance: number;
}

export function CreditCardBanner({ account, currentBalance }: CreditCardBannerProps) {
  const { formatCurrency } = useCurrency();
  const meta = account.creditMeta;
  const limit = meta?.creditLimit ?? 0;
  const available = Math.max(0, limit - currentBalance);

  const cycle = meta?.billingCycleDay && meta?.paymentDueDay
    ? getCurrentCycle({ billingCycleDay: meta.billingCycleDay, paymentDueDay: meta.paymentDueDay, creditLimit: limit, minPaymentPct: meta.minPaymentPct ?? 2 })
    : null;

  const dueStatus = cycle ? getDueDateStatus(cycle.dueDate) : null;

  let dueColor = "var(--ink-3)";
  let dueLabel = "";
  if (dueStatus) {
    if (dueStatus.isOverdue) {
      dueColor = "var(--red)";
      dueLabel = `Overdue by ${Math.abs(dueStatus.daysUntilDue)}d`;
    } else if (dueStatus.daysUntilDue <= 7) {
      dueColor = "#f59e0b";
      dueLabel = `Due in ${dueStatus.daysUntilDue}d`;
    } else {
      dueColor = "var(--ink-3)";
      dueLabel = `Due ${format(new Date(cycle!.dueDate), "MMM d")}`;
    }
  }

  return (
    <div
      className="rounded-[var(--r-lg)] p-5 flex flex-col gap-4"
      style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
    >
      {/* Card header row */}
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded-[14px] grid place-items-center flex-none"
          style={{ background: "var(--violet)", color: "#fff" }}
        >
          <CreditCard size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-extrabold truncate" style={{ color: "var(--ink)" }}>{account.name}</h2>
            {meta?.network && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--card-2)", color: "var(--ink-3)" }}>
                {NETWORK_LABELS[meta.network] ?? meta.network.toUpperCase()}
              </span>
            )}
          </div>
          {meta?.lastFourDigits && (
            <div className="text-sm font-medium tracking-widest mt-0.5" style={{ color: "var(--ink-3)" }}>
              •••• •••• •••• {meta.lastFourDigits}
            </div>
          )}
          {meta?.cardholderName && (
            <div className="text-xs font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>{meta.cardholderName}</div>
          )}
        </div>
        {dueStatus && (
          <div
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold flex-none"
            style={{ background: dueStatus.isOverdue ? "rgba(235,87,87,.12)" : dueStatus.daysUntilDue <= 7 ? "rgba(245,158,11,.12)" : "var(--card-2)", color: dueColor }}
          >
            {(dueStatus.isOverdue || dueStatus.daysUntilDue <= 7) && <AlertTriangle size={11} />}
            {dueLabel}
          </div>
        )}
      </div>

      {/* Balance row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--ink-3)" }}>Current Balance</div>
          <div className="text-[26px] font-extrabold tnum leading-none" style={{ color: currentBalance > 0 ? "var(--red)" : "var(--ink)" }}>
            {formatCurrency(currentBalance)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--ink-3)" }}>Available Credit</div>
          <div className="text-[26px] font-extrabold tnum leading-none" style={{ color: available > 0 ? "var(--green)" : "var(--red)" }}>
            {formatCurrency(available)}
          </div>
        </div>
      </div>

      {/* Utilization bar */}
      {limit > 0 && (
        <CreditUtilizationBar balance={currentBalance} creditLimit={limit} />
      )}

      {/* Billing cycle info */}
      {cycle && (
        <div className="flex items-center gap-4 text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>
          <span>Statement closes {format(cycle.periodEnd, "MMM d")}</span>
          <span>·</span>
          <span style={{ color: dueColor }}>Payment due {format(cycle.dueDate, "MMM d")}</span>
          {meta?.apr && <><span>·</span><span>APR {meta.apr}%</span></>}
        </div>
      )}

      {!meta?.billingCycleDay && (
        <div className="text-xs font-medium" style={{ color: "var(--ink-3)" }}>
          Edit this card to set up billing cycle dates and limit.
        </div>
      )}
    </div>
  );
}
