import { TrendingUp, TrendingDown } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  icon: ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down";
}

export function StatCard({ icon, iconBg, iconColor, label, value, delta, trend }: Props) {
  return (
    <div
      className="rounded-[var(--r-lg)] p-5"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      <div
        className="w-[42px] h-[42px] rounded-[13px] grid place-items-center mb-4"
        style={{ background: iconBg, color: iconColor }}
      >
        {icon}
      </div>
      <div className="text-xs font-semibold mb-1" style={{ color: "var(--ink-2)" }}>
        {label}
      </div>
      <div
        className="tnum tracking-tight"
        style={{ font: "var(--text-stat)", color: "var(--ink)", letterSpacing: "-0.6px" }}
      >
        {value}
      </div>
      {delta && (
        <div
          className={cn(
            "mt-1.5 text-xs font-bold flex items-center gap-1",
            trend === "up" ? "" : ""
          )}
          style={{ color: trend === "up" ? "var(--green)" : "var(--red)" }}
        >
          {trend === "up" ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {delta}
        </div>
      )}
    </div>
  );
}
