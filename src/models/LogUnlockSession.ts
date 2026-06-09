import { Schema, model, models } from "mongoose";

const LogUnlockSessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sessionJti: { type: String, required: true },
    deviceHash: { type: String, required: true },
    userAgentHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

LogUnlockSessionSchema.index({ user: 1, sessionJti: 1 }, { unique: true });
LogUnlockSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default models.LogUnlockSession ||
  model("LogUnlockSession", LogUnlockSessionSchema, "log_unlock_sessions");
