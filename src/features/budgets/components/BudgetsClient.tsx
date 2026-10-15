"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ChevronLeft, ChevronRight, Pencil, Save, Download, PiggyBank } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
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

  const list = budgets ?? [];
  const activeList = list.filter(b => b.isActive);
  const totalLimit = activeList.reduce((n, b) => n + b.effectiveLimit, 0);
  const totalSpent = activeList.reduce((n, b) => n + b.spent, 0);
  const totalLeft = totalLimit - totalSpent;
  const totalPct = totalLimit > 0 ? Math.min((totalSpent / totalLimit) * 100, 100) : 0;
  const limitInvalid = !addLimit || !(parseFloat(addLimit) > 0);
  const closeAdd = () => { setShowAdd(false); setAddLimit(""); setAddRollover(false); };
  const labelStyle = { font: "var(--text-label)", color: "var(--ink-2)" } as const;

  return (
    <div className="page-stack">
      <PageHeader
        title="Budgets"
        subtitle="Monthly limits by category."
        actions={
          <>
            <div className="flex items-center rounded-full p-1" style={{ background: "var(--card-2)" }}>
              <Button type="button" variant="ghost" size="icon" aria-label="Previous month" onClick={prevMonth} className="h-9 w-9 rounded-full active:scale-[0.94] transition">
                <ChevronLeft size={18} style={{ color: "var(--ink-2)" }} />
              </Button>
              <span className="min-w-[88px] text-center tnum" style={{ font: "var(--text-label)", fontWeight: 600, color: "var(--ink)" }}>
                {MONTHS[month - 1]} {year}
              </span>
              <Button type="button" variant="ghost" size="icon" aria-label="Next month" onClick={nextMonth} className="h-9 w-9 rounded-full active:scale-[0.94] transition">
                <ChevronRight size={18} style={{ color: "var(--ink-2)" }} />
              </Button>
            </div>
            <Button type="button" onClick={() => setShowAdd(true)} className="h-11 px-5 rounded-full font-semibold btn-interactive">
              <Plus size={16} />
              New budget
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="grid-cards" style={{ "--card-min": "280px" } as React.CSSProperties}>
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-44 rounded-(--r-lg)" />)}
        </div>
      ) : list.length === 0 ? (
        <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-20 text-center px-6">
          <div className="w-14 h-14 rounded-2xl grid place-items-center" style={{ background: "var(--card-2)" }}>
            <PiggyBank size={26} style={{ color: "var(--ink-2)" }} />
          </div>
          <p style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>No budgets for {MONTHS[month - 1]}</p>
          <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Set a limit to see how spending tracks.</p>
          <Button onClick={() => setShowAdd(true)} className="h-11 px-5 rounded-full font-semibold btn-interactive">Create budget</Button>
        </Card>
      ) : (
        <>
          <Card radius="lg" className="p-5 sm:p-6 flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
              <div className="min-w-0">
                <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Spent</div>
                <div className="tnum truncate mt-1" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: "var(--ink)" }}>{formatCurrency(totalSpent)}</div>
              </div>
              <div className="min-w-0">
                <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Budgeted</div>
                <div className="tnum truncate mt-1" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: "var(--ink)" }}>{formatCurrency(totalLimit)}</div>
              </div>
              <div className="min-w-0 col-span-2 sm:col-span-1">
                <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>{totalLeft >= 0 ? "Left" : "Over by"}</div>
                <div className="tnum truncate mt-1" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: totalLeft >= 0 ? "var(--green)" : "var(--red)" }}>{formatCurrency(Math.abs(totalLeft))}</div>
              </div>
            </div>
            <Progress value={totalPct} color={totalLeft < 0 ? "var(--red)" : "var(--violet)"} trackColor="var(--line)" height={6} aria-label="Total budget used" />
            <a
              href={`/api/budgets?format=csv&month=${month}&year=${year}`}
              className="self-start inline-flex items-center gap-1.5 min-h-8"
              style={{ font: "var(--text-label)", fontWeight: 600, color: "var(--ink-2)" }}
            >
              <Download size={14} />
              Export CSV
            </a>
          </Card>

          <div className="grid-cards items-start" style={{ "--card-min": "300px" } as React.CSSProperties}>
            {list.map((b) => {
              const pct = b.effectiveLimit > 0 ? Math.min((b.spent / b.effectiveLimit) * 100, 100) : 0;
              const over = b.spent > b.effectiveLimit;
              const near = !over && pct >= b.alertAt;
              const tone = over ? "var(--red)" : near ? "var(--amber)" : "var(--green)";
              const ringColor = over ? "var(--red)" : near ? "var(--amber)" : "var(--violet)";
              const status = !b.isActive ? "Paused" : over ? "Over budget" : near ? "Near limit" : "On track";
              const editing = editingId === b._id;
              const carried = b.effectiveLimit - b.limitAmount;
              const R = 26;
              const C = 2 * Math.PI * R;

              return (
                <Card key={b._id} radius="lg" className="p-5 flex flex-col gap-4 min-w-0" style={{ opacity: b.isActive ? 1 : 0.7 }}>
                  <div className="flex items-start gap-3 min-w-0">
                    <svg width="64" height="64" viewBox="0 0 64 64" className="flex-none -rotate-90" role="img" aria-label={`${Math.round(pct)}% of ${b.category} budget used`}>
                      <circle cx="32" cy="32" r={R} fill="none" stroke="var(--line)" strokeWidth="6" />
                      <circle
                        cx="32" cy="32" r={R} fill="none" stroke={ringColor} strokeWidth="6" strokeLinecap="round"
                        strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)}
                        style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)" }}
                      />
                    </svg>
                    <div className="flex-1 min-w-0 pt-1">
                      <div className="capitalize truncate" style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>{b.category}</div>
                      <span
                        className="inline-block mt-1 rounded-full px-2.5 py-0.5"
                        style={{ font: "var(--text-micro)", color: b.isActive ? tone : "var(--ink-3)", background: `color-mix(in srgb, ${b.isActive ? tone : "var(--ink-3)"} 14%, transparent)` }}
                      >
                        {status}
                      </span>
                    </div>
                    <div className="flex items-center flex-none -mr-1.5">
                      <Button
                        type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full"
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
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label={`Delete ${b.category} budget`} onClick={() => requestDelete(b)}>
                        <Trash2 size={14} style={{ color: "var(--ink-3)" }} />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="tnum truncate" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: over ? "var(--red)" : "var(--ink)" }}>{formatCurrency(b.spent)}</div>
                      <div className="tnum mt-1" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>of {formatCurrency(b.effectiveLimit)}</div>
                    </div>
                    <div className="tnum text-right" style={{ font: "var(--text-micro)", color: over ? "var(--red)" : "var(--ink-3)" }}>
                      {over ? `${formatCurrency(b.spent - b.effectiveLimit)} over` : `${formatCurrency(b.effectiveLimit - b.spent)} left`}
                    </div>
                  </div>

                  {b.rollover && carried > 0 && (
                    <div className="tnum" style={{ font: "var(--text-micro)", color: "var(--green)" }}>
                      +{formatCurrency(carried)} carried over from last month
                    </div>
                  )}

                  {editing && (
                    <Card surface="card-2" radius="md" className="p-4 flex flex-col gap-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`budget-edit-limit-${b._id}`} style={labelStyle}>Limit</Label>
                          <Input id={`budget-edit-limit-${b._id}`} type="number" min="0" step="0.01" value={editLimit} onChange={(e) => setEditLimit(e.target.value)} className="h-11" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label style={labelStyle}>Alert at {editAlert}%</Label>
                          <input type="range" min={50} max={100} value={editAlert} onChange={(e) => setEditAlert(Number(e.target.value))} className="mt-3" style={{ accentColor: "var(--violet)" }} />
                        </div>
                      </div>
                      <div className="inset-group" style={{ background: "var(--card)" }}>
                        <label className="flex items-center justify-between gap-3 px-4 min-h-11" style={{ font: "var(--text-label)", color: "var(--ink)" }}>
                          Active
                          <Switch checked={editActive} onCheckedChange={setEditActive} />
                        </label>
                        <label className="flex items-center justify-between gap-3 px-4 min-h-11" style={{ font: "var(--text-label)", color: "var(--ink)" }}>
                          Roll over unspent
                          <Switch checked={editRollover} onCheckedChange={setEditRollover} />
                        </label>
                      </div>
                      <Button
                        onClick={() => updateBudget.mutate(b._id)}
                        disabled={updateBudget.isPending || !editLimit}
                        className="h-11 rounded-full font-semibold btn-interactive"
                      >
                        <Save size={14} />
                        Save changes
                      </Button>
                    </Card>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      <Dialog open={showAdd} onOpenChange={(o) => { if (!o) closeAdd(); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 gap-0 border-0 sm:max-w-lg" style={{ background: "var(--card)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)" }}>
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>New budget</DialogTitle>
            <DialogDescription style={{ color: "var(--ink-3)" }}>For {MONTHS[month - 1]} {year}.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5 px-6 pb-6 pt-3"
            onSubmit={(e) => { e.preventDefault(); if (!limitInvalid) createBudget.mutate(); }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="budget-category" style={labelStyle}>Category</Label>
                <Select value={addCategory} onValueChange={setAddCategory}>
                  <SelectTrigger id="budget-category" className="capitalize h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="budget-limit" style={labelStyle}>Monthly limit</Label>
                <Input
                  id="budget-limit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={addLimit}
                  onChange={e => setAddLimit(e.target.value)}
                  placeholder="e.g. 500"
                  autoFocus
                  className="h-11"
                />
                {addLimit !== "" && limitInvalid && <span style={{ font: "var(--text-micro)", color: "var(--red)" }}>Enter an amount above zero</span>}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="budget-alert" style={labelStyle}>Alert at {addAlert}%</Label>
              <input id="budget-alert" type="range" min={50} max={100} value={addAlert} onChange={e => setAddAlert(Number(e.target.value))} className="w-full" style={{ accentColor: "var(--violet)" }} />
            </div>
            <div className="inset-group" style={{ background: "var(--card-2)" }}>
              <label className="flex items-center justify-between gap-3 px-4 min-h-12" style={{ font: "var(--text-label)", color: "var(--ink)" }}>
                Roll over unspent to next month
                <Switch checked={addRollover} onCheckedChange={setAddRollover} />
              </label>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
              <Button type="button" variant="ghost" onClick={closeAdd} className="h-11 px-5 rounded-full font-semibold">Cancel</Button>
              <Button type="submit" disabled={createBudget.isPending || limitInvalid} className="h-11 px-6 rounded-full font-semibold btn-interactive">
                {createBudget.isPending ? "Saving..." : "Save budget"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}
