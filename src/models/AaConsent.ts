import { Schema, model, models } from "mongoose";

// A consent the user gave through an Account Aggregator (src/lib/aa-service.ts).
// The provider's handle for it is an opaque secret: AES-GCM encrypted with
// CAPTURE_ENCRYPTION_KEY and never sent to a client. Bank transactions fetched
// under a consent become ordinary ledger rows through the capture path
// (channel "aa"); nothing else from the feed is stored here.
const EncryptedFieldSchema = new Schema({ iv: String, tag: String, ciphertext: String }, { _id: false });

const LinkedAccountSchema = new Schema(
  {
    // The provider's reference for the bank account. Opaque; only used to ask for its transactions.
    providerRef: { type: String, required: true },
    bankName: { type: String, required: true },
    // Last four digits only. The full number is never stored.
    maskedNumber: { type: String, required: true },
    // The user's own account the feed lands in. Unmapped accounts are never synced.
    mappedAccount: { type: Schema.Types.ObjectId, ref: "Account" },
    // Everything up to here has been read. The next sync asks from a little before it.
    syncedUntil: { type: Date },
    // True when the last run stopped at a limit: the next one resumes exactly there, with no overlap.
    syncedPartial: { type: Boolean, default: false },
  },
  { _id: true }
);

const AaConsentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    provider: { type: String, required: true },
    consentHandle: { type: EncryptedFieldSchema, required: true },
    // sha256 of the handle: finds a consent without decrypting every row.
    handleHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "active", "paused", "revoked", "expired", "failed"],
      default: "pending",
      required: true,
    },
    expiresAt: { type: Date },
    linkedAccounts: { type: [LinkedAccountSchema], default: [] },
    lastSyncAt: { type: Date },
    // A short code for the last failure ("provider_error", "revoked_at_provider"), never a provider message.
    lastError: { type: String },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);

AaConsentSchema.index({ user: 1, status: 1, createdAt: -1 });
AaConsentSchema.index({ status: 1, lastSyncAt: 1 });
AaConsentSchema.index({ handleHash: 1 });

export default models.AaConsent || model("AaConsent", AaConsentSchema, "aa_consents");
