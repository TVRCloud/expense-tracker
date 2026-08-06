"use client";
import { useEffect, useState } from "react";
import { useProfile } from "@/features/settings/hooks/useProfile";
import {
  formatCurrency as _fmt,
  formatCurrencyCompact as _fmtCompact,
} from "@/lib/utils";

const KEY = "fos:currency";

function readLocal(): string {
  try { return localStorage.getItem(KEY) ?? "INR"; } catch { return "INR"; }
}

export function useCurrency() {
  const { data: profile } = useProfile();
  // Always render "INR" on server + first client pass to match hydration;
  // swap to real value (localStorage or profile) after mount.
  const [localCurrency, setLocalCurrency] = useState("INR");

  useEffect(() => {
    setLocalCurrency(readLocal());
  }, []);

  useEffect(() => {
    const c = profile?.preferences?.currency;
    if (c) { try { localStorage.setItem(KEY, c); } catch { /* ignore */ } }
  }, [profile?.preferences?.currency]);

  const currency = profile?.preferences?.currency ?? localCurrency;

  return {
    currency,
    formatCurrency: (cents: number) => _fmt(cents, currency),
    formatCurrencyCompact: (cents: number) => _fmtCompact(cents, currency),
  };
}
