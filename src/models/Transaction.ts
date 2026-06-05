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
  },
  { timestamps: true }
);

TransactionSchema.index({ user: 1, date: -1 });
TransactionSchema.index({ user: 1, account: 1, date: -1 });
TransactionSchema.index({ user: 1, type: 1, date: -1 });
TransactionSchema.index({ user: 1, category: 1, date: -1 });
TransactionSchema.index({ description: "text", note: "text" });

export default models.Transaction || model("Transaction", TransactionSchema, "transactions");
