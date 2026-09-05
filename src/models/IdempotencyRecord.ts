import { Schema, model, models } from "mongoose";

// Persistent idempotency cache for mutating integration API calls (n8n etc).
// A record is keyed by (userId, endpoint, key) so the same Idempotency-Key
// value can be reused safely across different users/endpoints without
// collision. The unique index on that triple is the sole concurrency guard —
// this codebase has no distributed lock or mongoose session/transaction
// support, so a race is resolved by letting MongoDB reject the loser's
// insert with a duplicate-key error (see src/lib/integrations/idempotency.ts).
//
// responseBody intentionally stores only the minimal fields the integration
// route already returns to the caller (transaction id/type/amount/etc) —
// never full account/transaction documents — to avoid persisting sensitive
// financial payloads longer than necessary.
const IdempotencyRecordSchema = new Schema(
  {
    key: { type: String, required: true },
    userId: { type: String, required: true },
    endpoint: { type: String, required: true },
    fingerprint: { type: String, required: true },
    status: { type: String, enum: ["pending", "completed"], default: "pending", required: true },
    responseStatus: { type: Number },
    responseBody: { type: Schema.Types.Mixed },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

IdempotencyRecordSchema.index({ userId: 1, endpoint: 1, key: 1 }, { unique: true });
IdempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default models.IdempotencyRecord ||
  model("IdempotencyRecord", IdempotencyRecordSchema, "idempotency_records");
