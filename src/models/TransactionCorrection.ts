import { Schema, model, models } from "mongoose";

// Permanent record of every fix to an auto-captured transaction: what the
// values were, what they became, why, and who (or which SMS) changed them.
// Rows are only ever inserted, never updated or deleted, and have no TTL.
// The matching LedgerBlock (ledgerSequence) holds the full before/after
// document in the tamper-evident chain.
const SnapshotSchema = new Schema(
  {
    amount: Number,
    type: String,
    account: { type: Schema.Types.ObjectId, ref: "Account" },
    category: String,
    date: Date,
    description: String,
  },
  { _id: false }
);

const TransactionCorrectionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    transaction: { type: Schema.Types.ObjectId, ref: "Transaction", required: true },
    capturedMessage: { type: Schema.Types.ObjectId, ref: "CapturedMessage" },
    before: { type: SnapshotSchema, required: true },
    // Null when the transaction was voided (duplicate / not a transaction).
    after: { type: SnapshotSchema, default: null },
    changedFields: [{ type: String }],
    reason: {
      type: String,
      enum: [
        "wrong_amount",
        "wrong_type",
        "wrong_account",
        "wrong_date",
        "wrong_category",
        "wrong_merchant",
        "duplicate",
        "not_a_transaction",
        "other",
        // A later SMS replaced values that came from a lower-priority source.
        "sms_override",
        // The user kept their own values over a conflicting SMS.
        "kept_user_values",
      ],
      required: true,
    },
    note: { type: String, maxlength: 500 },
    via: { type: String, enum: ["web", "mobile", "system"], required: true },
    correctedBy: { type: Schema.Types.ObjectId, ref: "User" },
    balanceEffects: [
      {
        _id: false,
        account: { type: Schema.Types.ObjectId, ref: "Account" },
        delta: Number,
      },
    ],
    ledgerSequence: { type: Number },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

TransactionCorrectionSchema.index({ user: 1, transaction: 1, createdAt: -1 });
TransactionCorrectionSchema.index({ user: 1, createdAt: -1 });

export default models.TransactionCorrection ||
  model("TransactionCorrection", TransactionCorrectionSchema, "transaction_corrections");
