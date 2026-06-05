import { Schema, model, models } from "mongoose";

const NotificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["budget_alert", "loan_due", "goal_reached", "system", "transaction"],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    meta: { type: Schema.Types.Mixed },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
  },
  { timestamps: true }
);

NotificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, type: 1 });
// TTL — auto-delete after 90 days
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export default models.Notification || model("Notification", NotificationSchema, "notifications");
