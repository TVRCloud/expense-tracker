"use client";

import { CreditCard } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  totalBalance: number;
  accountCount: number;
}

export function BalanceBanner({ totalBalance, accountCount }: Props) {
  const { formatCurrency } = useCurrency();
  return (
    <div
      className="relative overflow-hidden rounded-(--r-lg) p-6 sm:p-8"
      style={{
        background: "linear-gradient(135deg, var(--hero-from) 0%, var(--hero-mid1) 40%, var(--hero-mid2) 75%, var(--hero-to) 130%)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 size-56 rounded-full opacity-25"
        style={{
          background: "radial-gradient(circle, color-mix(in srgb, var(--amber) 70%, transparent) 0%, transparent 70%)",
          transform: "translate(30%, -30%)",
        }}
      />
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p style={{ font: "var(--text-label)", color: "rgba(255,255,255,.65)" }}>Total balance</p>
          <div
            className="tnum mt-1 truncate text-white"
            style={{ font: "var(--text-display)", letterSpacing: "var(--track-title)" }}
          >
            {formatCurrency(totalBalance)}
          </div>
          <div className="mt-3 flex items-center gap-2" style={{ font: "var(--text-label)", color: "rgba(255,255,255,.75)" }}>
            <span className="inline-block size-1.5 rounded-full" style={{ background: "var(--amber)" }} />
            {accountCount} account{accountCount !== 1 ? "s" : ""}
          </div>
        </div>
        <div
          className="grid size-11 flex-none place-items-center rounded-(--r-sm)"
          style={{ background: "rgba(255,255,255,.14)" }}
        >
          <CreditCard size={22} color="#fff" />
        </div>
      </div>
    </div>
  );
}
