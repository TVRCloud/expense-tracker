import { Schema, model, models } from "mongoose";

const LedgerBackfillSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    version: { type: Number, required: true },
    scopes: [{ type: String, required: true }],
    completedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

LedgerBackfillSchema.index({ user: 1, version: 1 }, { unique: true });

export default models.LedgerBackfill ||
  model("LedgerBackfill", LedgerBackfillSchema, "ledger_backfills");
