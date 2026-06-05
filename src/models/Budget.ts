import { Schema, model, models } from "mongoose";

const BudgetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    limitAmount: { type: Number, required: true }, // cents
    currency: { type: String, default: "USD" },
    alertAt: { type: Number, default: 80 }, // percent threshold
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

BudgetSchema.index({ user: 1, year: 1, month: 1 });
BudgetSchema.index({ user: 1, category: 1, year: 1, month: 1 }, { unique: true });

export default models.Budget || model("Budget", BudgetSchema, "budgets");
