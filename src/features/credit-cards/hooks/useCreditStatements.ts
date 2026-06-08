"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { type ICreditStatement } from "@/types/models";

export interface StatementsResponse {
  data: ICreditStatement[];
  currentCycle: {
    balance: number;
    minPayment: number;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    label: string;
  } | null;
}

export function useCreditStatements(accountId: string) {
  return useQuery<StatementsResponse>({
    queryKey: ["credit-statements", accountId],
    queryFn: async () => {
      const res = await apiClient.get<StatementsResponse>(
        `/credit-cards/${accountId}/statements`
      );
      return res.data;
    },
    enabled: !!accountId,
  });
}

export function useMarkStatementPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      accountId,
      statementId,
      paidAmount,
      paidAt,
      paymentTransactionId,
    }: {
      accountId: string;
      statementId: string;
      paidAmount: number;
      paidAt?: string;
      paymentTransactionId?: string;
    }) =>
      apiClient.patch(
        `/credit-cards/${accountId}/statements/${statementId}`,
        { paidAmount, paidAt, paymentTransactionId }
      ),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ["credit-statements", vars.accountId] });
      void qc.invalidateQueries({ queryKey: ["credit-summary"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Payment recorded");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
