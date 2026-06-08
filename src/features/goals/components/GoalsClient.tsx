"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Target, Save } from "lucide-react";
import { format } from "date-fns";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { type IGoal } from "@/types/models";
import { Skeleton } from "@/components/ui/skeleton";
import { DatePickerField } from "@/components/shared/DatePickerField";
import { toast } from "sonner";

function useGoals() {
  return useQuery<IGoal[]>({
    queryKey: ["goals"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: IGoal[] }>("/goals");
      return res.data.data;
    },
  });
}

const GOAL_ICONS = ["🏠", "🚗", "✈️", "📱", "💻", "🎓", "💍", "🏖️", "🎯", "💼"];

interface GoalForm {
  name: string;
  targetAmount: string;
  targetDate?: Date;
  icon: string;
}

const emptyGoalForm: GoalForm = { name: "", targetAmount: "", targetDate: undefined, icon: "🎯" };

export function GoalsClient() {
  const { formatCurrency } = useCurrency();
  const qc = useQueryClient();
  const { data: goals, isLoading } = useGoals();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<GoalForm>(emptyGoalForm);
  const [progressInputs, setProgressInputs] = useState<Record<string, string>>({});

  const createGoal = useMutation({
    mutationFn: () => apiClient.post("/goals", {
      name: form.name,
      targetAmount: Math.round(parseFloat(form.targetAmount) * 100),
      targetDate: form.targetDate?.toISOString(),
      icon: form.icon,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["goals"] });
      setShowAdd(false);
      setForm(emptyGoalForm);
      toast.success("Goal created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteGoal = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/goals/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["goals"] });
      toast.success("Goal deleted");
    },
  });

  const updateProgress = useMutation({
    mutationFn: ({ goal, amount }: { goal: IGoal; amount: number }) =>
      apiClient.patch(`/goals/${goal._id}`, {
        savedAmount: Math.min(goal.targetAmount, goal.savedAmount + amount),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["goals"] });
      setProgressInputs({});
      toast.success("Goal progress updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-5">
      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-44 rounded-[var(--r-lg)]" />)}
        </div>
      ) : (goals ?? []).length === 0 && !showAdd ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-[var(--r-lg)] py-16"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <Target size={40} style={{ color: "var(--ink-3)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No savings goals yet</p>
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm font-bold px-4 py-2 rounded-full"
            style={{ background: "var(--violet)", color: "#fff" }}
          >
            Create goal
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {(goals ?? []).map((g) => {
            const pct = g.targetAmount > 0 ? Math.min((g.savedAmount / g.targetAmount) * 100, 100) : 0;
            return (
              <div
                key={String(g._id)}
                className="rounded-[var(--r-lg)] p-5"
                style={{
                  background: g.isCompleted
                    ? "linear-gradient(135deg, #4FC07E15 0%, #4FC07E08 100%)"
                    : "var(--card)",
                  boxShadow: "var(--shadow)",
                  border: g.isCompleted ? "1.5px solid var(--green)" : "1.5px solid transparent",
                }}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-[14px] grid place-items-center text-2xl"
                      style={{ background: "var(--card-2)" }}
                    >
                      {g.icon ?? "🎯"}
                    </div>
                    <div>
                      <div className="font-extrabold text-sm" style={{ color: "var(--ink)" }}>{g.name}</div>
                      {g.targetDate && (
                        <div className="text-xs font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
                          By {format(new Date(g.targetDate), "d MMM yyyy")}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {g.isCompleted && (
                      <span
                        className="text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full"
                        style={{ background: "rgba(79,192,126,.15)", color: "var(--green)" }}
                      >
                        Done
                      </span>
                    )}
                    <button onClick={() => deleteGoal.mutate(String(g._id))}>
                      <Trash2 size={14} style={{ color: "var(--ink-3)" }} />
                    </button>
                  </div>
                </div>

                {/* Amount */}
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Saved</div>
                    <div className="text-xl font-extrabold tnum" style={{ color: "var(--green)" }}>
                      {formatCurrency(g.savedAmount)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Goal</div>
                    <div className="text-xl font-extrabold tnum" style={{ color: "var(--ink)" }}>
                      {formatCurrency(g.targetAmount)}
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: g.isCompleted ? "var(--green)" : "var(--violet)" }}
                  />
                </div>
                <div className="text-right text-[11px] font-semibold mt-1.5" style={{ color: "var(--ink-3)" }}>
                  {Math.round(pct)}%
                </div>

                {!g.isCompleted && (
                  <div className="flex gap-2 mt-4">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={progressInputs[String(g._id)] ?? ""}
                      onChange={(e) => setProgressInputs((current) => ({ ...current, [String(g._id)]: e.target.value }))}
                      placeholder="Add saved amount"
                      className="flex-1 rounded-[var(--r-sm)] px-3 py-2 text-sm outline-none"
                      style={{ background: "var(--card-2)", color: "var(--ink)", border: "1px solid var(--line)" }}
                    />
                    <button
                      onClick={() => {
                        const amount = Math.round(parseFloat(progressInputs[String(g._id)] ?? "0") * 100);
                        if (amount > 0) updateProgress.mutate({ goal: g, amount });
                      }}
                      disabled={updateProgress.isPending || !progressInputs[String(g._id)]}
                      className="inline-flex items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-sm font-bold disabled:opacity-50"
                      style={{ background: "var(--violet)", color: "#fff" }}
                    >
                      <Save size={14} />
                      Add
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add goal form */}
      {showAdd && (
        <div
          className="rounded-[var(--r-lg)] p-5 flex flex-col gap-4"
          style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
        >
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>New Goal</div>

          {/* Icon picker */}
          <div className="flex gap-2 flex-wrap">
            {GOAL_ICONS.map(icon => (
              <button
                key={icon}
                onClick={() => setForm(f => ({ ...f, icon }))}
                className="w-10 h-10 rounded-[10px] text-xl grid place-items-center"
                style={{
                  background: form.icon === icon ? "var(--violet)" : "var(--card-2)",
                }}
              >
                {icon}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Goal name</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Emergency fund"
                className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Target ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.targetAmount}
                onChange={e => setForm(f => ({ ...f, targetAmount: e.target.value }))}
                placeholder="e.g. 5000"
                className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <DatePickerField
                label="Target date (optional)"
                value={form.targetDate}
                onChange={(targetDate) => setForm(f => ({ ...f, targetDate }))}
                clearable
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => createGoal.mutate()}
              disabled={createGoal.isPending || !form.name || !form.targetAmount}
              className="flex-1 py-2.5 rounded-[var(--r-sm)] text-sm font-bold"
              style={{ background: "var(--violet)", color: "#fff" }}
            >
              {createGoal.isPending ? "Saving..." : "Create Goal"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-5 py-2.5 rounded-[var(--r-sm)] text-sm font-bold"
              style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!showAdd && (goals ?? []).length > 0 && (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center justify-center gap-2 rounded-[var(--r-md)] py-3.5 text-sm font-bold"
          style={{ background: "var(--card)", color: "var(--violet)", boxShadow: "var(--shadow-sm)" }}
        >
          <Plus size={17} />
          Add Goal
        </button>
      )}
    </div>
  );
}
