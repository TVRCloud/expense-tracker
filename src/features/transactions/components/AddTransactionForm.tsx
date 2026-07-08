"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Delete, ChevronDown, Repeat2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  addDays, addWeeks, addMonths, addYears,
  differenceInDays, differenceInWeeks, differenceInMonths, differenceInYears,
  format,
} from "date-fns";
import { useCreateTransaction } from "../hooks/useTransactions";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { useCurrency } from "@/hooks/useCurrency";
import { DatePickerField } from "@/components/shared/DatePickerField";
import { BillingCycleHint } from "@/features/credit-cards/components/BillingCycleHint";

// Each option maps to an API {frequency, interval} pair
const FREQ_OPTIONS = [
  { key: "weekly",     label: "Weekly",      frequency: "weekly"  as const, interval: 1 },
  { key: "biweekly",   label: "Bi-weekly",   frequency: "weekly"  as const, interval: 2 },
  { key: "monthly",    label: "Monthly",     frequency: "monthly" as const, interval: 1 },
  { key: "quarterly",  label: "Quarterly",   frequency: "monthly" as const, interval: 3 },
  { key: "halfyearly", label: "Half-yearly", frequency: "monthly" as const, interval: 6 },
  { key: "yearly",     label: "Yearly",      frequency: "yearly"  as const, interval: 1 },
] as const;

type FreqKey = typeof FREQ_OPTIONS[number]["key"];
type EndMode = "count" | "date" | "never";

function defaultOpenEndedCount(frequency: string): number {
  if (frequency === "daily") return 365;
  if (frequency === "weekly") return 260;
  if (frequency === "yearly") return 30;
  return 120;
}

function computeCount(start: Date, end: Date, frequency: string, interval: number): number {
  switch (frequency) {
    case "weekly":  return Math.max(1, Math.floor(differenceInWeeks(end, start) / interval) + 1);
    case "monthly": return Math.max(1, Math.floor(differenceInMonths(end, start) / interval) + 1);
    case "yearly":  return Math.max(1, Math.floor(differenceInYears(end, start) / interval) + 1);
    default:        return Math.max(1, Math.floor(differenceInDays(end, start) / interval) + 1);
  }
}

function computeEndDate(start: Date, frequency: string, interval: number, count: number): Date {
  const n = Math.max(0, count - 1) * interval;
  switch (frequency) {
    case "weekly":  return addWeeks(start, n);
    case "monthly": return addMonths(start, n);
    case "yearly":  return addYears(start, n);
    default:        return addDays(start, n);
  }
}

const CATEGORIES: { icon: string; label: string; value: string }[] = [
  { icon: "🛒", label: "Groceries", value: "groceries" },
  { icon: "🚗", label: "Transport", value: "transport" },
  { icon: "🏠", label: "Rent", value: "rent" },
  { icon: "💊", label: "Health", value: "health" },
  { icon: "🛍️", label: "Shopping", value: "shopping" },
  { icon: "☕", label: "Coffee", value: "coffee" },
  { icon: "📚", label: "Education", value: "education" },
  { icon: "🎮", label: "Entertainment", value: "entertainment" },
  { icon: "💪", label: "Gym", value: "gym" },
  { icon: "✈️", label: "Travel", value: "travel" },
  { icon: "📱", label: "Subscriptions", value: "subscription" },
  { icon: "🏦", label: "EMI", value: "emi" },
  { icon: "💼", label: "Income", value: "income" },
  { icon: "🔄", label: "Transfer", value: "transfer" },
  { icon: "📦", label: "Other", value: "other" },
];

const NUMPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

const schema = z.object({
  accountId: z.string().min(1, "Select an account"),
  description: z.string().optional(),
  note: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function AddTransactionForm() {
  const { formatCurrency, currency } = useCurrency();
  const router = useRouter();
  const { mutateAsync: create, isPending } = useCreateTransaction();
  const { data: accountsData } = useAccounts();
  const accounts = accountsData ?? [];

  const [txType, setTxType] = useState<"expense" | "income">("expense");
  const [displayAmount, setDisplayAmount] = useState("0");
  const [selectedCategory, setSelectedCategory] = useState("groceries");
  const [date, setDate] = useState<Date>(new Date());
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [freqKey, setFreqKey] = useState<FreqKey>("monthly");
  const [endMode, setEndMode] = useState<EndMode>("never");
  const [recurrenceCount, setRecurrenceCount] = useState("");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<Date | undefined>();
  const [recurrenceLabel, setRecurrenceLabel] = useState("");

  const { register, watch, handleSubmit, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { accountId: "" },
  });

  // Set default account once accounts load (defaultValues runs before data is available)
  useEffect(() => {
    if (accounts.length > 0 && !watch("accountId")) {
      setValue("accountId", String(accounts[0]._id));
    }
  }, [accounts]);

  const watchedAccountId = watch("accountId");
  const selectedAccount = accounts.find(a => String(a._id) === watchedAccountId);

  const handleNumpad = useCallback((key: string) => {
    if (key === "⌫") {
      setDisplayAmount((prev) => {
        const next = prev.length > 1 ? prev.slice(0, -1) : "0";
        return next;
      });
      return;
    }
    if (key === ".") {
      if (displayAmount.includes(".")) return;
      setDisplayAmount((prev) => prev + ".");
      return;
    }
    setDisplayAmount((prev) => {
      if (prev === "0") return key;
      // Limit to 2 decimal places
      const parts = prev.split(".");
      if (parts[1] !== undefined && parts[1].length >= 2) return prev;
      return prev + key;
    });
  }, [displayAmount]);

  const amountInCents = Math.round(parseFloat(displayAmount || "0") * 100);

  const freqOption = FREQ_OPTIONS.find(f => f.key === freqKey) ?? FREQ_OPTIONS[2];

  // Derive the effective count and end date from the chosen end mode
  const { effectiveCount, effectiveEndDate } = useMemo(() => {
    if (!repeatEnabled) return { effectiveCount: undefined, effectiveEndDate: undefined };
    if (endMode === "count" && recurrenceCount) {
      const n = Math.max(1, Number(recurrenceCount));
      return { effectiveCount: n, effectiveEndDate: computeEndDate(date, freqOption.frequency, freqOption.interval, n) };
    }
    if (endMode === "date" && recurrenceEndDate && recurrenceEndDate > date) {
      const n = computeCount(date, recurrenceEndDate, freqOption.frequency, freqOption.interval);
      return { effectiveCount: n, effectiveEndDate: recurrenceEndDate };
    }
    return { effectiveCount: defaultOpenEndedCount(freqOption.frequency), effectiveEndDate: undefined };
  }, [repeatEnabled, endMode, recurrenceCount, recurrenceEndDate, date, freqOption]);

  const recurringSummary = useMemo(() => {
    if (!repeatEnabled) return null;
    const parts: string[] = [`${freqOption.label} from ${format(date, "MMM d, yyyy")}`];
    if (endMode === "never") {
      parts.push("ongoing, no end date");
      if (amountInCents > 0) parts.push(`${formatCurrency(amountInCents)} per ${freqOption.label.toLowerCase()}`);
    } else if (effectiveCount) {
      parts.push(`${effectiveCount} payment${effectiveCount !== 1 ? "s" : ""}`);
      if (effectiveEndDate) parts.push(`until ${format(effectiveEndDate, "MMM d, yyyy")}`);
      if (amountInCents > 0) parts.push(`Total ${formatCurrency(amountInCents * effectiveCount)}`);
    }
    return parts.join(" · ");
  }, [repeatEnabled, freqOption, date, effectiveCount, effectiveEndDate, amountInCents, formatCurrency, endMode]);

  const onSubmit = handleSubmit(async (values) => {
    if (amountInCents <= 0) return;

    const category = txType === "income" ? "income" : selectedCategory;
    const finalType = txType;

    await create({
      accountId: values.accountId,
      type: finalType,
      amount: amountInCents,
      currency,
      category,
      description: values.description || undefined,
      note: values.note || undefined,
      date: date.toISOString(),
      tags: [],
      isRecurring: repeatEnabled,
      recurrenceFrequency: repeatEnabled ? freqOption.frequency : undefined,
      recurrenceInterval: repeatEnabled ? freqOption.interval : undefined,
      recurrenceCount: repeatEnabled && endMode !== "never" ? effectiveCount : undefined,
      recurrenceEndDate: repeatEnabled && effectiveEndDate ? effectiveEndDate.toISOString() : undefined,
      recurrenceLabel: repeatEnabled ? recurrenceLabel || undefined : undefined,
    });

    router.push("/transactions");
  });

  const isIncome = txType === "income";

  return (
    <div className="grid md:grid-cols-2 gap-4 md:gap-5 h-full min-w-0">
      {/* LEFT: Numpad card */}
      <div
        className="rounded-(--r-lg) p-4 sm:p-6 flex flex-col gap-4 sm:gap-5 min-w-0"
        style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
      >
        {/* Type toggle */}
        <div
          className="flex p-1 rounded-full gap-1"
          style={{ background: "var(--card-2)" }}
        >
          {(["expense", "income"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTxType(t)}
              className="flex-1 py-2 rounded-full text-sm font-bold capitalize transition-all"
              style={
                txType === t
                  ? {
                      background: t === "expense" ? "var(--red)" : "var(--green)",
                      color: "#fff",
                    }
                  : { color: "var(--ink-2)" }
              }
            >
              {t}
            </button>
          ))}
        </div>

        {/* Amount display */}
        <div className="flex flex-col items-center py-2 sm:py-4 min-w-0">
          <div
            className="text-[38px] min-[390px]:text-[44px] sm:text-[52px] font-extrabold tnum leading-none max-w-full overflow-hidden text-center"
            style={{ color: isIncome ? "var(--green)" : "var(--red)" }}
          >
            {isIncome ? "+" : "-"}{formatCurrency(amountInCents)}
          </div>
          <div className="text-sm mt-2 font-medium" style={{ color: "var(--ink-3)" }}>
            {displayAmount} {currency}
          </div>
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3">
          {NUMPAD_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => handleNumpad(key)}
              className="rounded-(--r-sm) h-12 sm:h-14 flex items-center justify-center text-lg sm:text-xl font-bold transition-all hover:opacity-80 active:scale-95"
              style={
                key === "⌫"
                  ? {
                      background: "var(--red)",
                      color: "#fff",
                    }
                  : {
                      background: "var(--card-2)",
                      color: "var(--ink)",
                      boxShadow: "var(--shadow-sm)",
                    }
              }
            >
              {key === "⌫" ? <Delete size={20} /> : key}
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT: Details card */}
      <form
        onSubmit={onSubmit}
        className="rounded-(--r-lg) p-4 sm:p-6 flex flex-col gap-4 sm:gap-5 min-w-0"
        style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
      >
        {/* Category grid (only for expenses) */}
        {!isIncome && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "var(--ink-3)" }}>
              Category
            </div>
            <div className="grid grid-cols-3 min-[390px]:grid-cols-4 gap-2">
              {CATEGORIES.filter((c) => c.value !== "income" && c.value !== "transfer").map((cat) => {
                const isActive = selectedCategory === cat.value;
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setSelectedCategory(cat.value)}
                    className="flex flex-col items-center gap-1.5 rounded-(--r-sm) p-2 sm:p-2.5 transition-all min-w-0"
                    style={
                      isActive
                        ? {
                            background: "var(--violet)",
                            boxShadow: "0 4px 12px rgba(0,0,0,.3)",
                          }
                        : {
                            background: "var(--card-2)",
                          }
                    }
                  >
                    <span className="text-lg sm:text-xl">{cat.icon}</span>
                    <span
                      className="text-[10px] font-semibold truncate w-full text-center"
                      style={{ color: isActive ? "#fff" : "var(--ink-2)" }}
                    >
                      {cat.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Account selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
            Account
          </label>
          <div className="relative">
            <select
              {...register("accountId")}
              className="w-full rounded-(--r-sm) px-4 py-3 text-sm font-semibold appearance-none outline-none"
              style={{
                background: "var(--card-2)",
                color: "var(--ink)",
                border: "1.5px solid var(--line)",
              }}
            >
              {accounts.map((acc) => (
                <option key={String(acc._id)} value={String(acc._id)}>
                  {acc.name} {acc.type === "credit_card"
                    ? `(CC · Limit ${formatCurrency(acc.creditMeta?.creditLimit ?? 0)})`
                    : `(${formatCurrency(acc.balance)})`}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--ink-3)" }} />
          </div>
          {errors.accountId && (
            <p className="text-xs" style={{ color: "var(--red)" }}>{errors.accountId.message}</p>
          )}
          {selectedAccount?.type === "credit_card" && watchedAccountId && (
            <BillingCycleHint accountId={watchedAccountId} date={date} />
          )}
        </div>

        {/* Recurring options */}
        <div
          className="rounded-(--r-md) p-4 flex flex-col gap-3"
          style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}
        >
          {/* Toggle row */}
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--ink)" }}>
              <Repeat2 size={16} />
              Recurring
            </span>
            <button
              type="button"
              onClick={() => setRepeatEnabled(v => !v)}
              className="relative w-10 h-5 rounded-full transition-all"
              style={{ background: repeatEnabled ? "var(--violet)" : "var(--line)" }}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                style={{
                  background: "#fff",
                  left: repeatEnabled ? "calc(100% - 18px)" : "2px",
                  boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                }}
              />
            </button>
          </label>

          {repeatEnabled && (
            <div className="flex flex-col gap-3">
              {/* Quick presets */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setTxType("income"); setFreqKey("monthly"); setRecurrenceLabel("Salary"); }}
                  className="flex-1 rounded-(--r-sm) px-3 py-2 text-xs font-bold"
                  style={{ background: "var(--card)", color: "var(--green)" }}
                >
                  💰 Monthly salary
                </button>
                <button
                  type="button"
                  onClick={() => { setTxType("expense"); setSelectedCategory("emi"); setFreqKey("monthly"); setRecurrenceLabel("EMI"); }}
                  className="flex-1 rounded-(--r-sm) px-3 py-2 text-xs font-bold"
                  style={{ background: "var(--card)", color: "var(--red)" }}
                >
                  🏦 Monthly EMI
                </button>
              </div>

              {/* Frequency chips */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Frequency</span>
                <div className="flex flex-wrap gap-1.5">
                  {FREQ_OPTIONS.map(f => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFreqKey(f.key)}
                      className="px-3 py-1.5 rounded-full text-[12px] font-bold transition-all"
                      style={
                        freqKey === f.key
                          ? { background: "var(--violet)", color: "#fff" }
                          : { background: "var(--card)", color: "var(--ink-2)" }
                      }
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* End condition */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Ends</span>
                <div className="flex gap-1.5">
                  {(["never", "count", "date"] as EndMode[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setEndMode(m)}
                      className="flex-1 py-1.5 rounded-(--r-sm) text-xs font-bold transition-all"
                      style={
                        endMode === m
                          ? { background: "var(--violet)", color: "#fff" }
                          : { background: "var(--card)", color: "var(--ink-2)" }
                      }
                    >
                      {m === "never" ? "Never" : m === "count" ? "After N payments" : "On a date"}
                    </button>
                  ))}
                </div>

                {endMode === "count" && (
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={recurrenceCount}
                    onChange={(e) => setRecurrenceCount(e.target.value)}
                    placeholder="e.g. 12 for 1 year monthly"
                    className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none w-full"
                    style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}
                  />
                )}
                {endMode === "date" && (
                  <DatePickerField
                    label="End date"
                    value={recurrenceEndDate}
                    onChange={setRecurrenceEndDate}
                    clearable
                  />
                )}
              </div>

              {/* Label */}
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Label</span>
                <input
                  value={recurrenceLabel}
                  onChange={(e) => setRecurrenceLabel(e.target.value)}
                  placeholder="e.g. House EMI, Netflix, Salary"
                  className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}
                />
              </label>

              {/* Summary pill */}
              {recurringSummary && (
                <div
                  className="rounded-(--r-sm) px-3 py-2.5 text-[12px] font-medium leading-relaxed"
                  style={{ background: "color-mix(in srgb, var(--violet) 10%, transparent)", color: "var(--violet)" }}
                >
                  🔄 {recurringSummary}
                </div>
              )}

              {/* Credit card total commitment */}
              {selectedAccount?.type === "credit_card" && endMode !== "never" && effectiveCount && amountInCents > 0 && (
                <div
                  className="rounded-(--r-sm) px-3 py-2.5 text-[12px] font-medium"
                  style={{ background: "color-mix(in srgb, var(--red) 8%, transparent)", color: "var(--red)" }}
                >
                  💳 Total card commitment: {formatCurrency(amountInCents)} × {effectiveCount} = <strong>{formatCurrency(amountInCents * effectiveCount)}</strong>
                  {effectiveEndDate && ` (until ${format(effectiveEndDate, "MMM yyyy")})`}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Date picker */}
        <DatePickerField
          label={repeatEnabled ? "First Installment Date" : "Date"}
          value={date}
          onChange={(nextDate) => {
            if (nextDate) setDate(nextDate);
          }}
        />

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
            Description
          </label>
          <input
            {...register("description")}
            placeholder="What was this for?"
            className="rounded-(--r-sm) px-4 py-3 text-sm outline-none"
            style={{
              background: "var(--card-2)",
              color: "var(--ink)",
              border: "1.5px solid var(--line)",
            }}
          />
        </div>

        {/* Note */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
            Note (optional)
          </label>
          <textarea
            {...register("note")}
            placeholder="Add a note..."
            rows={2}
            className="rounded-(--r-sm) px-4 py-3 text-sm outline-none resize-none"
            style={{
              background: "var(--card-2)",
              color: "var(--ink)",
              border: "1.5px solid var(--line)",
            }}
          />
        </div>

        {/* Save button */}
        <button
          type="submit"
          disabled={isPending || amountInCents <= 0}
          className="mt-auto rounded-(--r-md) py-3.5 sm:py-4 font-extrabold text-sm tracking-wide transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--violet)", color: "#fff" }}
        >
          {isPending ? "Saving..." : "Save Transaction"}
        </button>
      </form>
    </div>
  );
}
