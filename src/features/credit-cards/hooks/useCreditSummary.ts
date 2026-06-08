"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";

export interface CardSummary {
  accountId: string;
  name: string;
  balance: number;
  creditLimit: number;
  utilization: number;
  nextDueDate: string | null;
  daysUntilDue: number | null;
  isOverdue: boolean;
  status: string;
  network?: string;
  lastFourDigits?: string;
}

export interface CreditSummaryResponse {
  totalDebt: number;
  cards: CardSummary[];
}

export function useCreditSummary() {
  return useQuery<CreditSummaryResponse>({
    queryKey: ["credit-summary"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: CreditSummaryResponse }>("/credit-cards/summary");
      return res.data.data;
    },
  });
}
