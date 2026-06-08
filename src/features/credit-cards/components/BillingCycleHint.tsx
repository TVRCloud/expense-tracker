"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { getStatementLabelForDate } from "@/lib/credit-card";
import { type IAccount } from "@/types/models";

interface BillingCycleHintProps {
  accountId: string;
  date: Date;
}

export function BillingCycleHint({ accountId, date }: BillingCycleHintProps) {
  const { data: account } = useQuery<IAccount>({
    queryKey: ["accounts", accountId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: IAccount }>(`/accounts/${accountId}`);
      return res.data.data;
    },
    enabled: !!accountId,
  });

  if (!account?.creditMeta?.billingCycleDay || !account.creditMeta.paymentDueDay) return null;

  const label = getStatementLabelForDate(date, {
    billingCycleDay: account.creditMeta.billingCycleDay,
    paymentDueDay: account.creditMeta.paymentDueDay,
    creditLimit: account.creditMeta.creditLimit ?? 0,
    minPaymentPct: account.creditMeta.minPaymentPct ?? 2,
  });

  return (
    <div
      className="rounded-(--r-sm) px-3 py-2 text-[12px] font-medium flex items-center gap-2"
      style={{ background: "color-mix(in srgb, var(--violet) 8%, transparent)", color: "var(--violet)" }}
    >
      <span>💳</span>
      <span>{label}</span>
    </div>
  );
}
