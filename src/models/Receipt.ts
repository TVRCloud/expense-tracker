import { Schema, model, models } from "mongoose";

// A receipt photo attached to a transaction. Private by design: the image is
// encrypted at rest (AES-256-GCM, key derived from CAPTURE_ENCRYPTION_KEY, the
// user and receipt id bound in as additional data) and is only ever served by
// an authenticated route that checks the owner. The transaction keeps just the
// receipt ids in `attachments`. Hard-deleted with its transaction, no ledger
// block. See src/lib/receipt-service.ts.
const ReceiptSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    transaction: { type: Schema.Types.ObjectId, ref: "Transaction", required: true },
    contentType: { type: String, enum: ["image/jpeg", "image/png", "image/webp", "image/heic"], required: true },
    size: { type: Number, required: true }, // bytes of the original image
    iv: { type: Buffer, required: true },
    tag: { type: Buffer, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true }
);

ReceiptSchema.index({ user: 1, transaction: 1 });

export default models.Receipt || model("Receipt", ReceiptSchema, "receipts");
