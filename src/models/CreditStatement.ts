import { Schema, model, models } from "mongoose";

const CreditStatementSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    account: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["open", "closed", "paid", "overdue"],
      default: "open",
    },
    isPaid: { type: Boolean, default: false },
    paidAmount: { type: Number, default: 0 }, // cents
    paidAt: { type: Date },
    paymentTransactionId: { type: Schema.Types.ObjectId, ref: "Transaction" },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

CreditStatementSchema.index({ user: 1, isDeleted: 1, account: 1, periodStart: -1 });
CreditStatementSchema.index({ user: 1, isDeleted: 1, status: 1 });
CreditStatementSchema.index({ account: 1, periodStart: 1 }, { unique: true });
CreditStatementSchema.index({ user: 1, isDeleted: 1, account: 1, status: 1, dueDate: 1 });
CreditStatementSchema.index({ dueDate: 1 });

export default models.CreditStatement ||
  model("CreditStatement", CreditStatementSchema, "credit_statements");
