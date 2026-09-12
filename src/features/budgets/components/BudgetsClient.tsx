"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ChevronLeft, ChevronRight, Pencil, Save, Download } from "lucide-react";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Progress } from "@/components/_ui/Progress";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { Input } from "@/components/_ui/Input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/_ui/Switch";
import { budgetCreateSchema } from "@/features/budgets/schemas/budget.schema";
import { toast } from "sonner";

interface BudgetWithSpent {
  _id: string;
  category: string;
  limitAmount: number;
  effectiveLimit: number;
  alertAt: number;
  spent: number;
  isActive: boolean;
  rollover: boolean;
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
  const [addRollover, setAddRollover] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLimit, setEditLimit] = useState("");
  const [editAlert, setEditAlert] = useState(80);
  const [editActive, setEditActive] = useState(true);
  const [editRollover, setEditRollover] = useState(false);

  const qc = useQueryClient();
  const { data: budgets, isLoading } = useBudgets(month, year);
  const { confirm, dialog } = useConfirm();

  const createBudget = useMutation({
    mutationFn: () => {
      // Same zod schema the server validates with — catches bad input before
      // the request round-trips, using one shared source of truth.
      const parsed = budgetCreateSchema.safeParse({
        category: addCategory,
        month,
        year,
        limitAmount: Math.round(parseFloat(addLimit) * 100),
        alertAt: addAlert,
        rollover: addRollover,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid budget");
      }
      return apiClient.post("/budgets", parsed.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["budgets"] });
      setShowAdd(false);
      setAddLimit("");
      setAddRollover(false);
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

  const requestDelete = async (b: BudgetWithSpent) => {
    const ok = await confirm({
      title: `Delete the ${b.category} budget?`,
      description: "This only removes the budget limit — past spending isn't affected.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) deleteBudget.mutate(b._id);
  };

  const updateBudget = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/budgets/${id}`, {
      limitAmount: Math.round(parseFloat(editLimit) * 100),
      alertAt: editAlert,
      isActive: editActive,
      rollover: editRollover,
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
        <Button type="button" variant="ghost" size="icon" aria-label="Previous month" onClick={prevMonth}>
          <ChevronLeft size={20} style={{ color: "var(--ink-3)" }} />
        </Button>
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>
          {MONTHS[month - 1]} {year}
        </span>
        <Button type="button" variant="ghost" size="icon" aria-label="Next month" onClick={nextMonth}>
          <ChevronRight size={20} style={{ color: "var(--ink-3)" }} />
        </Button>
      </div>

      <a
        href={`/api/budgets?format=csv&month=${month}&year=${year}`}
        className="self-end inline-flex items-center gap-1.5 text-sm font-bold"
        style={{ color: "var(--ink-2)" }}
      >
        <Download size={14} />
        Export CSV
      </a>

      {/* Budget list */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-28 rounded-(--r-md)" />)}
        </div>
      ) : (budgets ?? []).length === 0 && !showAdd ? (
        <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-16">
          <div className="text-4xl">💰</div>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No budgets for this month</p>
          <Button onClick={() => setShowAdd(true)} className="h-auto text-sm px-4 py-2 rounded-full">
            Create budget
          </Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {(budgets ?? []).map((b) => {
            const pct = b.effectiveLimit > 0 ? Math.min((b.spent / b.effectiveLimit) * 100, 100) : 0;
            const over = b.spent > b.effectiveLimit;
            const barColor = over ? "var(--red)" : pct >= b.alertAt ? "#f59e0b" : "var(--violet)";
            const editing = editingId === b._id;
            const carried = b.effectiveLimit - b.limitAmount;

            return (
              <Card key={b._id} radius="md" className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-sm capitalize" style={{ color: "var(--ink)" }}>{b.category}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-semibold tnum mr-1" style={{ color: over ? "var(--red)" : "var(--ink-2)" }}>
                      {formatCurrency(b.spent)} / {formatCurrency(b.effectiveLimit)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={editing ? `Close ${b.category} budget editor` : `Edit ${b.category} budget`}
                      onClick={() => {
                        setEditingId(editing ? null : b._id);
                        setEditLimit(String(b.limitAmount / 100));
                        setEditAlert(b.alertAt);
                        setEditActive(b.isActive);
                        setEditRollover(b.rollover);
                      }}
                    >
                      <Pencil size={14} style={{ color: "var(--ink-3)" }} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Delete ${b.category} budget`}
                      onClick={() => requestDelete(b)}
                    >
                      <Trash2 size={14} style={{ color: "var(--ink-3)" }} />
                    </Button>
                  </div>
                </div>
                {editing && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Limit</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editLimit}
                        onChange={(e) => setEditLimit(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Alert at {editAlert}%</Label>
                      <input
                        type="range"
                        min={50}
                        max={100}
                        value={editAlert}
                        onChange={(e) => setEditAlert(Number(e.target.value))}
                        className="mt-2"
                        style={{ accentColor: "var(--violet)" }}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--ink-2)" }}>
                      <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                      Active
                    </label>
                    <label className="flex items-center justify-between gap-2 text-sm font-bold" style={{ color: "var(--ink-2)" }}>
                      Roll over unspent
                      <Switch checked={editRollover} onCheckedChange={setEditRollover} />
                    </label>
                    <Button
                      onClick={() => updateBudget.mutate(b._id)}
                      disabled={updateBudget.isPending || !editLimit}
                      className="h-auto rounded-(--r-sm) font-bold"
                    >
                      <Save size={14} />
                      Save
                    </Button>
                  </div>
                )}
                <Progress value={pct} color={barColor} trackColor="var(--line)" height={8} />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>
                    {Math.round(pct)}% used
                  </span>
                  <span className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>
                    {formatCurrency(Math.max(0, b.effectiveLimit - b.spent))} left
                  </span>
                </div>
                {b.rollover && carried > 0 && (
                  <div className="text-[11px] font-semibold mt-1" style={{ color: "var(--green)" }}>
                    +{formatCurrency(carried)} carried over from last month
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <Card radius="lg" elevation="floating" className="p-5 flex flex-col gap-4">
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>New Budget</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Category</Label>
              <Select value={addCategory} onValueChange={setAddCategory}>
                <SelectTrigger className="capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Limit ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={addLimit}
                onChange={e => setAddLimit(e.target.value)}
                placeholder="e.g. 500"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Alert at {addAlert}%</Label>
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
          <label className="flex items-center justify-between gap-2 text-sm font-bold" style={{ color: "var(--ink-2)" }}>
            Roll over unspent to next month
            <Switch checked={addRollover} onCheckedChange={setAddRollover} />
          </label>
          <div className="flex gap-3">
            <Button
              onClick={() => createBudget.mutate()}
              disabled={createBudget.isPending || !addLimit}
              className="flex-1 h-auto py-2.5 rounded-(--r-sm) font-bold"
            >
              {createBudget.isPending ? "Saving..." : "Save Budget"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowAdd(false)}
              className="h-auto px-5 py-2.5 rounded-(--r-sm) font-bold"
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Add button */}
      {!showAdd && (budgets ?? []).length > 0 && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowAdd(true)}
          className="h-auto flex items-center justify-center gap-2 rounded-(--r-md) py-3.5 font-bold"
          style={{ color: "var(--violet)" }}
        >
          <Plus size={17} />
          Add Budget
        </Button>
      )}
      {dialog}
    </div>
  );
}
