import { Schema, model, models } from "mongoose";

const GoalSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    targetAmount: { type: Number, required: true }, // cents
    savedAmount: { type: Number, default: 0 }, // cents
    currency: { type: String, default: "USD" },
    targetDate: { type: Date },
    category: { type: String },
    icon: { type: String },
    color: { type: String },
    linkedAccount: { type: Schema.Types.ObjectId, ref: "Account" },
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

GoalSchema.index({ user: 1, isCompleted: 1 });
GoalSchema.index({ user: 1, targetDate: 1 });

export default models.Goal || model("Goal", GoalSchema, "goals");
