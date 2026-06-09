import { Schema, model, models } from "mongoose";

const SecurityRateLimitSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

SecurityRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default models.SecurityRateLimit ||
  model("SecurityRateLimit", SecurityRateLimitSchema, "security_rate_limits");
