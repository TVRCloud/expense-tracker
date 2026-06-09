import { Schema, model, models } from "mongoose";

const LoanSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    direction: { type: String, enum: ["given", "received"], required: true },
    counterparty: { type: String, required: true },
    principalAmount: { type: Number, required: true }, // cents
    remainingAmount: { type: Number, required: true }, // cents
    currency: { type: String, default: "USD" },
    interestRate: { type: Number },
    startDate: { type: Date, required: true },
    dueDate: { type: Date },
    description: { type: String },
    isSettled: { type: Boolean, default: false },
    settledAt: { type: Date },
    account: { type: Schema.Types.ObjectId, ref: "Account" },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

LoanSchema.index({ user: 1, isDeleted: 1, isSettled: 1, createdAt: -1 });
LoanSchema.index({ user: 1, isDeleted: 1, direction: 1, createdAt: -1 });
LoanSchema.index({ user: 1, isDeleted: 1, dueDate: 1 });

export default models.Loan || model("Loan", LoanSchema, "loans");
