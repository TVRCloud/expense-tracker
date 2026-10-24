import { z } from "zod";
import connectDB from "@/lib/mongodb";
import ExchangeRate from "@/models/ExchangeRate";
import logger from "@/lib/logger";
import { CurrencyError, isSupportedCurrency, MAX_RATE, MIN_RATE, normalizeRate, SUPPORTED_CURRENCIES } from "@/lib/currency";

// Exchange rates from open.er-api.com (free, no key, about 160 currencies,
// refreshed daily; the provider asks for attribution, see docs/api-contracts.md).
// One table per base currency is cached in Mongo. A table younger than
// REFRESH_AFTER_MS is used as is; an older one is refreshed, and if the
// provider is down the old table still serves for up to MAX_STALE_MS. Past
// that the caller must send its own rate. After a failed refresh nobody tries
// again for RETRY_AFTER_FAILURE_MS, so a dead provider costs one 5 second wait
// per ten minutes, not one per request.

const PROVIDER_URL = "https://open.er-api.com/v6/latest";
const FETCH_TIMEOUT_MS = 5000;
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
// A client-supplied rate may differ from the provider's by this much.
export const CLIENT_RATE_BAND = 0.2;

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

type CachedRow = {
  rates?: Record<string, number>;
  rateDate?: Date;
  fetchedAt?: Date;
  lastAttemptAt?: Date;
};

async function loadTable(base: string): Promise<RateTable | null> {
  await connectDB();
  const cached = await ExchangeRate.findOne({ base }).lean<CachedRow | null>();
  const now = Date.now();
  const hasTable = Boolean(cached?.fetchedAt && cached.rates && cached.rateDate);
  const age = hasTable ? now - new Date(cached!.fetchedAt!).getTime() : Infinity;
  const staleTable = (): RateTable | null =>
    hasTable && age <= MAX_STALE_MS
      ? { base, rates: cached!.rates!, rateDate: cached!.rateDate!, stale: true }
      : null;

  if (hasTable && age < REFRESH_AFTER_MS) {
    return { base, rates: cached!.rates!, rateDate: cached!.rateDate!, stale: false };
  }
  // A refresh failed a moment ago: do not wait on the provider again yet.
  if (cached?.lastAttemptAt && now - new Date(cached.lastAttemptAt).getTime() < RETRY_AFTER_FAILURE_MS) {
    return staleTable();
  }
  try {
    const fresh = await fetchFromProvider(base);
    // A failed save (say two servers upserting the first row at once) must not
    // throw away the table just fetched.
    await ExchangeRate.findOneAndUpdate(
      { base },
      {
        $set: { rates: fresh.rates, rateDate: fresh.rateDate, fetchedAt: new Date() },
        $unset: { lastAttemptAt: 1 },
      },
      { upsert: true }
    ).catch((err) => logger.warn({ err, base }, "exchange rate cache write failed"));
    return { base, rates: fresh.rates, rateDate: fresh.rateDate, stale: false };
  } catch (err) {
    logger.warn({ err, base }, "exchange rate refresh failed");
    await ExchangeRate.updateOne({ base }, { $set: { lastAttemptAt: new Date() } }, { upsert: true }).catch((e) =>
      logger.warn({ err: e, base }, "exchange rate attempt marker failed")
    );
    return staleTable();
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

export type ResolvedRate = {
  rate: number;
  /** When the provider published it; null for a client-supplied rate. */
  rateDate: Date | null;
  stale: boolean;
  source: "provider" | "client";
};

/**
 * Base units per 1 unit of `from`. A client-supplied `override` is kept only
 * if it is within CLIENT_RATE_BAND of the provider's rate when one is known;
 * with no rate known at all it is accepted as the only information there is.
 */
export async function getRate(from: string, base: string, override?: number): Promise<ResolvedRate> {
  const table = await getRateTable(base);
  const perBase = table?.rates[from];
  const providerRate = table && perBase && perBase > 0 ? normalizeRate(1 / perBase) : null;

  if (override !== undefined) {
    const rate = normalizeRate(override);
    if (providerRate !== null && Math.abs(rate / providerRate - 1) > CLIENT_RATE_BAND) {
      throw new CurrencyError(
        "INVALID_RATE",
        `rate is more than ${CLIENT_RATE_BAND * 100}% away from today's rate (${providerRate}); check it`
      );
    }
    return { rate, rateDate: null, stale: false, source: "client" };
  }
  if (!table || providerRate === null) throw new RateUnavailableError(from, base);
  return { rate: providerRate, rateDate: table.rateDate, stale: table.stale, source: "provider" };
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
