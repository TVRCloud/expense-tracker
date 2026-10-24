import { Schema, model, models } from "mongoose";

const TransactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    account: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    type: { type: String, enum: ["income", "expense", "transfer"], required: true },
    amount: { type: Number, required: true }, // cents, always positive
    currency: { type: String, default: "INR" },
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
    // True when the series has no user-specified end date/count — materialized
    // in a small rolling window (see OPEN_ENDED_WINDOW) instead of a big upfront batch.
    recurrenceIsOpenEnded: { type: Boolean, default: false },
    recurrenceCancelled: { type: Boolean, default: false },
    installmentIndex: { type: Number },
    installmentStatus: {
      type: String,
      enum: ["upcoming", "paid", "overdue", "skipped"],
      default: "upcoming",
    },
    paidAt: { type: Date },
    // Split-purchase siblings — one real Transaction document per category,
    // sharing this id, same pattern as recurringId above (not an embedded
    // array), so every existing $sum/$group aggregation needs no changes.
    splitGroupId: { type: Schema.Types.ObjectId },
    // Bumped on the first line of a split by every edit of its lines: two edits
    // at once cannot both apply (see split-service.ts). Missing until the first edit.
    splitRev: { type: Number },
    // Where the values came from. Auto-captured rows (sms / notification /
    // n8n) start as reviewStatus "unreviewed" and show in the reconcile
    // inbox. Manual rows have no reviewStatus.
    source: {
      type: String,
      enum: ["manual", "sms", "notification", "n8n", "recurring", "import"],
      default: "manual",
    },
    // The captured message whose values this transaction currently uses.
    sourceCapture: { type: Schema.Types.ObjectId, ref: "CapturedMessage" },
    // Every captured message linked to this payment (primary + supporting).
    captures: [{ type: Schema.Types.ObjectId, ref: "CapturedMessage" }],
    reviewStatus: {
      type: String,
      enum: ["unreviewed", "confirmed", "corrected", "voided", null],
      default: null,
    },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    // Refund and reversal matching (src/lib/refund-service.ts). Set on an
    // income row that looks like the money coming back for an earlier expense:
    // refundOf is that expense, refundStatus where the link stands. Only
    // "confirmed" nets the pair out of the stats; "rejected" keeps refundOf so
    // the same pair is never suggested again. The category the row had before
    // the original's was carried over is kept to undo a confirmed link.
    refundOf: { type: Schema.Types.ObjectId, ref: "Transaction" },
    refundStatus: { type: String, enum: ["suggested", "confirmed", "rejected", null], default: null },
    refundPriorCategory: { type: String },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

TransactionSchema.index({ user: 1, isDeleted: 1, date: -1 });
TransactionSchema.index({ user: 1, isDeleted: 1, account: 1, date: -1 });
TransactionSchema.index({ user: 1, isDeleted: 1, transferTo: 1, date: -1 });
TransactionSchema.index({ user: 1, isDeleted: 1, type: 1, date: -1 });
TransactionSchema.index({ user: 1, isDeleted: 1, category: 1, date: -1 });
TransactionSchema.index({ description: "text", note: "text" });
TransactionSchema.index({ user: 1, isDeleted: 1, recurringId: 1, installmentIndex: 1 });
TransactionSchema.index({ user: 1, isDeleted: 1, recurringId: 1, date: 1 });
TransactionSchema.index({ user: 1, isDeleted: 1, isRecurring: 1, installmentStatus: 1, date: 1 });
TransactionSchema.index({ isDeleted: 1, recurrenceIsOpenEnded: 1, recurrenceCancelled: 1, recurringId: 1 });
TransactionSchema.index({ user: 1, tags: 1 });
TransactionSchema.index({ user: 1, isDeleted: 1, splitGroupId: 1 });
TransactionSchema.index({ user: 1, isDeleted: 1, reviewStatus: 1, date: -1 });
TransactionSchema.index({ user: 1, isDeleted: 1, refundStatus: 1, date: -1 });
TransactionSchema.index({ user: 1, refundOf: 1 }, { sparse: true });
// Paid recurring installments count on their paidAt (see
// transaction-activity.ts): lets the monthly stats and the recent list read
// them by paidAt from an index instead of scanning every row.
TransactionSchema.index({ user: 1, isDeleted: 1, paidAt: -1 });

export default models.Transaction || model("Transaction", TransactionSchema, "transactions");
