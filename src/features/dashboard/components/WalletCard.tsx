import type { CSSProperties } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import Link from "next/link";
import { type IAccount } from "@/types/models";
import { ACCOUNT_TYPE_ICONS } from "@/lib/icons";

interface Props {
  account: IAccount;
  className?: string;
  style?: CSSProperties;
}

// Per-type fallback accent when the account has no explicit `color` set —
// keeps cards visually distinct from each other at a glance.
const DEFAULT_ACCENTS: Record<IAccount["type"], string> = {
  cash: "#22c55e",
  bank: "#3b82f6",
  credit_card: "#c9a227",
  savings: "#a855f7",
  investment: "#f97316",
  wallet: "#06b6d4",
};

export function WalletCard({ account, className, style }: Props) {
  const { formatCurrency } = useCurrency();
  const lastFour = (account as IAccount & { creditMeta?: { lastFourDigits?: string } }).creditMeta?.lastFourDigits;
  const accent = account.color || DEFAULT_ACCENTS[account.type];
  const TypeIcon = ACCOUNT_TYPE_ICONS[account.type];

  return (
    <Link
      href={`/accounts/${account._id}`}
      className={`block rounded-(--r-lg) p-5 transition-transform active:scale-[0.98] ${className ?? ""}`}
      style={{
        background: "linear-gradient(135deg, #18181b 0%, #27272a 60%, #3f3f46 100%)",
        boxShadow: `0 20px 50px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.07), inset 3px 0 0 ${accent}`,
        minHeight: 164,
        ...style,
      }}
    >
      {/* Row 1: type chip + contactless icon (credit cards only) */}
      <div className="flex items-start justify-between mb-4">
        <div
          className="rounded-lg flex-none grid place-items-center"
          style={{
            width: 32,
            height: 24,
            background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`,
            boxShadow: "0 2px 6px rgba(0,0,0,.35)",
          }}
        >
          <TypeIcon size={14} color="#fff" />
        </div>
        {account.type === "credit_card" && (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.65 }}>
            <path d="M12 4C17.5 4 22 8.5 22 14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M12 8C15.3 8 18 10.7 18 14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M12 12C13.1 12 14 12.9 14 14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="12" cy="14" r="1.5" fill="white"/>
          </svg>
        )}
      </div>

      {/* Account name */}
      <div
        className="mb-3 truncate"
        style={{ font: "var(--text-micro)", color: "rgba(255,255,255,.62)" }}
      >
        {account.name}
      </div>

      {/* Balance */}
      <div
        className="tnum leading-none mb-4"
        style={{ font: "var(--text-stat)", fontSize: 26, color: "#fff" }}
      >
        {formatCurrency(account.balance)}
      </div>

      {/* Row 3: account type + masked number */}
      <div className="flex items-center justify-between">
        <span
          style={{ font: "var(--text-micro)", color: "rgba(255,255,255,.56)" }}
        >
          {(() => {
            const label = account.type.replace("_", " ");
            return label.charAt(0).toUpperCase() + label.slice(1);
          })()}
        </span>
        <span
          className="font-mono text-[13px] tracking-widest"
          style={{ color: "rgba(255,255,255,.60)" }}
        >
          {lastFour ? `•••• ${lastFour}` : "•••• ••••"}
        </span>
      </div>
    </Link>
  );
}
