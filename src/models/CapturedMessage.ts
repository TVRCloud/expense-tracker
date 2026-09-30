import { Schema, model, models } from "mongoose";

// Every bank message the backend receives, from any source: the phone's SMS
// receiver, the phone's bank-app notification listener, or n8n forwarding SMS
// text. One inbox for all of them. Replaces the old sms_review_items queue,
// which had a 30-day TTL. Nothing here expires: these rows are the record of
// where each auto-captured transaction's values came from.
//
// Source of truth: SMS beats n8n (forwarded SMS) beats app notification, see
// SOURCE_PRIORITY in src/lib/capture/source.ts and the rules in
// src/lib/capture/ingest.ts.
const EncryptedFieldSchema = new Schema(
  { iv: String, tag: String, ciphertext: String },
  { _id: false }
);

const CapturedMessageSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    channel: { type: String, enum: ["sms", "notification", "n8n"], required: true },
    apiKey: { type: Schema.Types.ObjectId, ref: "ApiKey" },
    // DLT sender id for SMS (e.g. "VM-HDFCBK"), or the app name for a notification.
    sender: { type: String },
    packageName: { type: String },
    // Raw text is financial PII: encrypted with CAPTURE_ENCRYPTION_KEY
    // (src/lib/crypto.ts). Only the owner ever sees it decrypted.
    rawText: { type: EncryptedFieldSchema, required: true },
    receivedAt: { type: Date, required: true },
    // sha256 of the normalized text: identical text from any channel, at any
    // time, is recognised as the same message (see normalizeForHash).
    contentHash: { type: String, required: true },
    // Channels the phone saw this same payment on before merging them into
    // one upload (e.g. ["notification"] on an SMS row).
    alsoSeenIn: [{ type: String }],
    parse: {
      kind: { type: String },
      parserId: { type: String },
      version: { type: Number },
      confidence: { type: Number },
      fields: { type: Schema.Types.Mixed },
    },
    // What the payment looks like once parsed, used to spot the same payment
    // arriving on two channels with different wording.
    eventKey: {
      account: { type: Schema.Types.ObjectId, ref: "Account" },
      type: { type: String, enum: ["income", "expense"] },
      amount: { type: Number },
      ref: { type: String },
      at: { type: Date },
      hasTime: { type: Boolean },
    },
    sourcePriority: { type: Number, required: true },
    // How the account was picked (src/lib/capture/account-match.ts):
    // saved digits, or bank name + instrument (confirming teaches digits).
    accountMatch: { type: String, enum: ["digits", "bank"] },
    // Likely account to preselect when the message is queued unmatched.
    suggestedAccount: { type: Schema.Types.ObjectId, ref: "Account" },
    role: { type: String, enum: ["primary", "supporting"], default: "primary" },
    outcome: {
      type: String,
      enum: ["processing", "created", "queued", "pending_sms", "duplicate", "ignored"],
      required: true,
    },
    reason: {
      type: String,
      enum: [
        "unparsed",
        "low_confidence",
        "no_matching_account",
        "no_matching_loan",
        "possible_duplicate",
        "source_conflict",
        "otp",
        "promo",
        "reminder",
        "not_financial",
        "processing_error",
      ],
    },
    status: { type: String, enum: ["pending", "resolved", "discarded"], default: "pending" },
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    transaction: { type: Schema.Types.ObjectId, ref: "Transaction" },
    repayment: { type: Schema.Types.ObjectId, ref: "Repayment" },
    duplicateOf: { type: Schema.Types.ObjectId, ref: "CapturedMessage" },
  },
  { timestamps: true }
);

CapturedMessageSchema.index({ user: 1, contentHash: 1 }, { unique: true });
CapturedMessageSchema.index({ user: 1, status: 1, createdAt: -1 });
CapturedMessageSchema.index({ user: 1, "eventKey.amount": 1, "eventKey.type": 1, "eventKey.at": -1 });
CapturedMessageSchema.index({ outcome: 1, receivedAt: 1 });
CapturedMessageSchema.index({ user: 1, transaction: 1 });
// Held notifications per user (review "waiting for SMS" count and lazy
// promotion of the stale ones).
CapturedMessageSchema.index({ user: 1, outcome: 1, createdAt: 1 });

export default models.CapturedMessage || model("CapturedMessage", CapturedMessageSchema, "captured_messages");
