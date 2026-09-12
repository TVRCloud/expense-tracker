import { Schema, model, models } from "mongoose";

const LoanSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    direction: { type: String, enum: ["given", "received"], required: true },
    counterparty: { type: String, required: true },
    principalAmount: { type: Number, required: true }, // cents
    remainingAmount: { type: Number, required: true }, // cents
    currency: { type: String, default: "INR" },
    interestRate: { type: Number },
    startDate: { type: Date, required: true },
    dueDate: { type: Date },
    description: { type: String },
    isSettled: { type: Boolean, default: false },
    settledAt: { type: Date },
    account: { type: Schema.Types.ObjectId, ref: "Account" },
    // The lender's own loan/account number (e.g. from a bank/NBFC EMI SMS —
    // "loan account 010021753351"). Optional, set by the user so incoming
    // EMI-payment SMS can be matched to this loan automatically instead of
    // falling into the SMS review queue. Not unique across users by design —
    // two different users could plausibly reference the same lender account
    // number in their own records — matching is always scoped by `user`.
    externalLoanId: { type: String, maxlength: 64, trim: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

LoanSchema.index({ user: 1, isDeleted: 1, isSettled: 1, createdAt: -1 });
LoanSchema.index({ user: 1, isDeleted: 1, direction: 1, createdAt: -1 });
LoanSchema.index({ user: 1, isDeleted: 1, dueDate: 1 });
LoanSchema.index({ user: 1, externalLoanId: 1 }, { sparse: true });

export default models.Loan || model("Loan", LoanSchema, "loans");
