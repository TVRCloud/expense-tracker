// How saved captures parse today, per sender (ticket 154). Read only: it uses the plain MongoDB driver, imports no
// models (so nothing builds indexes or collections) and only runs a find. Prints counts and sender ids only, never
// message text, amounts or account digits. Bank link (`aa`) rows are skipped: they are not parsed from text.
//
//   yarn capture:report                 every user
//   yarn capture:report --user <id>     one user
//   yarn capture:report --days 90       only captures from the last 90 days
import mongoose from "mongoose";
import connectDB from "../src/lib/mongodb";
import { decryptField, type EncryptedField } from "../src/lib/crypto";
import { formatReport, SenderReport } from "../src/lib/capture/parse-report";

const KEY_ENV = "CAPTURE_ENCRYPTION_KEY"; // same as CAPTURE_KEY_ENV in src/lib/capture/ingest.ts
const USAGE = "usage: yarn capture:report [--user <24-hex id>] [--days <n>]";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) fail(`--${name} needs a value. ${USAGE}`);
  return value;
}

type Row = {
  channel: string;
  sender?: string;
  packageName?: string;
  rawText: EncryptedField;
  receivedAt: Date;
  parse?: { kind?: string };
};

async function main() {
  if ((process.env[KEY_ENV] ?? "").length < 32) fail(`${KEY_ENV} is not set or shorter than 32 characters.`);

  const filter: Record<string, unknown> = { channel: { $in: ["sms", "notification", "n8n"] } };
  const user = flag("user");
  if (user !== undefined) {
    if (!/^[0-9a-f]{24}$/i.test(user)) fail(`--user must be a 24-character hex id. ${USAGE}`);
    filter.user = new mongoose.Types.ObjectId(user);
  }
  const daysText = flag("days");
  if (daysText !== undefined) {
    const days = Number(daysText);
    if (!Number.isInteger(days) || days <= 0) fail(`--days must be a whole number above 0. ${USAGE}`);
    filter.receivedAt = { $gte: new Date(Date.now() - days * 86_400_000) };
  }

  await connectDB();
  const cursor = mongoose.connection
    .db!.collection<Row>("captured_messages")
    .find(filter, { projection: { channel: 1, sender: 1, packageName: 1, rawText: 1, receivedAt: 1, "parse.kind": 1 } });

  const report = new SenderReport();
  let seen = 0;
  let unreadable = 0;
  let checkedKey = false;
  for await (const r of cursor) {
    seen += 1;
    let text: string;
    try {
      text = decryptField(r.rawText, KEY_ENV);
      checkedKey = true;
    } catch (err) {
      // A wrong key fails every row: stop at once rather than print a report of nothing.
      if (!checkedKey && seen >= 5 && unreadable === seen - 1) fail(`Could not decrypt captures: is ${KEY_ENV} the right key? (${(err as Error).message})`);
      unreadable += 1;
      continue;
    }
    report.add({ text, receivedAt: r.receivedAt, channel: r.channel, sender: r.sender, packageName: r.packageName, storedKind: r.parse?.kind });
  }

  console.log(formatReport(report.rowsByMisses()));
  console.log(`\n${seen} captures (bank link rows skipped)${unreadable ? `, ${unreadable} could not be decrypted` : ""}.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    process.exit(process.exitCode ?? 0);
  });
