import { Schema, model, models } from "mongoose";

// Envelope mode (zero-based budgeting, src/lib/envelope-service.ts): one
// document per user and month holding the expected income and what is
// assigned to each envelope. An envelope is a budget category, identified by
// the exact category string like a Budget is. Amounts are paise of the base
// currency. Totals (assigned, unassigned) and `spent`/`left` are derived on
// read, never stored. Written only through single-document atomic updates, so
// the plan never needs a multi-document transaction. A move cannot take more
// than the source has assigned, nor below what it had spent when the move ran.
const EnvelopeSchema = new Schema(
  {
    category: { type: String, required: true },
    assigned: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

// The last few moves between envelopes, newest last, capped by the service.
const MoveSchema = new Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    amount: { type: Number, required: true },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const EnvelopePlanSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    month: { type: String, required: true }, // YYYY-MM
    income: { type: Number, default: 0 },
    envelopes: { type: [EnvelopeSchema], default: [] },
    moves: { type: [MoveSchema], default: [] },
    // Set by the pipeline updates themselves, so the schema does not use `timestamps`.
    createdAt: { type: Date },
    updatedAt: { type: Date },
  },
  { timestamps: false }
);

EnvelopePlanSchema.index({ user: 1, month: 1 }, { unique: true });

export default models.EnvelopePlan || model("EnvelopePlan", EnvelopePlanSchema, "envelope_plans");
