"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ChevronLeft, ChevronRight, Pencil, Save } from "lucide-react";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface BudgetWithSpent {
  _id: string;
  category: string;
  limitAmount: number;
  alertAt: number;
  spent: number;
  isActive: boolean;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const CATEGORIES = [
  "groceries","transport","rent","health","shopping","coffee","education",
  "entertainment","gym","travel","subscription","other",
];

function useBudgets(month: number, year: number) {
  return useQuery<BudgetWithSpent[]>({
    queryKey: ["budgets", month, year],
    queryFn: async () => {
      const res = await apiClient.get<{ data: BudgetWithSpent[] }>(`/budgets?month=${month}&year=${year}`);
      return res.data.data;
    },
  });
}

export function BudgetsClient() {
  const { formatCurrency } = useCurrency();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showAdd, setShowAdd] = useState(false);
  const [addCategory, setAddCategory] = useState("groceries");
  const [addLimit, setAddLimit] = useState("");
  const [addAlert, setAddAlert] = useState(80);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLimit, setEditLimit] = useState("");
  const [editAlert, setEditAlert] = useState(80);
  const [editActive, setEditActive] = useState(true);

  const qc = useQueryClient();
  const { data: budgets, isLoading } = useBudgets(month, year);

  const createBudget = useMutation({
    mutationFn: () => apiClient.post("/budgets", {
      category: addCategory,
      month,
      year,
      limitAmount: Math.round(parseFloat(addLimit) * 100),
      alertAt: addAlert,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["budgets"] });
      setShowAdd(false);
      setAddLimit("");
      toast.success("Budget created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteBudget = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/budgets/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Budget deleted");
    },
  });

  const updateBudget = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/budgets/${id}`, {
      limitAmount: Math.round(parseFloat(editLimit) * 100),
      alertAt: editAlert,
      isActive: editActive,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["budgets"] });
      setEditingId(null);
      toast.success("Budget updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Month navigator */}
      <div className="flex items-center justify-between px-1">
        <button onClick={prevMonth}><ChevronLeft size={20} style={{ color: "var(--ink-3)" }} /></button>
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>
          {MONTHS[month - 1]} {year}
        </span>
        <button onClick={nextMonth}><ChevronRight size={20} style={{ color: "var(--ink-3)" }} /></button>
      </div>

      {/* Budget list */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-28 rounded-[var(--r-md)]" />)}
        </div>
      ) : (budgets ?? []).length === 0 && !showAdd ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-[var(--r-lg)] py-16"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="text-4xl">💰</div>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No budgets for this month</p>
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm font-bold px-4 py-2 rounded-full"
            style={{ background: "var(--violet)", color: "#fff" }}
          >
            Create budget
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(budgets ?? []).map((b) => {
            const pct = b.limitAmount > 0 ? Math.min((b.spent / b.limitAmount) * 100, 100) : 0;
            const over = b.spent > b.limitAmount;
            const barColor = over ? "var(--red)" : pct >= b.alertAt ? "#f59e0b" : "var(--violet)";
            const editing = editingId === b._id;

            return (
              <div
                key={b._id}
                className="rounded-[var(--r-md)] px-5 py-4"
                style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-sm capitalize" style={{ color: "var(--ink)" }}>{b.category}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold tnum" style={{ color: over ? "var(--red)" : "var(--ink-2)" }}>
                      {formatCurrency(b.spent)} / {formatCurrency(b.limitAmount)}
                    </span>
                    <button
                      onClick={() => {
                        setEditingId(editing ? null : b._id);
                        setEditLimit(String(b.limitAmount / 100));
                        setEditAlert(b.alertAt);
                        setEditActive(b.isActive);
                      }}
                    >
                      <Pencil size={14} style={{ color: "var(--ink-3)" }} />
                    </button>
                    <button onClick={() => deleteBudget.mutate(b._id)}>
                      <Trash2 size={14} style={{ color: "var(--ink-3)" }} />
                    </button>
                  </div>
                </div>
                {editing && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Limit</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editLimit}
                        onChange={(e) => setEditLimit(e.target.value)}
                        className="rounded-[var(--r-sm)] px-3 py-2 text-sm outline-none"
                        style={{ background: "var(--card-2)", color: "var(--ink)", border: "1px solid var(--line)" }}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Alert at {editAlert}%</span>
                      <input
                        type="range"
                        min={50}
                        max={100}
                        value={editAlert}
                        onChange={(e) => setEditAlert(Number(e.target.value))}
                        className="mt-2"
                        style={{ accentColor: "var(--violet)" }}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--ink-2)" }}>
                      <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                      Active
                    </label>
                    <button
                      onClick={() => updateBudget.mutate(b._id)}
                      disabled={updateBudget.isPending || !editLimit}
                      className="inline-flex items-center justify-center gap-2 rounded-[var(--r-sm)] text-sm font-bold disabled:opacity-50"
                      style={{ background: "var(--violet)", color: "#fff" }}
                    >
                      <Save size={14} />
                      Save
                    </button>
                  </div>
                )}
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: barColor }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>
                    {Math.round(pct)}% used
                  </span>
                  <span className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>
                    {formatCurrency(Math.max(0, b.limitAmount - b.spent))} left
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div
          className="rounded-[var(--r-lg)] p-5 flex flex-col gap-4"
          style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
        >
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>New Budget</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Category</label>
              <select
                value={addCategory}
                onChange={e => setAddCategory(e.target.value)}
                className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none capitalize"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Limit ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={addLimit}
                onChange={e => setAddLimit(e.target.value)}
                placeholder="e.g. 500"
                className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Alert at {addAlert}%</label>
            <input
              type="range"
              min={50}
              max={100}
              value={addAlert}
              onChange={e => setAddAlert(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: "var(--violet)" }}
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => createBudget.mutate()}
              disabled={createBudget.isPending || !addLimit}
              className="flex-1 py-2.5 rounded-[var(--r-sm)] text-sm font-bold"
              style={{ background: "var(--violet)", color: "#fff" }}
            >
              {createBudget.isPending ? "Saving..." : "Save Budget"}
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

      {/* Add button */}
      {!showAdd && (budgets ?? []).length > 0 && (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center justify-center gap-2 rounded-[var(--r-md)] py-3.5 text-sm font-bold"
          style={{ background: "var(--card)", color: "var(--violet)", boxShadow: "var(--shadow-sm)" }}
        >
          <Plus size={17} />
          Add Budget
        </button>
      )}
    </div>
  );
}
