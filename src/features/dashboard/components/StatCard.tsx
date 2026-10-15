import { type ReactNode } from "react";
import { Progress } from "@/components/_ui/Progress";

interface Props {
  icon: ReactNode;
  label: string;
  value: string;
  /** Token colour for the figure and bar, e.g. "var(--green)". */
  color: string;
  /** 0-100 share of the strip's common scale; omit to hide the bar. */
  progress?: number;
  caption?: string;
  loading?: boolean;
}

/** Stat strip tile: quiet icon + label, mono figure, hairline bar on a shared scale. */
export function StatCard({ icon, label, value, color, progress, caption, loading }: Props) {
  return (
    <div
      className="rounded-(--r-lg) p-5 min-w-0 flex flex-col gap-3"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex items-center gap-2" style={{ color: "var(--ink-2)" }}>
        <span
          className="w-7 h-7 rounded-full grid place-items-center flex-none"
          style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
          aria-hidden
        >
          {icon}
        </span>
        <span style={{ font: "var(--text-label)" }}>{label}</span>
      </div>
      <div
        className="tnum truncate"
        style={{ font: "var(--text-stat)", color, minHeight: 26, opacity: loading ? 0.4 : 1 }}
      >
        {value}
      </div>
      {progress !== undefined && <Progress value={progress} color={color} height={3} aria-label={`${label} share`} />}
      {caption && <div style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>{caption}</div>}
    </div>
  );
}
