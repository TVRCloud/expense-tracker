"use client";
import { useEffect } from "react";
import { useProfile } from "@/features/settings/hooks/useProfile";
import {
  formatCurrency as _fmt,
  formatCurrencyCompact as _fmtCompact,
} from "@/lib/utils";

const KEY = "fos:currency";

function readLocal(): string {
  if (typeof window === "undefined") return "USD";
  try { return localStorage.getItem(KEY) ?? "USD"; } catch { return "USD"; }
}

export function useCurrency() {
  const { data: profile } = useProfile();
  // Use profile data when available; localStorage fills the gap before it loads
  const currency = profile?.preferences?.currency ?? readLocal();

  useEffect(() => {
    const c = profile?.preferences?.currency;
    if (c) { try { localStorage.setItem(KEY, c); } catch { /* ignore */ } }
  }, [profile?.preferences?.currency]);

  return {
    currency,
    formatCurrency: (cents: number) => _fmt(cents, currency),
    formatCurrencyCompact: (cents: number) => _fmtCompact(cents, currency),
  };
}
