import { Schema, model, models } from "mongoose";

const PushSubscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

PushSubscriptionSchema.index({ user: 1 });

export default (
  models.PushSubscription ||
  model("PushSubscription", PushSubscriptionSchema, "pushSubscriptions")
);
