import { Schema, model, models } from "mongoose";

const NotificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["budget_alert", "loan_due", "goal_reached", "system", "transaction", "credit_due", "credit_overdue", "emi_due"],
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
// A weekly review is sent once per user per week: this makes "once" atomic when the timer and the cron route
// run at the same moment. Limited to weekly review rows, so older notification kinds are not touched.
NotificationSchema.index(
  { user: 1, "meta.dedupKey": 1 },
  { unique: true, partialFilterExpression: { "meta.kind": "weekly_review" } }
);
// TTL — auto-delete after 90 days
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export default models.Notification || model("Notification", NotificationSchema, "notifications");
