"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  accountBalance: number;
  income: number;
  expense: number;
  isLoading?: boolean;
}

function Shimmer({ w }: { w: number | string }) {
  return (
    <span
      className="inline-block rounded-lg animate-pulse"
      style={{ width: w, height: 20, background: "rgba(255,255,255,0.22)", verticalAlign: "middle" }}
    />
  );
}

export function BalanceCard({ accountBalance, income, expense, isLoading }: Props) {
  const { formatCurrency } = useCurrency();

  return (
    <div
      className="relative overflow-hidden rounded-(--r-lg) text-white p-4.5 min-[390px]:p-6 sm:p-7"
      style={{
        background:
          "linear-gradient(145deg, var(--hero-from) 0%, var(--hero-mid1) 30%, var(--hero-mid2) 65%, var(--hero-to) 100%)",
        boxShadow: "0 20px 48px rgba(13,7,40,.45)",
        minHeight: 200,
      }}
    >
      {/* Dot-grid mesh texture */}
      <span
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,.10) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse 80% 80% at 80% 20%, black 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 80% at 80% 20%, black 30%, transparent 100%)",
        }}
      />
      {/* Subtle ambient highlight — top-right corner only */}
      <span
        aria-hidden
        className="absolute rounded-full pointer-events-none"
        style={{ width: 180, height: 180, right: -50, top: -60, background: "rgba(196,146,42,.14)", filter: "blur(55px)" }}
      />
      {/* Gold EMV chip */}
      <div
        aria-hidden
        className="absolute rounded-[4px]"
        style={{
          width: 32,
          height: 24,
          top: 18,
          right: 18,
          background: "linear-gradient(135deg, #d4af37 0%, #f5e08a 45%, #b8860b 100%)",
          boxShadow: "0 2px 8px rgba(0,0,0,.30)",
          opacity: 0.88,
        }}
      />

      <div className="relative">
        <div className="mb-1 opacity-70" style={{ font: "var(--text-label)" }}>
          Total balance
        </div>

        <div
          className="tnum leading-none mb-4 max-w-full overflow-hidden truncate"
          style={{ font: "var(--text-display)", minHeight: 40 }}
        >
          {isLoading ? <Shimmer w={180} /> : formatCurrency(accountBalance)}
        </div>

        {/* Shimmer separator */}
        <div
          className="mb-4 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,.35) 30%, rgba(255,255,255,.60) 60%, transparent)" }}
        />

        <div className="flex mx-[-20px] sm:mx-[-28px]">
          <div
            className="flex-1 flex items-center gap-2 sm:gap-3 py-4 sm:py-5 pl-5 sm:pl-7 min-w-0"
            style={{ borderRight: "1px solid rgba(255,255,255,0.14)" }}
          >
            <div
              className="w-9 h-9 rounded-full grid place-items-center flex-none"
              style={{
                background: "color-mix(in srgb, var(--green) 22%, transparent)",
                border: "1px solid color-mix(in srgb, var(--green) 35%, transparent)",
              }}
            >
              <TrendingUp size={16} style={{ color: "var(--green)" }} />
            </div>
            <div className="min-w-0">
              <div style={{ font: "var(--text-micro)", opacity: 0.65 }}>
                Income
              </div>
              <div className="tnum mt-0.5 max-w-full overflow-hidden" style={{ font: "var(--text-figure-sm)" }}>
                {isLoading ? <Shimmer w={70} /> : formatCurrency(income)}
              </div>
            </div>
          </div>

          <div className="flex-1 flex items-center gap-2 sm:gap-3 py-4 sm:py-5 pl-5 sm:pl-7 min-w-0">
            <div
              className="w-9 h-9 rounded-full grid place-items-center flex-none"
              style={{
                background: "color-mix(in srgb, var(--red) 22%, transparent)",
                border: "1px solid color-mix(in srgb, var(--red) 35%, transparent)",
              }}
            >
              <TrendingDown size={16} style={{ color: "var(--red)" }} />
            </div>
            <div className="min-w-0">
              <div style={{ font: "var(--text-micro)", opacity: 0.65 }}>
                Expenses
              </div>
              <div className="tnum mt-0.5 max-w-full overflow-hidden" style={{ font: "var(--text-figure-sm)" }}>
                {isLoading ? <Shimmer w={70} /> : formatCurrency(expense)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
