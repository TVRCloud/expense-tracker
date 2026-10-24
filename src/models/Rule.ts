import { Schema, model, models } from "mongoose";

// A categorise rule: when a transaction's merchant, UPI id or message text
// matches, set its category, clean merchant name, account (captures with no
// account match only) and tags. Evaluated by src/lib/rule-service.ts. Rules
// are configuration, not money, so they are hard-deleted and have no ledger
// block.
const RuleSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    field: { type: String, enum: ["merchant", "upi", "text"], required: true },
    op: { type: String, enum: ["contains", "equals"], default: "contains" },
    value: { type: String, required: true }, // as typed
    valueKey: { type: String, required: true }, // lower-cased and trimmed, what matching and the unique index use
    category: { type: String },
    merchantName: { type: String },
    account: { type: Schema.Types.ObjectId, ref: "Account" },
    tags: [{ type: String }],
    priority: { type: Number, default: 100 }, // lower runs first
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

RuleSchema.index({ user: 1, priority: 1, createdAt: 1 });
// One rule per (field, op, value) per user; the service reports a clash as a conflict.
RuleSchema.index({ user: 1, field: 1, op: 1, valueKey: 1 }, { unique: true });

export default models.Rule || model("Rule", RuleSchema, "rules");
