import { Schema, model, models } from "mongoose";

// Household sharing (src/lib/share-service.ts): an owner shares some of their
// accounts, and optionally their budgets, with one other person. Every current
// query still filters by `user`; a share only opens the separate `shared`
// routes, which check it on every request.
//
// The invite token is random and shown once to the owner; only its sha256 is
// stored here, and it is cleared the moment the invite is accepted, declined or
// ended, so a token works once.
const ShareSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Set when the invite is accepted. Until then the invite is for `memberEmail`.
    member: { type: Schema.Types.ObjectId, ref: "User" },
    memberEmail: { type: String, required: true, lowercase: true, trim: true },
    accountIds: [{ type: Schema.Types.ObjectId, ref: "Account" }],
    includeBudgets: { type: Boolean, default: false },
    role: { type: String, enum: ["viewer", "editor"], default: "viewer" },
    status: { type: String, enum: ["pending", "active", "revoked", "declined"], default: "pending" },
    inviteTokenHash: { type: String },
    inviteExpiresAt: { type: Date },
    acceptedAt: { type: Date },
    endedAt: { type: Date },
    // Who ended it: the owner revoking, the member leaving or declining, or an account deletion.
    endedBy: { type: String, enum: ["owner", "member", "account_deleted"] },
    // Ended shares are kept for 90 days (audit), then the TTL index removes them.
    cleanupAt: { type: Date },
  },
  { timestamps: true }
);

// One live share per owner and invited address.
ShareSchema.index(
  { owner: 1, memberEmail: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["pending", "active"] } } }
);
ShareSchema.index({ member: 1, status: 1 });
ShareSchema.index({ memberEmail: 1, status: 1 });
ShareSchema.index({ owner: 1, status: 1 });
ShareSchema.index({ accountIds: 1, status: 1 });
ShareSchema.index({ cleanupAt: 1 }, { expireAfterSeconds: 0 });

export default models.Share || model("Share", ShareSchema, "shares");
