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
    // The daily and weekly amounts over time, oldest first, so a change applies
    // from the day it was made and earlier days keep the limit they had. Empty
    // for limits set before history existed: the current amounts then count
    // for every earlier day. The first entry written is a baseline at the epoch
    // holding what was in force before the change.
    limitHistory: {
      type: [
        new Schema(
          {
            from: { type: Date, required: true }, // start of a local day
            dailyAmount: { type: Number, min: 1 },
            weeklyAmount: { type: Number, min: 1 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export default models.SpendLimit || model("SpendLimit", SpendLimitSchema, "spend_limits");
