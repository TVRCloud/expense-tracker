import { Schema, model, models } from "mongoose";

const AccountSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["cash", "bank", "credit_card", "savings", "investment", "wallet"],
      required: true,
    },
    balance: { type: Number, default: 0 }, // stored in cents
    currency: { type: String, default: "INR" },
    color: { type: String },
    icon: { type: String },
    isArchived: { type: Boolean, default: false },
    creditMeta: {
      creditLimit: { type: Number }, // cents
      billingCycleDay: { type: Number, min: 1, max: 31 },
      paymentDueDay: { type: Number, min: 1, max: 31 },
      apr: { type: Number },
      network: {
        type: String,
        enum: ["visa", "mastercard", "amex", "rupay", "discover", "diners"],
      },
      lastFourDigits: { type: String, maxlength: 4 },
      cardholderName: { type: String, maxlength: 60 },
      minPaymentPct: { type: Number },
    },
    // Last 4 digits of the bank account / card numbers as they appear in bank
    // SMS ("A/c XX1234"), used to match a captured message to this account.
    // Credit cards also match on creditMeta.lastFourDigits.
    smsLastFour: [{ type: String, match: /^\d{4}$/ }],
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

AccountSchema.index({ user: 1, isArchived: 1, createdAt: -1 });
AccountSchema.index({ user: 1, type: 1 });
AccountSchema.index({ user: 1, smsLastFour: 1 });
AccountSchema.index({ user: 1, "creditMeta.lastFourDigits": 1 });

export default models.Account || model("Account", AccountSchema, "accounts");
