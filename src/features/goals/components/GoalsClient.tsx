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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePickerField } from "@/components/shared/DatePickerField";
import { goalCreateSchema } from "@/features/goals/schemas/goal.schema";
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
      void qc.invalidateQueries({ queryKey: ["goals"] });
      if (form.roundUpEnabled) toast.success("Goal updated — round-up savings now go here (replaces any other goal's round-up)");
      else toast.success("Goal updated");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card surface="card-2" radius="md" className="mt-4 p-4 flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap">
        {GOAL_ICONS.map(icon => (
          <Button
            key={icon}
            type="button"
            variant="ghost"
            aria-label={`Use ${icon} icon`}
            aria-pressed={form.icon === icon}
            onClick={() => setForm(f => ({ ...f, icon }))}
            className="w-9 h-9 rounded-[10px] text-lg p-0"
            style={{ background: form.icon === icon ? "var(--violet)" : "var(--card)" }}
          >
            {icon}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5 col-span-2">
          <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Goal name</Label>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Target ($)</Label>
          <Input type="number" min="0" step="0.01" value={form.targetAmount} onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))} />
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
          className="h-auto rounded-(--r-sm) px-3 py-2 font-bold"
        >
          <Save size={14} />
          {updateGoal.isPending ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone} className="h-auto rounded-(--r-sm) px-3 py-2 font-bold">
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
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-44 rounded-(--r-lg)" />)}
        </div>
      ) : (goals ?? []).length === 0 && !showAdd ? (
        <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-16">
          <Target size={40} style={{ color: "var(--ink-3)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No savings goals yet</p>
          <Button onClick={() => setShowAdd(true)} className="h-auto text-sm px-4 py-2 rounded-full">
            Create goal
          </Button>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {(goals ?? []).map((g) => {
            const pct = g.targetAmount > 0 ? Math.min((g.savedAmount / g.targetAmount) * 100, 100) : 0;
            return (
              <Card
                key={String(g._id)}
                radius="lg"
                elevation="floating"
                className="p-5"
                style={{
                  background: g.isCompleted
                    ? "linear-gradient(135deg, #4FC07E15 0%, #4FC07E08 100%)"
                    : undefined,
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
                    {g.roundUpEnabled && !g.isCompleted && (
                      <span
                        className="text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full"
                        style={{ background: "color-mix(in srgb, var(--violet) 15%, transparent)", color: "var(--violet)" }}
                      >
                        Round-up
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Edit ${g.name} goal`}
                      onClick={() => setEditingId(editingId === String(g._id) ? null : String(g._id))}
                    >
                      <Pencil size={14} style={{ color: "var(--ink-3)" }} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Delete ${g.name} goal`}
                      onClick={() => requestDelete(g)}
                    >
                      <Trash2 size={14} style={{ color: "var(--ink-3)" }} />
                    </Button>
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
                <Progress value={pct} color={g.isCompleted ? "var(--green)" : "var(--violet)"} trackColor="var(--line)" height={10} />
                <div className="text-right text-[11px] font-semibold mt-1.5" style={{ color: "var(--ink-3)" }}>
                  {Math.round(pct)}%
                </div>

                {!g.isCompleted && editingId !== String(g._id) && (
                  <div className="flex gap-2 mt-4">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={progressInputs[String(g._id)] ?? ""}
                      onChange={(e) => setProgressInputs((current) => ({ ...current, [String(g._id)]: e.target.value }))}
                      placeholder="Add saved amount"
                      className="flex-1"
                    />
                    <Button
                      onClick={() => {
                        const amount = Math.round(parseFloat(progressInputs[String(g._id)] ?? "0") * 100);
                        if (amount > 0) updateProgress.mutate({ goal: g, amount });
                      }}
                      disabled={updateProgress.isPending || !progressInputs[String(g._id)]}
                      className="h-auto rounded-(--r-sm) px-3 py-2 font-bold"
                    >
                      <Save size={14} />
                      Add
                    </Button>
                  </div>
                )}

                {editingId === String(g._id) && (
                  <GoalEditPanel goal={g} onDone={() => setEditingId(null)} />
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Add goal form */}
      {showAdd && (
        <Card radius="lg" elevation="floating" className="p-5 flex flex-col gap-4">
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>New Goal</div>

          {/* Icon picker */}
          <div className="flex gap-2 flex-wrap">
            {GOAL_ICONS.map(icon => (
              <Button
                key={icon}
                type="button"
                variant="ghost"
                aria-label={`Use ${icon} icon`}
                aria-pressed={form.icon === icon}
                onClick={() => setForm(f => ({ ...f, icon }))}
                className="w-10 h-10 rounded-[10px] text-xl p-0"
                style={{
                  background: form.icon === icon ? "var(--violet)" : "var(--card-2)",
                }}
              >
                {icon}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Goal name</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Emergency fund"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Target ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.targetAmount}
                onChange={e => setForm(f => ({ ...f, targetAmount: e.target.value }))}
                placeholder="e.g. 5000"
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
            <Button
              onClick={() => createGoal.mutate()}
              disabled={createGoal.isPending || !form.name || !form.targetAmount}
              className="flex-1 h-auto py-2.5 rounded-(--r-sm) font-bold"
            >
              {createGoal.isPending ? "Saving..." : "Create Goal"}
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

      {!showAdd && (goals ?? []).length > 0 && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowAdd(true)}
          className="h-auto flex items-center justify-center gap-2 rounded-(--r-md) py-3.5 font-bold"
          style={{ color: "var(--violet)" }}
        >
          <Plus size={17} />
          Add Goal
        </Button>
      )}
      {dialog}
    </div>
  );
}
