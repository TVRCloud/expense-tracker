import { Schema, model, models } from "mongoose";

// One row per account of the user that a live bank link feeds. The unique index on {user, account} is what makes
// "one feed per account" atomic across consents: two requests mapping the same account race on this insert and
// exactly one wins (src/lib/aa-service.ts). A claim whose consent is no longer live, or whose linked account no
// longer maps here, is stale and can be taken over, so a missed release never blocks an account for good.
// Not in backups; removed with the consent.
const AaAccountClaimSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    account: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    consent: { type: Schema.Types.ObjectId, ref: "AaConsent", required: true },
    linkedId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);

AaAccountClaimSchema.index({ user: 1, account: 1 }, { unique: true });
AaAccountClaimSchema.index({ consent: 1 });

export default models.AaAccountClaim || model("AaAccountClaim", AaAccountClaimSchema, "aa_account_claims");
