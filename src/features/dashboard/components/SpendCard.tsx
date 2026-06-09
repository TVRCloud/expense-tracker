"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
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
      className="relative overflow-hidden rounded-(--r-lg) text-white p-5 pb-0 sm:p-7 sm:pb-0"
      style={{
        background:
          "linear-gradient(135deg, #2D1B69 0%, #6B21A8 38%, #8B5CF6 68%, #EC4899 100%)",
        boxShadow: "0 20px 48px rgba(107,33,168,.38)",
      }}
    >
      <span
        aria-hidden
        className="absolute rounded-full pointer-events-none"
        style={{ width: 240, height: 240, right: -70, top: -90, background: "rgba(255,255,255,.09)" }}
      />
      <span
        aria-hidden
        className="absolute rounded-full pointer-events-none"
        style={{ width: 140, height: 140, left: 14, bottom: 30, background: "rgba(255,255,255,.06)" }}
      />

      <div className="relative">
        <div className="text-[13px] font-semibold mb-3" style={{ opacity: 0.82 }}>
          Account Balance
        </div>

        <div
          className="font-extrabold tnum leading-none mb-5 sm:mb-7 text-[34px] min-[390px]:text-[38px] sm:text-[44px] max-w-full overflow-hidden"
          style={{ minHeight: 44 }}
        >
          {isLoading ? <Shimmer w={180} /> : formatCurrency(accountBalance)}
        </div>

        <div
          className="flex mx-[-20px] sm:mx-[-28px]"
          style={{ borderTop: "1px solid rgba(255,255,255,0.18)" }}
        >
          <div
            className="flex-1 flex items-center gap-2 sm:gap-3 py-4 sm:py-5 pl-5 sm:pl-7 min-w-0"
            style={{ borderRight: "1px solid rgba(255,255,255,0.18)" }}
          >
            <div
              className="w-9 h-9 rounded-full grid place-items-center flex-none"
              style={{ background: "rgba(255,255,255,0.18)" }}
            >
              <ArrowDownLeft size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ opacity: 0.72 }}>
                Income
              </div>
              <div className="font-bold tnum text-[13px] min-[390px]:text-[14px] sm:text-[16px] mt-0.5 max-w-full overflow-hidden">
                {isLoading ? <Shimmer w={70} /> : formatCurrency(income)}
              </div>
            </div>
          </div>

          <div className="flex-1 flex items-center gap-2 sm:gap-3 py-4 sm:py-5 pl-5 sm:pl-7 min-w-0">
            <div
              className="w-9 h-9 rounded-full grid place-items-center flex-none"
              style={{ background: "rgba(255,255,255,0.18)" }}
            >
              <ArrowUpRight size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ opacity: 0.72 }}>
                Expenses
              </div>
              <div className="font-bold tnum text-[13px] min-[390px]:text-[14px] sm:text-[16px] mt-0.5 max-w-full overflow-hidden">
                {isLoading ? <Shimmer w={70} /> : formatCurrency(expense)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
