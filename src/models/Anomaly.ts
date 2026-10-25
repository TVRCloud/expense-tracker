import { Schema, model, models } from "mongoose";

// An unusual spend found by src/lib/anomaly-service.ts: an unusually large
// expense, a charge repeated within minutes, or a category far above its
// usual month. Alerts are worked out when a transaction is created and kept
// here so the person can answer them ("this was me", "report", "dismiss").
const AnomalySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["large_spend", "duplicate_charge", "category_jump"], required: true },
    // The expense the alert is about (not set for a category jump).
    transaction: { type: Schema.Types.ObjectId, ref: "Transaction" },
    category: { type: String, required: true },
    // Minor units of the base currency: the expense, or the month to date for a category jump.
    amount: { type: Number, required: true },
    // What the rule compared against: typical amount, other transaction, baseline, month.
    data: { type: Schema.Types.Mixed },
    status: { type: String, enum: ["open", "dismissed", "confirmed_mine", "reported"], default: "open" },
    // One alert per cause: `large:<txn>`, `dup:<txnA>:<txnB>` (the two ids, sorted), `jump:<category>:<yyyy-mm>`.
    dedupKey: { type: String, required: true },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

AnomalySchema.index({ user: 1, dedupKey: 1 }, { unique: true });
AnomalySchema.index({ user: 1, status: 1, createdAt: -1 });
AnomalySchema.index({ user: 1, transaction: 1 }, { sparse: true });
// Old alerts go after a year.
AnomalySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });

export default models.Anomaly || model("Anomaly", AnomalySchema, "anomalies");
