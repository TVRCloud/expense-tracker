import { Schema, model, models } from "mongoose";

// Money set aside for a known cost on a known date (insurance, tax, travel).
// Kept apart from Goal on purpose: a goal is open ended, a fund has a due date
// and a monthly set-aside, and adding the fields to Goal would change what the
// existing goals routes return. Amounts are in paise like everywhere else.
// `isCompleted` is derived (savedAmount >= targetAmount) and stored so the
// list can be filtered; progress and status are computed on read
// (src/lib/sinking-fund-service.ts), never stored.
const SinkingFundSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    targetAmount: { type: Number, required: true },
    savedAmount: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },
    dueDate: { type: Date, required: true },
    // What the person plans to put aside each month. Null means "use the
    // suggested amount" (what is still needed spread over the months left).
    monthlyAmount: { type: Number },
    icon: { type: String },
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

SinkingFundSchema.index({ user: 1, isDeleted: 1, dueDate: 1 });

export default models.SinkingFund || model("SinkingFund", SinkingFundSchema, "sinking_funds");
