import { Schema, model, models } from "mongoose";

// What the user decided about a detected subscription. Detections themselves
// are never stored: they are worked out from transactions on every read
// (src/lib/subscription-detector.ts), so there is nothing to keep in sync.
// A row is written on the first confirm or dismiss and updated after that,
// including a return to "detected" (never deleted, so realtime sees the
// change). `key` is the detector's merchant key plus cadence.
const SubscriptionDecisionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, required: true },
    merchant: { type: String, required: true },
    status: { type: String, enum: ["detected", "confirmed", "dismissed"], required: true },
  },
  { timestamps: true }
);

SubscriptionDecisionSchema.index({ user: 1, key: 1 }, { unique: true });

export default models.SubscriptionDecision ||
  model("SubscriptionDecision", SubscriptionDecisionSchema, "subscription_decisions");
