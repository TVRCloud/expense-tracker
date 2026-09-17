import { Schema, model, models } from "mongoose";

// Bearer keys for /api/integrations/* callers (n8n, the mobile companion
// app, and any future automation). Replaces the earlier single-env-var
// scheme (N8N_API_KEY + N8N_USER_EMAIL) so each caller has its own
// independently revocable key and identity — losing a phone or rotating one
// integration no longer requires breaking every other one.
//
// The raw key is never stored — only a sha256 hash, looked up directly by
// findOne. This is the same "hash it like a password, compare by lookup"
// pattern used for long random tokens (GitHub PATs, API keys generally):
// the key itself has enough entropy that a hash-equality lookup can't be
// meaningfully brute-forced via response timing.
const ApiKeySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    label: { type: String, required: true, trim: true },
    keyHash: { type: String, required: true, unique: true },
    // Last 4 chars of the raw key, for display in a list ("...a91f") so a
    // human can tell keys apart without ever seeing the full value again.
    lastFour: { type: String, required: true },
    revoked: { type: Boolean, default: false },
    revokedAt: { type: Date },
    lastUsedAt: { type: Date },
  },
  { timestamps: true }
);

ApiKeySchema.index({ user: 1, revoked: 1 });

export default models.ApiKey || model("ApiKey", ApiKeySchema, "api_keys");
