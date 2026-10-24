import { Schema, model, models } from "mongoose";

// One cached rate table per base currency, from the free open.er-api.com feed.
// `rates` maps a currency code to units of that currency per 1 unit of `base`.
// Rows are kept (not expired by a TTL index) so a provider outage can fall
// back to the last table; exchange-rate-service decides how old is too old.
// `lastAttemptAt` is set when a refresh failed, so the next requests do not
// each wait on a provider that is down (a row may then exist with no table).
const ExchangeRateSchema = new Schema(
  {
    base: { type: String, required: true, unique: true },
    rates: { type: Schema.Types.Mixed, default: {} },
    rateDate: { type: Date }, // the provider's own update time
    fetchedAt: { type: Date },
    lastAttemptAt: { type: Date },
  },
  { timestamps: true }
);

export default models.ExchangeRate || model("ExchangeRate", ExchangeRateSchema, "exchange_rates");
