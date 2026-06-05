import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCurrency } from "@/hooks/useCurrency";
import { type ITransaction } from "@/types/models";
import { format } from "date-fns";

const CAT_COLORS: Record<string, string> = {
  income: "#4FC07E",
  groceries: "#4FC07E",
  travel: "#2D9CDB",
  car: "#2F6BFF",
  subscription: "#8B5CF6",
  health: "#2D9CDB",
  shopping: "#16A34A",
  internet: "#3B82F6",
  rent: "#EA580C",
  gym: "#DB2777",
  other: "#6B46F5",
  coffee: "#2D6CDF",
  education: "#7C3AED",
};

function getAvatarColor(category: string) {
  return CAT_COLORS[category.toLowerCase()] ?? "#6B46F5";
}

interface Props {
  transaction: ITransaction;
}

export function TransactionRow({ transaction }: Props) {
  const { formatCurrency } = useCurrency();
  const isIncome = transaction.type === "income";
  const sign = isIncome ? "+" : "-";
  const color = isIncome ? "var(--green)" : "var(--red)";
  const avatarBg = getAvatarColor(transaction.category);
  const initial = transaction.description?.[0]?.toUpperCase() ?? transaction.category[0].toUpperCase();

  return (
    <Link
      href={`/transactions/${transaction._id}`}
      className="flex items-center gap-4 rounded-[var(--r-md)] px-4 py-3.5 transition-all hover:-translate-y-0.5"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      {/* Avatar */}
      <div
        className="w-12 h-12 rounded-full grid place-items-center text-white font-bold text-lg flex-none"
        style={{ background: avatarBg }}
      >
        {initial}
      </div>

      {/* Info */}
      <div className="min-w-0">
        <div
          className="font-bold text-[15px] truncate"
          style={{ color: "var(--ink)" }}
        >
          {transaction.description ?? transaction.category}
        </div>
        <div className="text-xs font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
          {format(new Date(transaction.date), "d MMM yyyy")} · {transaction.category}
        </div>
      </div>

      {/* Amount */}
      <div className="ml-auto font-extrabold text-[15.5px] tnum whitespace-nowrap" style={{ color }}>
        {sign}{formatCurrency(transaction.amount)}
      </div>
      <ChevronRight size={19} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
    </Link>
  );
}
