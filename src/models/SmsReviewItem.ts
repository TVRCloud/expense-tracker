import { Schema, model, models } from "mongoose";

// Queue for bank/NBFC SMS text that POST /api/integrations/sms could not
// safely turn into a Transaction/Repayment on its own — either the message
// didn't match any known format, or it matched but couldn't be tied to an
// existing Account (by card last-4) or Loan (by externalLoanId). Nothing
// financial is auto-created for these; a person confirms or discards them.
const SmsReviewItemSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    rawText: { type: String, required: true },
    receivedAt: { type: Date, required: true },
    parsedKind: {
      type: String,
      enum: ["credit_card_spend", "loan_emi_payment", "unknown"],
      required: true,
    },
    // Whatever the parser extracted (amount, merchant, card last-4, lender
    // name, loan account number, etc.) — shape varies with parsedKind, kept
    // as Mixed rather than one more schema to keep in sync with sms-parser.ts.
    parsedFields: { type: Schema.Types.Mixed },
    reason: {
      type: String,
      enum: ["unparsed", "no_matching_account", "no_matching_loan"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "resolved", "discarded"],
      default: "pending",
    },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

SmsReviewItemSchema.index({ user: 1, status: 1, createdAt: -1 });
// TTL — auto-delete unresolved items after 30 days so this doesn't grow
// unbounded if nobody ever visits the review queue.
SmsReviewItemSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export default models.SmsReviewItem || model("SmsReviewItem", SmsReviewItemSchema, "sms_review_items");
