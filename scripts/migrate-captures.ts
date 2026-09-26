// One-off migration to the captured_messages / reconcile model. Safe to run
// more than once. Run with: `yarn tsx --env-file=.env scripts/migrate-captures.ts`
//
//  1. Copies pending rows from the old sms_review_items queue (30-day TTL)
//     into captured_messages as queued items, encrypted, so they show in the
//     reconcile inbox and are no longer auto-deleted.
//  2. Backfills Transaction.source = "sms" for rows the old SMS route tagged
//     "source:sms", and leaves them reviewStatus null (they predate review).
import mongoose from "mongoose";
import connectDB from "../src/lib/mongodb";
import CapturedMessage from "../src/models/CapturedMessage";
import Transaction from "../src/models/Transaction";
import { encryptField } from "../src/lib/crypto";
import { CAPTURE_KEY_ENV } from "../src/lib/capture/ingest";
import { contentHashOf, SOURCE_PRIORITY } from "../src/lib/capture/source";
import { PARSER_VERSION, parseCapture } from "../src/lib/capture/parsers";

type OldItem = {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  rawText: string;
  receivedAt: Date;
  reason: string;
  createdAt: Date;
};

async function main() {
  await connectDB();
  const db = mongoose.connection.db!;
  const old = await db
    .collection<OldItem>("sms_review_items")
    .find({ status: "pending" })
    .toArray();

  let copied = 0;
  let skipped = 0;
  for (const item of old) {
    const parse = parseCapture(item.rawText, item.receivedAt);
    try {
      await CapturedMessage.create({
        user: item.user,
        channel: "n8n",
        rawText: encryptField(item.rawText, CAPTURE_KEY_ENV),
        receivedAt: item.receivedAt,
        contentHash: contentHashOf(item.rawText),
        parse: { kind: parse.kind, parserId: parse.parserId, version: PARSER_VERSION, confidence: parse.confidence, fields: parse },
        sourcePriority: SOURCE_PRIORITY.n8n,
        outcome: "queued",
        reason: item.reason === "no_matching_account" || item.reason === "no_matching_loan" ? item.reason : "unparsed",
        status: "pending",
      });
      copied += 1;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) skipped += 1;
      else throw err;
    }
  }

  const backfill = await Transaction.updateMany(
    { tags: "source:sms", $or: [{ source: { $exists: false } }, { source: "manual" }] },
    { $set: { source: "sms" } }
  );

  console.log(`Copied ${copied} pending review items (${skipped} already migrated).`);
  console.log(`Backfilled source=sms on ${backfill.modifiedCount} transactions.`);
  console.log("The old sms_review_items collection was left untouched; drop it once you've checked /reconcile.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
