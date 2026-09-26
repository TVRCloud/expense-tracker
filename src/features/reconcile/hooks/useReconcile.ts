"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";

// Shapes returned by src/lib/reconcile/inbox.ts.

export type SourceInfo = { label: string; priority: "primary" | "secondary" | "fallback" | "manual" };

export type CaptureView = {
  id: string;
  channel: "sms" | "notification" | "n8n";
  source: SourceInfo;
  sender: string | null;
  packageName: string | null;
  receivedAt: string;
  text: string | null;
  alsoSeenIn: string[];
  parsed: {
    kind: string;
    confidence: number;
    type: "income" | "expense" | null;
    amount: number | null;
    last4: string | null;
    merchant: string | null;
    ref: string | null;
    date: string | null;
  };
  outcome: string;
  reason: string | null;
  status: string;
  role: "primary" | "supporting";
  transactionId: string | null;
  duplicateOfId: string | null;
  createdAt: string;
};

export type TxnView = {
  id: string;
  accountId: string;
  accountName: string | null;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  category: string;
  description: string;
  date: string;
  source: string;
  sourceInfo: SourceInfo;
  reviewStatus: string | null;
  isDeleted: boolean;
};

export type InboxTxn = TxnView & { sourceCapture: CaptureView | null; alsoSeenIn: CaptureView[] };
export type InboxCapture = CaptureView & { relatedTransaction: TxnView | null };

export type Inbox = {
  counts: { needsReview: number; couldntMatch: number; waitingForSms: number };
  needsReview: InboxTxn[];
  couldntMatch: InboxCapture[];
};

type Snapshot = {
  amount: number;
  type: string;
  accountId: string | null;
  accountName: string | null;
  category: string;
  date: string;
  description?: string;
};

export type CorrectionView = {
  id: string;
  transactionId: string;
  capturedMessageId: string | null;
  before: Snapshot;
  after: Snapshot | null;
  changedFields: string[];
  reason: string;
  note: string | null;
  via: "web" | "mobile" | "system";
  balanceEffects: { accountId: string; delta: number }[];
  createdAt: string;
  transactionLabel?: string;
};

export type Provenance = {
  transaction: TxnView;
  sourceCaptureId: string | null;
  captures: CaptureView[];
  corrections: CorrectionView[];
};

export type CorrectionChanges = Partial<{
  amount: number;
  type: "income" | "expense";
  accountId: string;
  date: string;
  category: string;
  description: string;
}>;

export const CORRECTION_REASONS: { value: string; label: string }[] = [
  { value: "wrong_amount", label: "Wrong amount" },
  { value: "wrong_type", label: "Debit/credit flipped" },
  { value: "wrong_account", label: "Wrong account" },
  { value: "wrong_date", label: "Wrong date" },
  { value: "wrong_category", label: "Wrong category" },
  { value: "wrong_merchant", label: "Wrong merchant" },
  { value: "other", label: "Something else" },
];

export const REASON_LABEL: Record<string, string> = {
  ...Object.fromEntries(CORRECTION_REASONS.map((r) => [r.value, r.label])),
  duplicate: "Duplicate",
  not_a_transaction: "Not a transaction",
  sms_override: "Updated from SMS",
  kept_user_values: "Kept your values over SMS",
};

export const QUEUE_REASON_LABEL: Record<string, string> = {
  unparsed: "Couldn't read this message",
  low_confidence: "Not sure about the details",
  no_matching_account: "No account matches these digits",
  no_matching_loan: "No loan matches this EMI",
  possible_duplicate: "Might be a payment you already have",
  source_conflict: "SMS disagrees with your confirmed values",
  processing_error: "Something went wrong reading this. Add it by hand",
};

function invalidateAll(qc: ReturnType<typeof useQueryClient>, transactionId?: string) {
  void qc.invalidateQueries({ queryKey: ["reconcile"] });
  void qc.invalidateQueries({ queryKey: ["transactions"] });
  void qc.invalidateQueries({ queryKey: ["accounts"] });
  if (transactionId) void qc.invalidateQueries({ queryKey: ["provenance", transactionId] });
}

export function useReconcileInbox() {
  return useQuery<Inbox>({
    queryKey: ["reconcile", "inbox"],
    queryFn: async () => (await apiClient.get<{ data: Inbox }>("/reconcile")).data.data,
  });
}

export function useCorrectionHistory(enabled = true) {
  return useQuery<CorrectionView[]>({
    queryKey: ["reconcile", "history"],
    queryFn: async () => (await apiClient.get<{ data: CorrectionView[] }>("/reconcile/history")).data.data,
    enabled,
  });
}

export function useProvenance(transactionId: string, enabled = true) {
  return useQuery<Provenance>({
    queryKey: ["provenance", transactionId],
    queryFn: async () =>
      (await apiClient.get<{ data: Provenance }>(`/transactions/${transactionId}/corrections`)).data.data,
    enabled,
  });
}

export function useConfirmTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/transactions/${id}/confirm`),
    onSuccess: (_d, id) => {
      invalidateAll(qc, id);
      toast.success("Marked as correct");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useCorrectTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; changes: CorrectionChanges; reason: string; note?: string }) =>
      apiClient.post(`/transactions/${v.id}/corrections`, { changes: v.changes, reason: v.reason, note: v.note }),
    onSuccess: (_d, v) => {
      invalidateAll(qc, v.id);
      toast.success(v.reason === "duplicate" || v.reason === "not_a_transaction" ? "Removed and recorded" : "Correction saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export type ResolveInput =
  | {
      action: "create";
      accountId: string;
      type: "income" | "expense";
      amount: number;
      category: string;
      description?: string;
      date?: string;
      rememberDigits: boolean;
    }
  | { action: "link" }
  | { action: "keep_mine"; note?: string }
  | { action: "use_sms" };

export function useResolveCapture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: ResolveInput }) => apiClient.post(`/captures/${v.id}/resolve`, v.input),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Done");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDiscardCapture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/captures/${id}`),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Discarded");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
