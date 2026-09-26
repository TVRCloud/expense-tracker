"use client";

import { canonicalizeCategory } from "@/lib/category-colors";
import { getCategoryColor } from "@/lib/category-colors";
import { TRANSACTION_CATEGORY_ICONS } from "@/lib/icons";

interface Props {
  byCategory: { category: string; total: number }[];
  total: number;
}

// Ring size scales with share of spend, so the category that actually
// dominates the month (e.g. Groceries at 32%) reads as visually dominant —
// a flat grid of same-size rings buries that signal in a wall of numbers.
function ringSize(pct: number): number {
  if (pct >= 25) return 116;
  if (pct >= 12) return 92;
  return 76;
}

function RingGauge({ pct, color, size }: { pct: number; color: string; size: number }) {
  const stroke = size >= 110 ? 8 : 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 700ms ease-out" }}
      />
    </svg>
  );
}

export function CategoryRingGrid({ byCategory, total }: Props) {
  const top = byCategory.slice(0, 6);

  return (
    <div className="grid grid-cols-3 gap-3">
      {top.map(({ category, total: catTotal }) => {
        const pct = total > 0 ? (catTotal / total) * 100 : 0;
        const size = ringSize(pct);
        const color = getCategoryColor(category);
        const Icon = TRANSACTION_CATEGORY_ICONS[canonicalizeCategory(category)] ?? TRANSACTION_CATEGORY_ICONS.other;

        return (
          <div
            key={category}
            className="flex flex-col items-center justify-center gap-2 rounded-(--r-md) py-4"
            style={{ background: "var(--card-2)" }}
          >
            <div className="relative grid place-items-center" style={{ width: size, height: size }}>
              <RingGauge pct={pct} color={color} size={size} />
              <Icon
                className="absolute"
                size={size >= 110 ? 22 : 18}
                style={{ color }}
              />
            </div>
            <div className="text-center">
              <div className="text-xs font-bold capitalize truncate max-w-20" style={{ color: "var(--ink)" }}>
                {category}
              </div>
              <div className="text-[11px] font-semibold tnum" style={{ color: "var(--ink-3)" }}>
                {pct.toFixed(1)}%
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
