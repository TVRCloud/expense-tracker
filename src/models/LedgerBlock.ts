import { Schema, model, models } from "mongoose";

const LedgerActorSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String },
    email: { type: String },
    role: { type: String },
  },
  { _id: false }
);

const LedgerBlockSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sequence: { type: Number, required: true },
    scope: {
      type: String,
      enum: [
        "transaction",
        "account",
        "budget",
        "goal",
        "loan",
        "repayment",
        "credit_statement",
      ],
      required: true,
    },
    entityId: { type: String, required: true },
    action: {
      type: String,
      enum: ["import", "create", "update", "delete", "restore", "system"],
      required: true,
    },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    actor: { type: LedgerActorSchema },
    previousHash: { type: String, required: true },
    hash: { type: String, required: true },
    idempotencyKey: { type: String },
  },
  { timestamps: true, versionKey: false }
);

LedgerBlockSchema.index({ user: 1, sequence: 1 }, { unique: true });
LedgerBlockSchema.index({ user: 1, scope: 1, entityId: 1, sequence: -1 });
LedgerBlockSchema.index({ user: 1, createdAt: -1 });
LedgerBlockSchema.index({ user: 1, hash: 1 });
LedgerBlockSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } }
);

export default models.LedgerBlock || model("LedgerBlock", LedgerBlockSchema, "ledger_blocks");
