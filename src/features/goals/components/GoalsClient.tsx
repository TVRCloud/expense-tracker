"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Target, Save, Pencil } from "lucide-react";
import { format } from "date-fns";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { type IGoal } from "@/types/models";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Progress } from "@/components/_ui/Progress";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { Input } from "@/components/_ui/Input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/_ui/Switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePickerField } from "@/components/shared/DatePickerField";
import { goalCreateSchema } from "@/features/goals/schemas/goal.schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "sonner";
import { invalidateForResource } from "@/lib/realtime/invalidation";

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

interface GoalEditForm {
  name: string;
  targetAmount: string;
  targetDate?: Date;
  icon: string;
  roundUpEnabled: boolean;
  roundUpTo: string;
}

const ROUND_UP_OPTIONS = [
  { value: "100", label: "Nearest $1" },
  { value: "500", label: "Nearest $5" },
  { value: "1000", label: "Nearest $10" },
];

function GoalEditPanel({ goal, onDone }: { goal: IGoal; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<GoalEditForm>({
    name: goal.name,
    targetAmount: (goal.targetAmount / 100).toString(),
    targetDate: goal.targetDate ? new Date(goal.targetDate) : undefined,
    icon: goal.icon ?? "🎯",
    roundUpEnabled: goal.roundUpEnabled ?? false,
    roundUpTo: String(goal.roundUpTo ?? 100),
  });

  const updateGoal = useMutation({
    mutationFn: () => apiClient.patch(`/goals/${goal._id}`, {
      name: form.name,
      targetAmount: Math.round(parseFloat(form.targetAmount) * 100),
      targetDate: form.targetDate?.toISOString(),
      icon: form.icon,
      roundUpEnabled: form.roundUpEnabled,
      roundUpTo: Number(form.roundUpTo),
    }),
    onSuccess: () => {
      invalidateForResource(qc, "goals");
      if (form.roundUpEnabled) toast.success("Goal updated — round-up savings now go here (replaces any other goal's round-up)");
      else toast.success("Goal updated");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card surface="card-2" radius="md" className="p-4 flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap">
        {GOAL_ICONS.map(icon => (
          <Button
            key={icon}
            type="button"
            variant="ghost"
            aria-label={`Use ${icon} icon`}
            aria-pressed={form.icon === icon}
            onClick={() => setForm(f => ({ ...f, icon }))}
            className="w-10 h-10 rounded-[11px] text-lg p-0"
            style={{ background: "var(--card)", boxShadow: form.icon === icon ? "inset 0 0 0 2px var(--ink)" : undefined }}
          >
            {icon}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label htmlFor="goals-client-goal-name-1" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Goal name</Label>
          <Input id="goals-client-goal-name-1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goals-client-target-amount-2" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Target amount</Label>
          <Input id="goals-client-target-amount-2" type="number" min="0" step="0.01" value={form.targetAmount} onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))} />
        </div>
        <DatePickerField
          label="Target date"
          value={form.targetDate}
          onChange={(targetDate) => setForm((f) => ({ ...f, targetDate }))}
          clearable
        />
      </div>

      <div className="flex flex-col gap-2 rounded-(--r-sm) p-3" style={{ background: "var(--card)" }}>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>Round-up savings</span>
          <Switch checked={form.roundUpEnabled} onCheckedChange={(v) => setForm((f) => ({ ...f, roundUpEnabled: v }))} />
        </label>
        {form.roundUpEnabled && (
          <>
            <p className="text-xs leading-relaxed" style={{ color: "var(--ink-3)" }}>
              Every expense rounds up and the spare change lands here. Only one goal can have this on at a time.
            </p>
            <Select value={form.roundUpTo} onValueChange={(v) => setForm((f) => ({ ...f, roundUpTo: v }))}>
              <SelectTrigger className="h-9 text-sm w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUND_UP_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          onClick={() => updateGoal.mutate()}
          disabled={updateGoal.isPending || !form.name || !form.targetAmount}
          className="h-11 rounded-full px-5 font-semibold btn-interactive"
        >
          <Save size={14} />
          {updateGoal.isPending ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} className="h-11 rounded-full px-5 font-semibold">
          Cancel
        </Button>
      </div>
    </Card>
  );
}

export function GoalsClient() {
  const { formatCurrency } = useCurrency();
  const qc = useQueryClient();
  const { data: goals, isLoading } = useGoals();
  const { confirm, dialog } = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<GoalForm>(emptyGoalForm);
  const [progressInputs, setProgressInputs] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const createGoal = useMutation({
    mutationFn: () => {
      // Same zod schema the server validates with — one shared source of truth.
      const parsed = goalCreateSchema.safeParse({
        name: form.name,
        targetAmount: Math.round(parseFloat(form.targetAmount) * 100),
        targetDate: form.targetDate?.toISOString(),
        icon: form.icon,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid goal");
      }
      return apiClient.post("/goals", parsed.data);
    },
    onSuccess: () => {
      invalidateForResource(qc, "goals");
      setShowAdd(false);
      setForm(emptyGoalForm);
      toast.success("Goal created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteGoal = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/goals/${id}`),
    onSuccess: () => {
      invalidateForResource(qc, "goals");
      toast.success("Goal deleted");
    },
  });

  const requestDelete = async (g: IGoal) => {
    const ok = await confirm({
      title: `Delete "${g.name}"?`,
      description: "This can't be undone. Progress saved toward this goal will be lost.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) deleteGoal.mutate(String(g._id));
  };

  const updateProgress = useMutation({
    mutationFn: ({ goal, amount }: { goal: IGoal; amount: number }) =>
      apiClient.patch(`/goals/${goal._id}`, {
        savedAmount: Math.min(goal.targetAmount, goal.savedAmount + amount),
      }),
    onSuccess: () => {
      invalidateForResource(qc, "goals");
      setProgressInputs({});
      toast.success("Goal progress updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const goalList = goals ?? [];
  const totalSaved = goalList.reduce((n, g) => n + g.savedAmount, 0);
  const totalTarget = goalList.reduce((n, g) => n + g.targetAmount, 0);
  const doneCount = goalList.filter((g) => g.isCompleted).length;
  const overallPct = totalTarget > 0 ? Math.min((totalSaved / totalTarget) * 100, 100) : 0;
  const nameMissing = form.name.trim() === "";
  const amountInvalid = !form.targetAmount || !(parseFloat(form.targetAmount) > 0);
  const closeAdd = () => { setShowAdd(false); setForm(emptyGoalForm); };
  const labelStyle = { font: "var(--text-label)", color: "var(--ink-2)" } as const;

  return (
    <div className="page-stack">
      <PageHeader
        title="Goals"
        subtitle="Save toward the things that matter."
        actions={
          <Button type="button" onClick={() => setShowAdd(true)} className="h-11 px-5 rounded-full font-semibold btn-interactive">
            <Plus size={16} />
            New goal
          </Button>
        }
      />

      {!isLoading && goalList.length > 0 && (
        <Card radius="lg" className="p-5 sm:p-6 flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
            <div className="min-w-0">
              <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Total saved</div>
              <div className="tnum truncate mt-1" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: "var(--green)" }}>{formatCurrency(totalSaved)}</div>
            </div>
            <div className="min-w-0">
              <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Across targets</div>
              <div className="tnum truncate mt-1" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: "var(--ink)" }}>{formatCurrency(totalTarget)}</div>
            </div>
            <div className="min-w-0 col-span-2 sm:col-span-1">
              <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Completed</div>
              <div className="tnum mt-1" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: "var(--ink)" }}>{doneCount} of {goalList.length}</div>
            </div>
          </div>
          <Progress value={overallPct} color="var(--green)" trackColor="var(--line)" height={6} aria-label="Overall savings progress" />
        </Card>
      )}

      {isLoading ? (
        <div className="grid-cards" style={{ "--card-min": "320px" } as React.CSSProperties}>
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-52 rounded-(--r-lg)" />)}
        </div>
      ) : goalList.length === 0 ? (
        <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-20 text-center px-6">
          <div className="w-14 h-14 rounded-2xl grid place-items-center" style={{ background: "var(--card-2)" }}>
            <Target size={26} style={{ color: "var(--ink-2)" }} />
          </div>
          <p style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>No savings goals yet</p>
          <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Pick a target and watch it fill up.</p>
          <Button onClick={() => setShowAdd(true)} className="h-11 px-5 rounded-full font-semibold btn-interactive">Create goal</Button>
        </Card>
      ) : (
        <div className="grid-cards" style={{ "--card-min": "320px" } as React.CSSProperties}>
          {goalList.map((g) => {
            const pct = g.targetAmount > 0 ? Math.min((g.savedAmount / g.targetAmount) * 100, 100) : 0;
            const remaining = Math.max(0, g.targetAmount - g.savedAmount);
            const daysLeft = g.targetDate ? Math.ceil((new Date(g.targetDate).getTime() - Date.now()) / 86400000) : null;
            const id = String(g._id);
            return (
              <Card
                key={id}
                radius="lg"
                className="p-5 flex flex-col gap-4 min-w-0"
                style={{ boxShadow: g.isCompleted ? "inset 0 0 0 1.5px var(--green), var(--shadow-sm)" : undefined }}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-[14px] grid place-items-center text-2xl flex-none" style={{ background: "var(--card-2)" }}>
                    {g.icon ?? "🎯"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate" style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>{g.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 flex-wrap" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
                      {g.targetDate ? <span>By {format(new Date(g.targetDate), "d MMM yyyy")}</span> : <span>No deadline</span>}
                      {g.isCompleted && (
                        <span className="rounded-full px-2 py-0.5" style={{ background: "color-mix(in srgb, var(--green) 15%, transparent)", color: "var(--green)" }}>Done</span>
                      )}
                      {g.roundUpEnabled && !g.isCompleted && (
                        <span className="rounded-full px-2 py-0.5" style={{ background: "var(--card-2)", color: "var(--ink-2)" }}>Round-up</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center flex-none -mr-1.5">
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label={`Edit ${g.name} goal`} onClick={() => setEditingId(editingId === id ? null : id)}>
                      <Pencil size={14} style={{ color: "var(--ink-3)" }} />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label={`Delete ${g.name} goal`} onClick={() => requestDelete(g)}>
                      <Trash2 size={14} style={{ color: "var(--ink-3)" }} />
                    </Button>
                  </div>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="tnum truncate" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: g.isCompleted ? "var(--green)" : "var(--ink)" }}>
                      {formatCurrency(g.savedAmount)}
                    </div>
                    <div className="tnum mt-1" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>of {formatCurrency(g.targetAmount)}</div>
                  </div>
                  <div className="tnum" style={{ font: "var(--text-figure-sm)", color: "var(--ink-2)" }}>{Math.round(pct)}%</div>
                </div>

                <div>
                  <Progress value={pct} color={g.isCompleted ? "var(--green)" : "var(--violet)"} trackColor="var(--line)" height={8} aria-label={`${g.name} progress`} />
                  {!g.isCompleted && (
                    <div className="flex justify-between mt-2 tnum" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
                      <span>{formatCurrency(remaining)} to go</span>
                      {daysLeft !== null && <span>{daysLeft > 0 ? `${daysLeft} days left` : daysLeft === 0 ? "Due today" : "Past due"}</span>}
                    </div>
                  )}
                </div>

                {!g.isCompleted && editingId !== id && (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={progressInputs[id] ?? ""}
                      onChange={(e) => setProgressInputs((current) => ({ ...current, [id]: e.target.value }))}
                      placeholder="Add saved amount"
                      aria-label={`Add saved amount to ${g.name}`}
                      className="flex-1 h-11"
                    />
                    <Button
                      onClick={() => {
                        const amount = Math.round(parseFloat(progressInputs[id] ?? "0") * 100);
                        if (amount > 0) updateProgress.mutate({ goal: g, amount });
                      }}
                      disabled={updateProgress.isPending || !progressInputs[id]}
                      className="h-11 rounded-full px-5 font-semibold btn-interactive"
                    >
                      Add
                    </Button>
                  </div>
                )}

                {editingId === id && <GoalEditPanel goal={g} onDone={() => setEditingId(null)} />}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={(o) => { if (!o) closeAdd(); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 gap-0 border-0 sm:max-w-lg" style={{ background: "var(--card)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)" }}>
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>New goal</DialogTitle>
            <DialogDescription style={{ color: "var(--ink-3)" }}>Choose an icon, name it and set a target.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5 px-6 pb-6 pt-3"
            onSubmit={(e) => { e.preventDefault(); if (!nameMissing && !amountInvalid) createGoal.mutate(); }}
          >
            <div className="flex gap-2 flex-wrap">
              {GOAL_ICONS.map(icon => (
                <Button
                  key={icon}
                  type="button"
                  variant="ghost"
                  aria-label={`Use ${icon} icon`}
                  aria-pressed={form.icon === icon}
                  onClick={() => setForm(f => ({ ...f, icon }))}
                  className="w-11 h-11 rounded-[12px] text-xl p-0 active:scale-[0.96] transition"
                  style={{
                    background: "var(--card-2)",
                    boxShadow: form.icon === icon ? "inset 0 0 0 2px var(--ink)" : undefined,
                  }}
                >
                  {icon}
                </Button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="goals-client-goal-name-3" style={labelStyle}>Goal name</Label>
              <Input id="goals-client-goal-name-3"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Emergency fund"
                autoFocus
                className="h-11"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="goals-client-target-amount-4" style={labelStyle}>Target amount</Label>
                <Input id="goals-client-target-amount-4"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.targetAmount}
                  onChange={e => setForm(f => ({ ...f, targetAmount: e.target.value }))}
                  placeholder="e.g. 5000"
                  className="h-11"
                />
                {form.targetAmount !== "" && amountInvalid && <span style={{ font: "var(--text-micro)", color: "var(--red)" }}>Enter an amount above zero</span>}
              </div>
              <DatePickerField
                label="Target date (optional)"
                value={form.targetDate}
                onChange={(targetDate) => setForm(f => ({ ...f, targetDate }))}
                clearable
              />
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
              <Button type="button" variant="ghost" onClick={closeAdd} className="h-11 px-5 rounded-full font-semibold">Cancel</Button>
              <Button type="submit" disabled={createGoal.isPending || nameMissing || amountInvalid} className="h-11 px-6 rounded-full font-semibold btn-interactive">
                {createGoal.isPending ? "Saving..." : "Create goal"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}
