import { Schema, model, models } from "mongoose";

const TransactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    account: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    type: { type: String, enum: ["income", "expense", "transfer"], required: true },
    amount: { type: Number, required: true }, // cents, always positive
    currency: { type: String, default: "USD" },
    category: { type: String, required: true },
    subcategory: { type: String },
    description: { type: String },
    note: { type: String },
    date: { type: Date, required: true },
    tags: [{ type: String }],
    attachments: [{ type: String }],
    transferTo: { type: Schema.Types.ObjectId, ref: "Account" },
    isRecurring: { type: Boolean, default: false },
    recurringId: { type: Schema.Types.ObjectId },
    recurrenceFrequency: { type: String, enum: ["daily", "weekly", "monthly", "yearly"] },
    recurrenceInterval: { type: Number, default: 1 },
    recurrenceCount: { type: Number },
    recurrenceEndDate: { type: Date },
    recurrenceLabel: { type: String },
    installmentIndex: { type: Number },
    installmentStatus: {
      type: String,
      enum: ["upcoming", "paid", "overdue", "skipped"],
      default: "upcoming",
    },
    paidAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

TransactionSchema.index({ user: 1, isDeleted: 1, date: -1 });
TransactionSchema.index({ user: 1, isDeleted: 1, account: 1, date: -1 });
TransactionSchema.index({ user: 1, isDeleted: 1, type: 1, date: -1 });
TransactionSchema.index({ user: 1, isDeleted: 1, category: 1, date: -1 });
TransactionSchema.index({ description: "text", note: "text" });
TransactionSchema.index({ user: 1, isDeleted: 1, recurringId: 1, installmentIndex: 1 });
TransactionSchema.index({ user: 1, isDeleted: 1, recurringId: 1, date: 1 });
TransactionSchema.index({ user: 1, isDeleted: 1, isRecurring: 1, installmentStatus: 1, date: 1 });
TransactionSchema.index({ user: 1, tags: 1 });

export default models.Transaction || model("Transaction", TransactionSchema, "transactions");
