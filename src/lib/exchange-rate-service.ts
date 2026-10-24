import { z } from "zod";
import connectDB from "@/lib/mongodb";
import ExchangeRate from "@/models/ExchangeRate";
import logger from "@/lib/logger";
import { isSupportedCurrency, MAX_RATE, MIN_RATE, normalizeRate, SUPPORTED_CURRENCIES } from "@/lib/currency";

// Exchange rates from open.er-api.com (free, no key, about 160 currencies,
// refreshed daily; the provider asks for attribution, see docs/api-contracts.md).
// One table per base currency is cached in Mongo. A table younger than
// REFRESH_AFTER_MS is used as is; an older one is refreshed, and if the
// provider is down the old table still serves for up to MAX_STALE_MS. Past
// that the caller must send its own rate.

const PROVIDER_URL = "https://open.er-api.com/v6/latest";
const FETCH_TIMEOUT_MS = 5000;
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_STALE_MS = 30 * 24 * 60 * 60 * 1000;

export class RateUnavailableError extends Error {
  constructor(from: string, base: string) {
    super(`No exchange rate for ${from} to ${base} right now. Send "rate" yourself or try again later.`);
    this.name = "RateUnavailableError";
  }
}

const providerSchema = z.object({
  result: z.literal("success"),
  base_code: z.string(),
  time_last_update_unix: z.number(),
  rates: z.record(z.string(), z.number()),
});

export type RateTable = {
  base: string;
  /** Units of the code per 1 unit of `base`, supported currencies only. */
  rates: Record<string, number>;
  rateDate: Date;
  stale: boolean;
};

const inflight = new Map<string, Promise<RateTable | null>>();

async function fetchFromProvider(base: string): Promise<{ rates: Record<string, number>; rateDate: Date }> {
  const res = await fetch(`${PROVIDER_URL}/${base}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`rate provider answered ${res.status}`);
  const parsed = providerSchema.parse(await res.json());
  if (parsed.base_code !== base) throw new Error("rate provider answered for another base");
  const rates: Record<string, number> = {};
  for (const code of SUPPORTED_CURRENCIES) {
    const value = parsed.rates[code];
    if (typeof value === "number" && Number.isFinite(value) && value >= MIN_RATE && value <= MAX_RATE) {
      rates[code] = value;
    }
  }
  if (!rates[base]) rates[base] = 1;
  return { rates, rateDate: new Date(parsed.time_last_update_unix * 1000) };
}

async function loadTable(base: string): Promise<RateTable | null> {
  await connectDB();
  const cached = await ExchangeRate.findOne({ base }).lean<{
    rates: Record<string, number>;
    rateDate: Date;
    fetchedAt: Date;
  } | null>();
  const now = Date.now();
  const age = cached ? now - new Date(cached.fetchedAt).getTime() : Infinity;
  if (cached && age < REFRESH_AFTER_MS) {
    return { base, rates: cached.rates, rateDate: cached.rateDate, stale: false };
  }
  try {
    const fresh = await fetchFromProvider(base);
    // A failed save (say two servers upserting the first row at once) must not
    // throw away the table just fetched.
    await ExchangeRate.findOneAndUpdate(
      { base },
      { $set: { rates: fresh.rates, rateDate: fresh.rateDate, fetchedAt: new Date() } },
      { upsert: true }
    ).catch((err) => logger.warn({ err, base }, "exchange rate cache write failed"));
    return { base, rates: fresh.rates, rateDate: fresh.rateDate, stale: false };
  } catch (err) {
    logger.warn({ err, base }, "exchange rate refresh failed");
    if (cached && age <= MAX_STALE_MS) {
      return { base, rates: cached.rates, rateDate: cached.rateDate, stale: true };
    }
    return null;
  }
}

/** The rate table for a base currency, or null when none is usable. Shares one fetch between concurrent callers. */
export function getRateTable(base: string): Promise<RateTable | null> {
  if (!isSupportedCurrency(base)) return Promise.resolve(null);
  const running = inflight.get(base);
  if (running) return running;
  const p = loadTable(base).finally(() => inflight.delete(base));
  inflight.set(base, p);
  return p;
}

export type ResolvedRate = { rate: number; rateDate: Date; stale: boolean; supplied: boolean };

/**
 * Base units per 1 unit of `from`. A client-supplied `override` always wins
 * and never touches the provider.
 */
export async function getRate(from: string, base: string, override?: number): Promise<ResolvedRate> {
  if (override !== undefined) {
    return { rate: normalizeRate(override), rateDate: new Date(), stale: false, supplied: true };
  }
  const table = await getRateTable(base);
  const perBase = table?.rates[from];
  if (!table || !perBase || perBase <= 0) throw new RateUnavailableError(from, base);
  return { rate: normalizeRate(1 / perBase), rateDate: table.rateDate, stale: table.stale, supplied: false };
}

export async function listRates(base: string) {
  const table = await getRateTable(base);
  if (!table) return { rates: {} as Record<string, number>, rateDate: null as Date | null, stale: false };
  const rates: Record<string, number> = {};
  for (const [code, perBase] of Object.entries(table.rates)) {
    if (code !== base && perBase > 0) {
      try {
        rates[code] = normalizeRate(1 / perBase);
      } catch {
        // skip a rate the provider reports out of range
      }
    }
  }
  return { rates, rateDate: table.rateDate, stale: table.stale };
}
