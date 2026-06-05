import { Schema, model, models } from "mongoose";

const RepaymentSchema = new Schema(
  {
    loan: { type: Schema.Types.ObjectId, ref: "Loan", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true }, // cents
    date: { type: Date, required: true },
    note: { type: String },
    account: { type: Schema.Types.ObjectId, ref: "Account" },
  },
  { timestamps: true }
);

RepaymentSchema.index({ loan: 1, date: -1 });
RepaymentSchema.index({ user: 1, date: -1 });

export default models.Repayment || model("Repayment", RepaymentSchema, "repayments");
