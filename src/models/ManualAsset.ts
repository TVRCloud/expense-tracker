import { Schema, model, models } from "mongoose";

// Something the user owns that is not an account: property, a vehicle, gold,
// shares held elsewhere. It only feeds net worth (src/lib/net-worth.ts), so
// it holds one value the user keeps up to date by hand. Archived instead of
// deleted, so realtime sees the change.
const ManualAssetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    kind: {
      type: String,
      enum: ["property", "vehicle", "gold", "investment", "other"],
      default: "other",
    },
    value: { type: Number, required: true, min: 0 }, // cents
    note: { type: String, maxlength: 200 },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ManualAssetSchema.index({ user: 1, isArchived: 1, createdAt: -1 });

export default models.ManualAsset || model("ManualAsset", ManualAssetSchema, "manual_assets");
