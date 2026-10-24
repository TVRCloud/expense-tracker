import { Schema, model, models } from "mongoose";

// One cached rate table per base currency, from the free open.er-api.com feed.
// `rates` maps a currency code to units of that currency per 1 unit of `base`.
// Rows are kept (not expired by a TTL index) so a provider outage can fall
// back to the last table; exchange-rate-service decides how old is too old.
const ExchangeRateSchema = new Schema(
  {
    base: { type: String, required: true, unique: true },
    rates: { type: Schema.Types.Mixed, required: true },
    rateDate: { type: Date, required: true }, // the provider's own update time
    fetchedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export default models.ExchangeRate || model("ExchangeRate", ExchangeRateSchema, "exchange_rates");
