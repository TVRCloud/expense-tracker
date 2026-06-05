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
      className="relative rounded-[var(--r-lg)] p-7 overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #6B46F5 0%, #8A6BFF 100%)",
        boxShadow: "0 20px 60px rgba(107,70,245,.40)",
      }}
    >
      {/* Decorative orbs */}
      <div
        className="absolute top-0 right-0 w-52 h-52 rounded-full opacity-20"
        style={{
          background: "radial-gradient(circle, rgba(255,255,255,.5) 0%, transparent 70%)",
          transform: "translate(30%, -30%)",
        }}
      />
      <div
        className="absolute bottom-0 left-12 w-36 h-36 rounded-full opacity-15"
        style={{
          background: "radial-gradient(circle, rgba(255,255,255,.5) 0%, transparent 70%)",
          transform: "translateY(40%)",
        }}
      />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-sm font-bold" style={{ color: "rgba(255,255,255,.7)" }}>
              Total Balance
            </p>
            <div className="text-[40px] font-extrabold tnum text-white leading-tight mt-1">
              {formatCurrency(totalBalance)}
            </div>
          </div>
          <div
            className="w-12 h-12 rounded-[14px] grid place-items-center"
            style={{ background: "rgba(255,255,255,.18)" }}
          >
            <CreditCard size={24} color="#fff" />
          </div>
        </div>

        <div
          className="flex items-center gap-2 text-sm font-semibold"
          style={{ color: "rgba(255,255,255,.8)" }}
        >
          <span className="w-2 h-2 rounded-full bg-white opacity-80 inline-block" />
          {accountCount} account{accountCount !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}
