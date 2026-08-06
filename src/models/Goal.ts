import { Schema, model, models } from "mongoose";

const GoalSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    targetAmount: { type: Number, required: true }, // cents
    savedAmount: { type: Number, default: 0 }, // cents
    currency: { type: String, default: "INR" },
    targetDate: { type: Date },
    category: { type: String },
    icon: { type: String },
    color: { type: String },
    linkedAccount: { type: Schema.Types.ObjectId, ref: "Account" },
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

GoalSchema.index({ user: 1, isDeleted: 1, isCompleted: 1, createdAt: -1 });
GoalSchema.index({ user: 1, isDeleted: 1, targetDate: 1 });

export default models.Goal || model("Goal", GoalSchema, "goals");
