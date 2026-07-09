import { ChevronRight, ArrowLeftRight, Repeat } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCurrency } from "@/hooks/useCurrency";
import { type ITransaction } from "@/types/models";
import { format } from "date-fns";
import { getTransactionActivityDate, isPaidRecurringTransaction } from "../utils/activity-date";
import { TRANSACTION_CATEGORY_ICONS } from "@/lib/icons";

const CAT_COLORS: Record<string, string> = {
  income: "#4FC07E",
  groceries: "#4FC07E",
  travel: "#2D9CDB",
  transport: "#2F6BFF",
  subscription: "#8B5CF6",
  health: "#2D9CDB",
  shopping: "#16A34A",
  rent: "#EA580C",
  gym: "#DB2777",
  other: "#6B46F5",
  coffee: "#2D6CDF",
  education: "#7C3AED",
  entertainment: "#D6336C",
  emi: "#7C3AED",
  transfer: "#6B46F5",
};

function getAvatarColor(category: string) {
  return CAT_COLORS[category.toLowerCase()] ?? "#6B46F5";
}

interface Props {
  transaction: ITransaction;
}

export function TransactionRow({ transaction }: Props) {
  const router = useRouter();
  const { formatCurrency } = useCurrency();
  const isIncome = transaction.type === "income";
  const isTransfer = transaction.type === "transfer";
  const sign = isTransfer ? "" : isIncome ? "+" : "-";
  const color = isTransfer ? "var(--violet)" : isIncome ? "var(--green)" : "var(--red)";
  const catKey = transaction.category.toLowerCase();
  const CategoryIcon = isTransfer ? ArrowLeftRight : (TRANSACTION_CATEGORY_ICONS[catKey] ?? TRANSACTION_CATEGORY_ICONS.other);
  const avatarHex = isTransfer ? null : getAvatarColor(transaction.category);
  const activityDate = getTransactionActivityDate(transaction);
  const paidRecurring = isPaidRecurringTransaction(transaction);
  const meta = paidRecurring
    ? `Paid ${format(activityDate, "d MMM yyyy")} · Due ${format(new Date(transaction.date), "d MMM yyyy")} · ${transaction.category}`
    : isTransfer
      ? `${format(activityDate, "d MMM yyyy")} · Transfer`
      : `${format(activityDate, "d MMM yyyy")} · ${transaction.category}`;

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/transactions/${transaction._id}`)}
      onKeyDown={e => e.key === "Enter" && router.push(`/transactions/${transaction._id}`)}
      className="flex items-center gap-4 rounded-(--r-md) px-4 py-3.5 transition-all hover:-translate-y-0.5 active:scale-[0.99] cursor-pointer"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      {/* Avatar — category icon with tinted bg */}
      {isTransfer ? (
        <div
          className="w-12 h-12 rounded-full grid place-items-center flex-none"
          style={{
            background: "color-mix(in srgb, var(--violet) 14%, transparent)",
            border: "1.5px solid color-mix(in srgb, var(--violet) 28%, transparent)",
          }}
        >
          <CategoryIcon size={20} style={{ color: "var(--violet)" }} />
        </div>
      ) : (
        <div
          className="w-12 h-12 rounded-full grid place-items-center flex-none"
          style={{
            background: `${avatarHex}22`,
            border: `1.5px solid ${avatarHex}44`,
          }}
        >
          <CategoryIcon size={20} color={avatarHex!} />
        </div>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="font-bold text-[15px] truncate"
            style={{ color: "var(--ink)" }}
          >
            {transaction.description ?? transaction.category}
          </div>
          {transaction.isRecurring && transaction.recurringId && (
            <Link
              href={`/transactions/recurring/${transaction.recurringId}`}
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-none"
              style={{ background: "color-mix(in srgb, var(--violet) 10%, transparent)", color: "var(--violet)" }}
            >
              <Repeat size={9} className="inline" />
              {transaction.installmentIndex != null ? ` #${transaction.installmentIndex + 1}` : " recurring"}
            </Link>
          )}
        </div>
        <div className="text-xs font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
          {meta}
        </div>
      </div>

      {/* Amount — tinted chip */}
      <div
        className="ml-auto font-extrabold text-[14px] tnum whitespace-nowrap px-2.5 py-1 rounded-xl"
        style={{
          color,
          background: isTransfer
            ? "color-mix(in srgb, var(--violet) 10%, transparent)"
            : isIncome
            ? "color-mix(in srgb, var(--green) 12%, transparent)"
            : "color-mix(in srgb, var(--red) 10%, transparent)",
        }}
      >
        {sign}{formatCurrency(transaction.amount)}
      </div>
      <ChevronRight size={19} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
    </div>
  );
}
