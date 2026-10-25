import { Schema, model, models } from "mongoose";

// An investment the user holds: a stock, a mutual fund, gold, a fixed deposit,
// PPF. It is kept apart from the ledger on purpose (no transaction is posted
// for it) and only feeds net worth (src/lib/net-worth.ts). Amounts are integer
// minor units of the base currency, like every stored amount. Units are an
// integer in millionths so quantities never go through floating point.
// Dates are calendar days as "YYYY-MM-DD" strings, not instants, so they do
// not move when the person changes time zone.
// A fixed deposit's value is worked out on read from its terms
// (src/lib/holding-math.ts); `currentValue` is only the manual value of the
// other kinds. Archived instead of deleted, so realtime sees the change.
export const HOLDING_KINDS = ["stock", "mutual_fund", "gold", "fixed_deposit", "ppf", "other"] as const;
export type HoldingKind = (typeof HOLDING_KINDS)[number];

const SipSchema = new Schema(
  {
    amount: { type: Number, required: true, min: 1 },
    dayOfMonth: { type: Number, required: true, min: 1, max: 31 },
    startDay: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { _id: false }
);

const FixedDepositSchema = new Schema(
  {
    principal: { type: Number, required: true, min: 1 },
    rateBps: { type: Number, required: true, min: 0, max: 10000 },
    startDay: { type: String, required: true },
    maturityDay: { type: String, required: true },
  },
  { _id: false }
);

const ValueEntrySchema = new Schema(
  {
    value: { type: Number, required: true, min: 0 },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const HoldingSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: HOLDING_KINDS, required: true },
    note: { type: String, maxlength: 200 },
    unitsMicro: { type: Number, min: 0 },
    investedAmount: { type: Number, required: true, min: 0 },
    currentValue: { type: Number, required: true, min: 0 },
    valueUpdatedAt: { type: Date },
    // The last 100 manual values, oldest first.
    history: { type: [ValueEntrySchema], default: [] },
    sip: { type: SipSchema },
    fd: { type: FixedDepositSchema },
    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date },
  },
  { timestamps: true }
);

HoldingSchema.index({ user: 1, isArchived: 1, createdAt: -1 });

export default models.Holding || model("Holding", HoldingSchema, "holdings");
