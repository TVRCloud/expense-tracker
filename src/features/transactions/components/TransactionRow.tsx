import { ChevronRight, ArrowLeftRight, Repeat, SplitSquareHorizontal } from "lucide-react";
import { SourceBadge, ReviewBadge } from "@/features/reconcile/components/SourceBadge";
import Link from "next/link";
import { useCurrency } from "@/hooks/useCurrency";
import { type ITransaction } from "@/types/models";
import { format } from "date-fns";
import { getTransactionActivityDate, isPaidRecurringTransaction } from "../utils/activity-date";
import { TRANSACTION_CATEGORY_ICONS } from "@/lib/icons";
import { getCategoryColor as getAvatarColor, canonicalizeCategory } from "@/lib/category-colors";

interface Props {
  transaction: ITransaction;
  /** Inside a day group, whose header already says the date. */
  hideDate?: boolean;
}

export function TransactionRow({ transaction, hideDate = false }: Props) {
  const { formatCurrency } = useCurrency();
  const isIncome = transaction.type === "income";
  const isTransfer = transaction.type === "transfer";
  const sign = isTransfer ? "" : isIncome ? "+" : "-";
  const color = isTransfer ? "var(--violet)" : isIncome ? "var(--green)" : "var(--red)";
  const catKey = canonicalizeCategory(transaction.category);
  const CategoryIcon = isTransfer ? ArrowLeftRight : (TRANSACTION_CATEGORY_ICONS[catKey] ?? TRANSACTION_CATEGORY_ICONS.other);
  const avatarHex = isTransfer ? null : getAvatarColor(transaction.category);
  const activityDate = getTransactionActivityDate(transaction);
  const paidRecurring = isPaidRecurringTransaction(transaction);
  const day = hideDate ? null : format(activityDate, "d MMM yyyy");
  const meta = paidRecurring
    ? `Paid ${format(activityDate, "d MMM yyyy")} · Due ${format(new Date(transaction.date), "d MMM yyyy")} · ${transaction.category}`
    : [day, isTransfer ? "Transfer" : transaction.category].filter(Boolean).join(" · ");
  const title = transaction.description ?? transaction.category;
  const href = `/transactions/${transaction._id}`;

  return (
    // A real link covers the row (so it works with the keyboard, middle
    // click and screen readers); the recurring chip sits above it, since
    // links can't nest.
    <div
      className="group relative flex items-center gap-3.5 sm:gap-4 rounded-(--r-md) px-3.5 sm:px-4 py-3 sm:py-3.5 transition-transform duration-150 has-[a:active]:scale-[0.98]"
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
      }}
    >
      <Link
        href={href}
        aria-label={`${title}, ${isTransfer ? "transfer" : isIncome ? "received" : "spent"} ${formatCurrency(transaction.amount)}`}
        className="absolute inset-0 rounded-(--r-md) outline-none focus-visible:ring-2 focus-visible:ring-(--violet) focus-visible:ring-offset-2"
      />
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
            background: `color-mix(in srgb, ${avatarHex} 14%, transparent)`,
            border: `1.5px solid color-mix(in srgb, ${avatarHex} 28%, transparent)`,
          }}
        >
          <CategoryIcon size={20} style={{ color: avatarHex! }} />
        </div>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="font-semibold text-[15px] truncate"
            style={{ color: "var(--ink)" }}
          >
            {title}
          </div>
          {transaction.isRecurring && transaction.recurringId && (
            <Link
              href={`/transactions/recurring/${transaction.recurringId}`}
              className="relative z-10 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full flex-none"
              style={{ background: "color-mix(in srgb, var(--violet) 10%, transparent)", color: "var(--violet)" }}
            >
              <Repeat size={9} className="inline" />
              {transaction.installmentIndex != null ? ` #${transaction.installmentIndex + 1}` : " recurring"}
            </Link>
          )}
          {transaction.splitGroupId && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full flex-none"
              style={{ background: "color-mix(in srgb, var(--amber) 12%, transparent)", color: "var(--amber)" }}
            >
              <SplitSquareHorizontal size={9} className="inline" />
              Split
            </span>
          )}
          <SourceBadge source={transaction.source} />
          <ReviewBadge status={transaction.reviewStatus} />
        </div>
        <div className="text-xs mt-0.5 truncate" style={{ color: "var(--ink-3)" }}>
          {meta}
        </div>
      </div>

      {/* Amount — tinted chip */}
      <div
        className="ml-auto tnum whitespace-nowrap px-2.5 py-1 rounded-xl"
        style={{
          font: "var(--text-figure-sm)",
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
      <ChevronRight size={19} aria-hidden style={{ color: "var(--ink-3)", flexShrink: 0 }} />
    </div>
  );
}
