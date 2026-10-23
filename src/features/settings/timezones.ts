import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/spend-limit-time";

// Zones offered in Settings. The same IANA check the server uses
// (isValidTimeZone), so a value picked here is never rejected by
// PATCH /api/me/preferences.
const FALLBACK = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
  "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago",
  "America/Denver", "America/Los_Angeles", "UTC",
];

export function timeZoneOptions(current?: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  const base = (all.length ? all : FALLBACK).filter(isValidTimeZone);
  const set = new Set([DEFAULT_TIME_ZONE, ...base]);
  // Keep a saved zone selectable even if this browser's list lacks it.
  if (current && isValidTimeZone(current)) set.add(current);
  return [...set].sort((a, b) => a.localeCompare(b));
}
