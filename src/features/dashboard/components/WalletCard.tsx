import { useCurrency } from "@/hooks/useCurrency";
import Link from "next/link";
import { type IAccount } from "@/types/models";

interface Props {
  account: IAccount;
}

export function WalletCard({ account }: Props) {
  const { formatCurrency } = useCurrency();
  const lastFour = (account as IAccount & { creditMeta?: { lastFourDigits?: string } }).creditMeta?.lastFourDigits;

  return (
    <Link
      href={`/accounts/${account._id}`}
      className="block rounded-(--r-lg) p-5 transition-transform active:scale-[0.98]"
      style={{
        background: "linear-gradient(135deg, #18181b 0%, #27272a 60%, #3f3f46 100%)",
        boxShadow: "0 20px 50px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.07)",
        minHeight: 164,
      }}
    >
      {/* Row 1: EMV chip + contactless icon */}
      <div className="flex items-start justify-between mb-4">
        {/* Gold EMV chip */}
        <div
          className="rounded flex-none"
          style={{
            width: 32,
            height: 24,
            background: "linear-gradient(135deg, #c9a227 0%, #f0d060 45%, #a07c18 100%)",
            boxShadow: "0 2px 6px rgba(0,0,0,.35)",
          }}
        />
        {/* Contactless waves */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.65 }}>
          <path d="M12 4C17.5 4 22 8.5 22 14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M12 8C15.3 8 18 10.7 18 14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M12 12C13.1 12 14 12.9 14 14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="12" cy="14" r="1.5" fill="white"/>
        </svg>
      </div>

      {/* Account name */}
      <div
        className="mb-3"
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
