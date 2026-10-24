import { Schema, model, models } from "mongoose";

// One row per user per local day (the user's time zone), holding what their
// net worth was the last time it was worked out that day. Written lazily when
// the user reads net worth and by the snapshot cron, so the trend line is a
// cheap read instead of a replay of every transaction. `day` is "YYYY-MM-DD".
const NetWorthSnapshotSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    assets: { type: Number, required: true }, // cents
    liabilities: { type: Number, required: true }, // cents, a positive number
    netWorth: { type: Number, required: true }, // cents, assets minus liabilities
  },
  { timestamps: true }
);

NetWorthSnapshotSchema.index({ user: 1, day: 1 }, { unique: true });

export default models.NetWorthSnapshot ||
  model("NetWorthSnapshot", NetWorthSnapshotSchema, "net_worth_snapshots");
