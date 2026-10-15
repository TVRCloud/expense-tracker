"use client";

import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { Skeleton } from "@/components/_ui/Skeleton";

interface Props {
  accountBalance: number;
  income: number;
  expense: number;
  isLoading?: boolean;
  cardLastFour?: string;
}

function Shimmer({ w }: { w: number | string }) {
  return <Skeleton inverse className="inline-block align-middle rounded-lg" style={{ width: w, height: 20 }} />;
}

export function BalanceCard({ accountBalance, income, expense, isLoading, cardLastFour }: Props) {
  const { formatCurrency } = useCurrency();

  return (
    <div
      className="relative overflow-hidden rounded-(--r-lg) text-white p-5 sm:p-7 lg:p-9"
      style={{
        background:
          "linear-gradient(155deg, var(--hero-from) 0%, var(--hero-mid1) 58%, var(--hero-mid2) 88%, var(--hero-to) 115%)",
        boxShadow: "0 20px 48px rgba(13,7,40,.45)",
        minHeight: 180,
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

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 opacity-70" style={{ font: "var(--text-label)" }}>
            Total balance
          </div>
          <div
            className="tnum leading-none max-w-full overflow-hidden truncate"
            style={{ font: "var(--text-display)", letterSpacing: "var(--track-title)", minHeight: 40 }}
          >
            {isLoading ? <Shimmer w={180} /> : formatCurrency(accountBalance)}
          </div>
          <div className="mt-5 flex items-center gap-x-8 gap-y-3 flex-wrap">
            <HeroFigure label="Income this month" value={isLoading ? null : formatCurrency(income)} />
            <HeroFigure label="Spent this month" value={isLoading ? null : formatCurrency(expense)} />
            <span className="font-mono text-[13px] tracking-[0.25em] hidden sm:inline" style={{ color: "rgba(255,255,255,.6)" }}>
              •••• {cardLastFour ?? "••••"}
            </span>
          </div>
        </div>

        {/* One clear primary action first, the rest quiet */}
        <div className="flex gap-2.5 lg:w-[340px] flex-none">
          <QuickAction href="/transactions/add" icon={ArrowUpFromLine} label="Expense" />
          <QuickAction href="/transactions/add" icon={ArrowDownToLine} label="Income" />
          <QuickAction href="/transactions/add" icon={ArrowLeftRight} label="Transfer" />
        </div>
      </div>
    </div>
  );
}

function HeroFigure({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <div style={{ font: "var(--text-micro)", opacity: 0.62 }}>{label}</div>
      <div className="tnum mt-0.5 truncate" style={{ font: "var(--text-figure-sm)", fontSize: 16 }}>
        {value ?? <Shimmer w={70} />}
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof ArrowDownToLine;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex-1 flex flex-col items-center gap-1.5 py-3 min-h-[60px] justify-center rounded-2xl transition-transform active:scale-[0.97]"
      style={{
        background: "rgba(255,255,255,.12)",
        border: "1px solid rgba(255,255,255,.16)",
        backdropFilter: "blur(6px)",
      }}
    >
      <Icon size={17} color="#fff" strokeWidth={2.25} />
      <span style={{ font: "var(--text-micro)", color: "#fff" }}>{label}</span>
    </Link>
  );
}
