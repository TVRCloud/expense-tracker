"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreditStatements } from "@/features/credit-cards/hooks/useCreditStatements";
import { StatementRow } from "./StatementRow";
import { PayNowSheet } from "./PayNowSheet";
import { type ICreditStatement, type IAccount } from "@/types/models";
import { useCurrency } from "@/hooks/useCurrency";

interface StatementListProps {
  accountId: string;
  account: IAccount;
}

export function StatementList({ accountId, account }: StatementListProps) {
  const { formatCurrency } = useCurrency();
  const { data, isLoading } = useCreditStatements(accountId);
  const [payTarget, setPayTarget] = useState<ICreditStatement | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 rounded-[var(--r-md)]" />)}
      </div>
    );
  }

  if (!data?.currentCycle) {
    return (
      <div className="rounded-[var(--r-md)] p-6 text-center" style={{ background: "var(--card)" }}>
        <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>Billing cycle not set up</div>
        <p className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>Edit this card to configure the statement close date and payment due days.</p>
      </div>
    );
  }

  const current = data.currentCycle;

  return (
    <>
      <div className="flex flex-col gap-2">
        {/* Current open cycle */}
        <div
          className="rounded-[var(--r-md)] px-4 py-4"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)", border: "1.5px solid var(--line)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--violet)" }}>
                Current Statement · Open
              </div>
              <div className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>
                {current.label}
              </div>
              <div className="text-[11px] font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
                Closes {format(new Date(current.periodEnd), "MMM d")} · Due {format(new Date(current.dueDate), "MMM d")}
              </div>
            </div>
            <div className="text-right flex-none">
              <div className="text-[20px] font-extrabold tnum" style={{ color: current.balance > 0 ? "var(--red)" : "var(--ink)" }}>
                {formatCurrency(current.balance)}
              </div>
              {current.minPayment > 0 && (
                <div className="text-[10px] font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
                  Min {formatCurrency(current.minPayment)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Past statements */}
        {data.data.length > 0 && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-wider px-1 mt-2" style={{ color: "var(--ink-3)" }}>
              Statement History
            </div>
            {data.data.map(s => (
              <StatementRow
                key={String(s._id)}
                statement={s}
                onPayNow={setPayTarget}
              />
            ))}
          </>
        )}
      </div>

      {payTarget && (
        <PayNowSheet
          statement={payTarget}
          account={account}
          open={!!payTarget}
          onOpenChange={open => { if (!open) setPayTarget(null); }}
        />
      )}
    </>
  );
}
