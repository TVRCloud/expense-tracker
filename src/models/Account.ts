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
    currency: { type: String, default: "USD" },
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
  },
  { timestamps: true }
);

AccountSchema.index({ user: 1, isArchived: 1 });
AccountSchema.index({ user: 1, type: 1 });

export default models.Account || model("Account", AccountSchema, "accounts");
