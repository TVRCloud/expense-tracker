import { Schema, model, models } from "mongoose";

// One document per user: the daily and weekly spend limits shown as "left
// today". Separate from Budget on purpose: budgets are one row per category
// and month, so adding day or week rows there would change what the budgets
// list returns to installed apps.
const SpendLimitSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    dailyAmount: { type: Number, min: 1 }, // cents, unset = no daily limit
    weeklyAmount: { type: Number, min: 1 }, // cents, unset = no weekly limit
    alertAt: { type: Number, default: 80, min: 1, max: 100 }, // percent
    // Categories that never count against the limit (rent, EMI, ...).
    excludeCategories: [{ type: String }],
    // Off: each day starts clean. On: yesterday's unspent or overspend moves today's limit.
    rollover: { type: Boolean, default: false },
    // Limit is suspended until this moment (trip, festival).
    pausedUntil: { type: Date },
  },
  { timestamps: true }
);

export default models.SpendLimit || model("SpendLimit", SpendLimitSchema, "spend_limits");
