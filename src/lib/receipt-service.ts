import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Receipt from "@/models/Receipt";
import Transaction from "@/models/Transaction";
import User from "@/models/User";
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

// An upload body is read under three limits, like the backup routes (integrations/backup-http.ts):
// at most 16 reads at once in the process (3 MB each, 48 MB in flight at most), one at a time per
// person (so one person cannot hold a slot for long), and a deadline: a total time, a longest wait
// for the next chunk, and a minimum speed (after a short grace a read that averages less than
// `minBytesPerSec` is dropped, so a trickle cannot sit on a slot for the whole total). A read that
// runs out is cancelled without waiting for the cancel, and its slot is freed.
const MAX_BODY_READS = 16;
export const RECEIPT_READ_LIMITS = { totalMs: 30_000, idleMs: 10_000, graceMs: 3_000, minBytesPerSec: 20 * 1024 };
let bodyReads = 0;
const readersNow = new Set<string>();

export type BodyReadResult = { ok: true; bytes: Buffer } | { ok: false; reason: "too_large" | "timeout" | "busy" };

/** Reads an upload body for one user under the limits above. Check quota BEFORE calling this. */
export async function readReceiptBody(req: Request, userId: string, max: number): Promise<BodyReadResult> {
  if (bodyReads >= MAX_BODY_READS || readersNow.has(userId)) return { ok: false, reason: "busy" };
  bodyReads += 1;
  readersNow.add(userId);
  try {
    return await readBodyCapped(req, max);
  } finally {
    bodyReads -= 1;
    readersNow.delete(userId);
  }
}

/** Reads a request body, stopping at `max` bytes or when the deadline passes. */
export async function readBodyCapped(req: Request, max: number): Promise<BodyReadResult> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return { ok: false, reason: "too_large" };
  if (!req.body) return { ok: true, bytes: Buffer.alloc(0) };
  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  const startedAt = Date.now();
  const deadline = startedAt + RECEIPT_READ_LIMITS.totalMs;
  const tooSlow = () => {
    const elapsed = Date.now() - startedAt;
    return elapsed > RECEIPT_READ_LIMITS.graceMs && (total * 1000) / elapsed < RECEIPT_READ_LIMITS.minBytesPerSec;
  };
  // Never wait for a cancel to finish: a stream that will not cancel must not hold a slot.
  const drop = () => void reader.cancel().catch(() => undefined);
  for (;;) {
    const wait = Math.min(RECEIPT_READ_LIMITS.idleMs, deadline - Date.now());
    if (wait <= 0 || tooSlow()) {
      drop();
      return { ok: false, reason: "timeout" };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let next: ReadableStreamReadResult<Uint8Array> | "timeout";
    try {
      next = await Promise.race([
        reader.read(),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), wait);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (next === "timeout") {
      drop();
      return { ok: false, reason: "timeout" };
    }
    if (next.done) break;
    total += next.value.byteLength;
    if (total > max) {
      drop();
      return { ok: false, reason: "too_large" };
    }
    chunks.push(Buffer.from(next.value));
    if (tooSlow()) {
      drop();
      return { ok: false, reason: "timeout" };
    }
  }
  return { ok: true, bytes: Buffer.concat(chunks, total) };
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
    .select("attachments")
    .lean<{ attachments?: string[] }>();
  if (!txn) throw new ReceiptServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  return txn.attachments ?? [];
}

const LIVE_PARENT = { isDeleted: { $ne: true }, reviewStatus: { $ne: "voided" } };
// A receipt that never got linked (a crash between the two writes) is given this long before it is swept.
const UNLINKED_GRACE_MS = 10 * 60 * 1000;

/**
 * Removes a user's receipts that nothing can reach: the transaction is gone or voided (a clean-up
 * that failed after the delete), or the transaction does not list it and it is not brand new.
 * Cheap (at most 200 receipts per user); run before a list and before the quota is worked out.
 * Failures are logged, never raised: a sweep must not block the caller.
 */
export async function sweepOrphanReceipts(userId: string): Promise<number> {
  try {
    await connectDB();
    const rows = await Receipt.find({ user: userId }).select("transaction createdAt").lean<{ _id: Types.ObjectId; transaction: Types.ObjectId; createdAt: Date }[]>();
    if (!rows.length) return 0;
    const parents = await Transaction.find({
      _id: { $in: [...new Set(rows.map((r) => r.transaction.toString()))] },
      user: userId,
      ...LIVE_PARENT,
    })
      .select("attachments")
      .lean<{ _id: Types.ObjectId; attachments?: string[] }[]>();
    const live = new Map(parents.map((p) => [p._id.toString(), new Set(p.attachments ?? [])]));
    const cutoff = Date.now() - UNLINKED_GRACE_MS;
    const orphans = rows.filter((r) => {
      const listed = live.get(r.transaction.toString());
      if (!listed) return true;
      return !listed.has(r._id.toString()) && new Date(r.createdAt).getTime() < cutoff;
    });
    // One at a time, each checked again right before it goes: a receipt moved to another line
    // (a split edit) since the reads above no longer matches `transaction`, and a transaction
    // that came alive or now lists it is left alone.
    let removed = 0;
    for (const r of orphans) {
      const parent = await Transaction.findOne({ _id: r.transaction, user: userId, ...LIVE_PARENT })
        .select("attachments")
        .lean<{ attachments?: string[] }>();
      const stillOrphan = !parent || (!(parent.attachments ?? []).includes(r._id.toString()) && new Date(r.createdAt).getTime() < cutoff);
      if (!stillOrphan) continue;
      const res = await Receipt.deleteOne({ _id: r._id, user: userId, transaction: r.transaction });
      removed += res.deletedCount ?? 0;
    }
    return removed;
  } catch (err) {
    logger.error({ err, userId }, "receipt sweep failed");
    return 0;
  }
}

const QUOTA_MESSAGE = "You have reached the receipt storage limit. Delete some receipts first";

/** True when adding `extra` bytes (one more file when extra > 0, none when 0) would pass the user's quota. Counts only receipts whose transaction is alive. */
async function overQuota(userId: string, extra: number) {
  const [usage] = await Receipt.aggregate<{ n: number; bytes: number }>([
    { $match: { user: new Types.ObjectId(userId) } },
    // Only receipts whose transaction is alive count.
    {
      $lookup: {
        from: "transactions",
        localField: "transaction",
        foreignField: "_id",
        pipeline: [{ $match: LIVE_PARENT }, { $project: { _id: 1 } }],
        as: "parent",
      },
    },
    { $match: { "parent.0": { $exists: true } } },
    { $group: { _id: null, n: { $sum: 1 }, bytes: { $sum: "$size" } } },
  ]);
  return Boolean(usage && (usage.n + (extra ? 1 : 0) > MAX_RECEIPTS_PER_USER || usage.bytes + extra > MAX_RECEIPT_BYTES_PER_USER));
}

/**
 * Everything that can be refused without the image: the transaction is yours and alive, it has
 * room for another receipt, and the user has room under the quota. Routes call this BEFORE they
 * read the body, so a refused upload costs no memory. `declared` is the Content-Length when sent.
 */
export async function preflightReceipt(userId: string, transactionId: string, declared?: number): Promise<void> {
  await connectDB();
  const listed = await ownTransaction(userId, transactionId);
  if (listed.length >= MAX_RECEIPTS_PER_TRANSACTION) {
    throw new ReceiptServiceError("TOO_MANY", `A transaction can have at most ${MAX_RECEIPTS_PER_TRANSACTION} receipts`);
  }
  await sweepOrphanReceipts(userId);
  // Too big is the body reader's answer; here a huge declared size must not read as a full quota.
  const size = Number.isFinite(declared) && (declared as number) > 0 ? Math.min(declared as number, MAX_RECEIPT_BYTES) : 1;
  if (await overQuota(userId, size)) throw new ReceiptServiceError("QUOTA_EXCEEDED", QUOTA_MESSAGE);
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
  await sweepOrphanReceipts(userId);

  if (await overQuota(userId, bytes.length)) throw new ReceiptServiceError("QUOTA_EXCEEDED", QUOTA_MESSAGE);

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

  // Quota: the check above is a quick refusal; this one decides. Every upload
  // inserts first and then counts, so uploads at the same moment each see the
  // others and the total never ends above the limit (at the very edge two
  // can both back out, which is the safe way to be wrong). Deletes need no bookkeeping.
  if (await overQuota(userId, 0)) {
    await Receipt.deleteOne({ _id: id, user: userId });
    throw new ReceiptServiceError("QUOTA_EXCEEDED", QUOTA_MESSAGE);
  }

  // Deleting an account purges receipts after locking it, so an upload that lands after the purge
  // must see the lock: take the receipt back out if the user is no longer active.
  if (!(await User.exists({ _id: userId, isActive: { $ne: false } }))) {
    await Receipt.deleteOne({ _id: id, user: userId });
    throw new ReceiptServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  }

  // The cap and the "still alive" check sit in the same atomic update, so two
  // uploads at once cannot pass the cap and a delete in between leaves nothing behind.
  let linked;
  try {
    linked = await Transaction.updateOne(
      {
        _id: transactionId,
        user: userId,
        isDeleted: { $ne: true },
        [`attachments.${MAX_RECEIPTS_PER_TRANSACTION - 1}`]: { $exists: false },
      },
      { $addToSet: { attachments: id.toString() } }
    );
  } catch (err) {
    // Not linked, so nothing could ever show it: take it back out.
    await Receipt.deleteOne({ _id: id, user: userId }).catch(() => undefined);
    throw err;
  }
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
  const listed = await ownTransaction(userId, transactionId);
  await sweepOrphanReceipts(userId);
  // What the transaction lists and exists: a stray receipt never shows.
  const rows = await Receipt.find({ user: userId, transaction: transactionId, _id: { $in: listed.filter((x) => Types.ObjectId.isValid(x)) } })
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
  // A receipt is only as alive as its transaction: deleted, voided or not yours reads as not found.
  const parent = await Transaction.exists({
    _id: doc.transaction,
    user: userId,
    isDeleted: { $ne: true },
    reviewStatus: { $ne: "voided" },
  });
  if (!parent) throw new ReceiptServiceError("RECEIPT_NOT_FOUND", "Receipt not found");
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
  const doc = await Receipt.findOne({ _id: receiptId, user: userId }).select("transaction").lean<{ transaction: Types.ObjectId }>();
  if (!doc) throw new ReceiptServiceError("RECEIPT_NOT_FOUND", "Receipt not found");
  // Unlink first. If the delete then fails the receipt is unlisted, so it is unreachable,
  // stops counting against the transaction's cap and is swept later.
  await Transaction.updateOne({ _id: doc.transaction, user: userId }, { $pull: { attachments: receiptId } });
  await Receipt.deleteOne({ _id: receiptId, user: userId });
}

/**
 * Gone with the transaction: nothing keeps a private image after its row is deleted.
 * Callers run this AFTER the delete, void or cancel has been done. Tried twice; if it
 * still fails the error is logged and the caller carries on: a receipt of a deleted or
 * voided transaction cannot be read (getReceiptImage checks the parent), does not count
 * toward the quota, and sweepOrphanReceipts removes it the next time the user lists or adds one.
 */
export async function deleteReceiptsOfTransactions(userId: string, transactionIds: unknown[]): Promise<void> {
  if (!transactionIds.length) return;
  const run = async () => {
    await Receipt.deleteMany({ user: userId, transaction: { $in: transactionIds } });
    await Transaction.updateMany({ _id: { $in: transactionIds }, user: userId }, { $set: { attachments: [] } });
  };
  try {
    await run();
  } catch (err) {
    logger.warn({ err, userId, count: transactionIds.length }, "deleting receipts failed, retrying once");
    try {
      await run();
    } catch (err2) {
      logger.error({ err: err2, userId, count: transactionIds.length }, "deleting receipts failed; the sweep will remove them");
    }
  }
}

/** Every receipt of one user, for account deletion. */
export async function deleteAllReceiptsOfUser(userId: string): Promise<void> {
  await connectDB();
  await Receipt.deleteMany({ user: userId });
  await Transaction.updateMany({ user: userId, "attachments.0": { $exists: true } }, { $set: { attachments: [] } });
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
