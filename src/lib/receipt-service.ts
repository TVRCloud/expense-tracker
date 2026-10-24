import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Receipt from "@/models/Receipt";
import Transaction from "@/models/Transaction";
import { decryptBytes, encryptBytes } from "@/lib/crypto";
import logger from "@/lib/logger";

// Receipt photos on a transaction. Stored encrypted in their own collection;
// the transaction keeps only the ids in `attachments`. Shared by the browser
// routes and the integration routes. Nothing here hands out a URL: bytes leave
// only through getReceiptImage(), behind an authenticated route that passes the
// signed-in user.

export const RECEIPT_KEY_ENV = "CAPTURE_ENCRYPTION_KEY";
const KEY_PURPOSE = "receipt";

export const MAX_RECEIPT_BYTES = 3 * 1024 * 1024;
export const MAX_RECEIPTS_PER_TRANSACTION = 5;
export const MAX_RECEIPTS_PER_USER = 200;
export const MAX_RECEIPT_BYTES_PER_USER = 150 * 1024 * 1024;

export type ReceiptContentType = "image/jpeg" | "image/png" | "image/webp" | "image/heic";

export type ReceiptServiceErrorCode =
  | "TRANSACTION_NOT_FOUND"
  | "RECEIPT_NOT_FOUND"
  | "UNSUPPORTED_TYPE"
  | "TOO_LARGE"
  | "EMPTY"
  | "TOO_MANY"
  | "QUOTA_EXCEEDED"
  | "UNREADABLE";

export class ReceiptServiceError extends Error {
  code: ReceiptServiceErrorCode;
  constructor(code: ReceiptServiceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ReceiptServiceError";
  }
}

export function receiptErrorStatus(code: ReceiptServiceErrorCode) {
  switch (code) {
    case "TRANSACTION_NOT_FOUND":
    case "RECEIPT_NOT_FOUND":
      return 404;
    case "TOO_LARGE":
      return 413;
    case "UNSUPPORTED_TYPE":
      return 415;
    case "TOO_MANY":
    case "QUOTA_EXCEEDED":
      return 409;
    case "UNREADABLE":
      return 500;
    default:
      return 400;
  }
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** The image type from the file's first bytes. The type a client declares is never trusted. */
export function sniffImageType(b: Buffer): ReceiptContentType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp" && HEIC_BRANDS.has(b.toString("ascii", 8, 12))) {
    return "image/heic";
  }
  return null;
}

/** Reads a request body, stopping as soon as it passes `max` bytes. Null means too big. */
export async function readBodyCapped(req: Request, max: number): Promise<Buffer | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export type ReceiptMeta = {
  id: string;
  transactionId: string;
  contentType: ReceiptContentType;
  size: number;
  createdAt: Date;
};

function meta(r: { _id: Types.ObjectId; transaction: Types.ObjectId; contentType: string; size: number; createdAt: Date }): ReceiptMeta {
  return {
    id: r._id.toString(),
    transactionId: r.transaction.toString(),
    contentType: r.contentType as ReceiptContentType,
    size: r.size,
    createdAt: r.createdAt,
  };
}

const context = (userId: string, receiptId: string) => `${userId}:${receiptId}`;

async function ownTransaction(userId: string, transactionId: string) {
  if (!Types.ObjectId.isValid(transactionId)) {
    throw new ReceiptServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  }
  const txn = await Transaction.findOne({
    _id: transactionId,
    user: userId,
    isDeleted: { $ne: true },
    reviewStatus: { $ne: "voided" },
  })
    .select("_id")
    .lean();
  if (!txn) throw new ReceiptServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
}

export async function addReceipt(input: { userId: string; transactionId: string; bytes: Buffer }): Promise<ReceiptMeta> {
  const { userId, transactionId, bytes } = input;
  if (bytes.length === 0) throw new ReceiptServiceError("EMPTY", "The image is empty");
  if (bytes.length > MAX_RECEIPT_BYTES) {
    throw new ReceiptServiceError("TOO_LARGE", `A receipt can be at most ${MAX_RECEIPT_BYTES / (1024 * 1024)} MB`);
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    throw new ReceiptServiceError("UNSUPPORTED_TYPE", "Receipts must be a JPEG, PNG, WebP or HEIC image");
  }

  await connectDB();
  await ownTransaction(userId, transactionId);

  const [usage] = await Receipt.aggregate<{ n: number; bytes: number }>([
    { $match: { user: new Types.ObjectId(userId) } },
    { $group: { _id: null, n: { $sum: 1 }, bytes: { $sum: "$size" } } },
  ]);
  if (usage && (usage.n >= MAX_RECEIPTS_PER_USER || usage.bytes + bytes.length > MAX_RECEIPT_BYTES_PER_USER)) {
    throw new ReceiptServiceError("QUOTA_EXCEEDED", "You have reached the receipt storage limit. Delete some receipts first");
  }

  const id = new Types.ObjectId();
  const enc = encryptBytes(bytes, RECEIPT_KEY_ENV, KEY_PURPOSE, context(userId, id.toString()));
  const created = await Receipt.create({
    _id: id,
    user: userId,
    transaction: transactionId,
    contentType,
    size: bytes.length,
    iv: enc.iv,
    tag: enc.tag,
    data: enc.data,
  });

  // The cap and the "still alive" check sit in the same atomic update, so two
  // uploads at once cannot pass the cap and a delete in between leaves nothing behind.
  const linked = await Transaction.updateOne(
    {
      _id: transactionId,
      user: userId,
      isDeleted: { $ne: true },
      [`attachments.${MAX_RECEIPTS_PER_TRANSACTION - 1}`]: { $exists: false },
    },
    { $addToSet: { attachments: id.toString() } }
  );
  if (linked.modifiedCount !== 1) {
    await Receipt.deleteOne({ _id: id, user: userId });
    const still = await Transaction.exists({ _id: transactionId, user: userId, isDeleted: { $ne: true } });
    if (!still) throw new ReceiptServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
    throw new ReceiptServiceError("TOO_MANY", `A transaction can have at most ${MAX_RECEIPTS_PER_TRANSACTION} receipts`);
  }
  return meta(created);
}

export async function listReceipts(userId: string, transactionId: string): Promise<ReceiptMeta[]> {
  await connectDB();
  await ownTransaction(userId, transactionId);
  const rows = await Receipt.find({ user: userId, transaction: transactionId })
    .select("transaction contentType size createdAt")
    .sort({ createdAt: 1, _id: 1 })
    .lean<{ _id: Types.ObjectId; transaction: Types.ObjectId; contentType: string; size: number; createdAt: Date }[]>();
  return rows.map(meta);
}

/** The decrypted image, only for its owner. Another user's id looks the same as an unknown one. */
export async function getReceiptImage(userId: string, receiptId: string): Promise<{ contentType: ReceiptContentType; bytes: Buffer }> {
  if (!Types.ObjectId.isValid(receiptId)) throw new ReceiptServiceError("RECEIPT_NOT_FOUND", "Receipt not found");
  await connectDB();
  const doc = await Receipt.findOne({ _id: receiptId, user: userId });
  if (!doc) throw new ReceiptServiceError("RECEIPT_NOT_FOUND", "Receipt not found");
  try {
    const bytes = decryptBytes(
      { iv: Buffer.from(doc.iv), tag: Buffer.from(doc.tag), data: Buffer.from(doc.data) },
      RECEIPT_KEY_ENV,
      KEY_PURPOSE,
      context(userId, receiptId)
    );
    return { contentType: doc.contentType as ReceiptContentType, bytes };
  } catch (err) {
    logger.error({ err, receiptId }, "receipt could not be decrypted");
    throw new ReceiptServiceError("UNREADABLE", "The receipt could not be read");
  }
}

export async function deleteReceipt(userId: string, receiptId: string): Promise<void> {
  if (!Types.ObjectId.isValid(receiptId)) throw new ReceiptServiceError("RECEIPT_NOT_FOUND", "Receipt not found");
  await connectDB();
  const doc = await Receipt.findOneAndDelete({ _id: receiptId, user: userId }).select("transaction").lean<{ transaction: Types.ObjectId }>();
  if (!doc) throw new ReceiptServiceError("RECEIPT_NOT_FOUND", "Receipt not found");
  await Transaction.updateOne({ _id: doc.transaction, user: userId }, { $pull: { attachments: receiptId } });
}

/** Gone with the transaction: nothing keeps a private image after its row is deleted. */
export async function deleteReceiptsOfTransactions(userId: string, transactionIds: unknown[]): Promise<void> {
  if (!transactionIds.length) return;
  try {
    await Receipt.deleteMany({ user: userId, transaction: { $in: transactionIds } });
    await Transaction.updateMany({ _id: { $in: transactionIds }, user: userId }, { $set: { attachments: [] } });
  } catch (err) {
    logger.error({ err, userId, count: transactionIds.length }, "could not delete the receipts of deleted transactions");
  }
}

export async function deleteReceiptsOfTransaction(userId: string, transactionId: string): Promise<void> {
  await deleteReceiptsOfTransactions(userId, [transactionId]);
}

/** Headers for sending a receipt image back: private, never cached, never sniffed or run as a page. */
export function receiptImageHeaders(contentType: ReceiptContentType, length: number): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Length": String(length),
    "Content-Disposition": 'inline; filename="receipt"',
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
