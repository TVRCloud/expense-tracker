"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Delete, ChevronDown, Repeat2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useCreateTransaction } from "../hooks/useTransactions";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { useCurrency } from "@/hooks/useCurrency";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

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
  const [calOpen, setCalOpen] = useState(false);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceCount, setRecurrenceCount] = useState("");
  const [recurrenceLabel, setRecurrenceLabel] = useState("");

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { accountId: accounts[0]?._id as string ?? "" },
  });

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
      recurrenceFrequency: repeatEnabled ? recurrenceFrequency : undefined,
      recurrenceInterval: repeatEnabled ? recurrenceInterval : undefined,
      recurrenceCount: repeatEnabled && recurrenceCount ? Number(recurrenceCount) : undefined,
      recurrenceLabel: repeatEnabled ? recurrenceLabel || undefined : undefined,
    });

    router.push("/transactions");
  });

  const isIncome = txType === "income";

  return (
    <div className="grid md:grid-cols-2 gap-4 md:gap-5 h-full min-w-0">
      {/* LEFT: Numpad card */}
      <div
        className="rounded-[var(--r-lg)] p-4 sm:p-6 flex flex-col gap-4 sm:gap-5 min-w-0"
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
              className="rounded-[var(--r-sm)] h-12 sm:h-14 flex items-center justify-center text-lg sm:text-xl font-bold transition-all hover:opacity-80 active:scale-95"
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
        className="rounded-[var(--r-lg)] p-4 sm:p-6 flex flex-col gap-4 sm:gap-5 min-w-0"
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
                    className="flex flex-col items-center gap-1.5 rounded-[var(--r-sm)] p-2 sm:p-2.5 transition-all min-w-0"
                    style={
                      isActive
                        ? {
                            background: "var(--violet)",
                            boxShadow: "0 4px 12px rgba(107,70,245,.3)",
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
              className="w-full rounded-[var(--r-sm)] px-4 py-3 text-sm font-semibold appearance-none outline-none"
              style={{
                background: "var(--card-2)",
                color: "var(--ink)",
                border: "1.5px solid var(--line)",
              }}
            >
              {accounts.map((acc) => (
                <option key={String(acc._id)} value={String(acc._id)}>
                  {acc.name} ({formatCurrency(acc.balance)})
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--ink-3)" }} />
          </div>
          {errors.accountId && (
            <p className="text-xs" style={{ color: "var(--red)" }}>{errors.accountId.message}</p>
          )}
        </div>

        {/* Recurring options */}
        <div
          className="rounded-[var(--r-md)] p-4 flex flex-col gap-3"
          style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}
        >
          <label className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--ink)" }}>
              <Repeat2 size={16} />
              Recurring
            </span>
            <input
              type="checkbox"
              checked={repeatEnabled}
              onChange={(e) => setRepeatEnabled(e.target.checked)}
              className="h-5 w-5"
              style={{ accentColor: "var(--violet)" }}
            />
          </label>

          {repeatEnabled && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTxType("income");
                    setRecurrenceFrequency("monthly");
                    setRecurrenceInterval(1);
                    setRecurrenceLabel("Salary");
                  }}
                  className="rounded-[var(--r-sm)] px-3 py-2 text-xs font-bold"
                  style={{ background: "var(--card)", color: "var(--green)" }}
                >
                  Monthly salary
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTxType("expense");
                    setSelectedCategory("emi");
                    setRecurrenceFrequency("monthly");
                    setRecurrenceInterval(1);
                    setRecurrenceLabel("EMI");
                  }}
                  className="rounded-[var(--r-sm)] px-3 py-2 text-xs font-bold"
                  style={{ background: "var(--card)", color: "var(--red)" }}
                >
                  Monthly EMI
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Repeats</span>
                  <select
                    value={recurrenceFrequency}
                    onChange={(e) => setRecurrenceFrequency(e.target.value as "weekly" | "monthly" | "yearly")}
                    className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                    style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Every</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={recurrenceInterval}
                    onChange={(e) => setRecurrenceInterval(Math.max(1, Number(e.target.value)))}
                    className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                    style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Months/installments</span>
                  <input
                    type="number"
                    min={1}
                    value={recurrenceCount}
                    onChange={(e) => setRecurrenceCount(e.target.value)}
                    placeholder="Optional"
                    className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                    style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Label</span>
                  <input
                    value={recurrenceLabel}
                    onChange={(e) => setRecurrenceLabel(e.target.value)}
                    placeholder="Salary, EMI"
                    className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                    style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Date picker */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
            Date
          </label>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="w-full text-left rounded-[var(--r-sm)] px-4 py-3 text-sm font-semibold"
                style={{
                  background: "var(--card-2)",
                  color: "var(--ink)",
                  border: "1.5px solid var(--line)",
                }}
              >
                {format(date, "MMMM d, yyyy")}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d: Date | undefined) => {
                  if (d) setDate(d);
                  setCalOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
            Description
          </label>
          <input
            {...register("description")}
            placeholder="What was this for?"
            className="rounded-[var(--r-sm)] px-4 py-3 text-sm outline-none"
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
            className="rounded-[var(--r-sm)] px-4 py-3 text-sm outline-none resize-none"
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
          className="mt-auto rounded-[var(--r-md)] py-3.5 sm:py-4 font-extrabold text-sm tracking-wide transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--violet)", color: "#fff" }}
        >
          {isPending ? "Saving..." : "Save Transaction"}
        </button>
      </form>
    </div>
  );
}
