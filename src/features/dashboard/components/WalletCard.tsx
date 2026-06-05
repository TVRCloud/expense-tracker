import { Wallet, ChevronRight } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import Link from "next/link";
import { type IAccount } from "@/types/models";

interface Props {
  account: IAccount;
}

export function WalletCard({ account }: Props) {
  const { formatCurrency } = useCurrency();
  return (
    <Link
      href={`/accounts/${account._id}`}
      className="flex items-center gap-4 rounded-[var(--r-lg)] px-5 py-4 transition-all hover:-translate-y-0.5"
      style={{
        background: "var(--card)",
        boxShadow: "var(--shadow-sm)",
        marginBottom: 4,
      }}
    >
      <div
        className="w-12 h-12 rounded-[14px] grid place-items-center flex-none"
        style={{ background: "var(--card-2)", color: "var(--violet)" }}
      >
        <Wallet size={23} />
      </div>
      <div>
        <div className="font-bold text-[15.5px]" style={{ color: "var(--ink)" }}>
          {account.name}
        </div>
        <div className="text-xs font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
          {account.type.replace("_", " ")}
        </div>
      </div>
      <div className="ml-auto font-extrabold text-[17px] tnum" style={{ color: "var(--ink)" }}>
        {formatCurrency(account.balance)}
      </div>
      <ChevronRight size={20} style={{ color: "var(--ink-3)" }} />
    </Link>
  );
}
