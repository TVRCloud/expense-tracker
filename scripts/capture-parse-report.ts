// How saved captures parse today, per sender (ticket 154). Read only: it changes nothing in the database.
// Prints counts and sender ids only, never message text, amounts or account digits.
//
//   yarn capture:report                 every user
//   yarn capture:report --user <id>     one user
//   yarn capture:report --days 90       only captures from the last 90 days
import mongoose from "mongoose";
import connectDB from "../src/lib/mongodb";
import CapturedMessage from "../src/models/CapturedMessage";
import { decryptField, type EncryptedField } from "../src/lib/crypto";
import { CAPTURE_KEY_ENV } from "../src/lib/capture/ingest";
import { buildReport, formatReport, type ReportInput } from "../src/lib/capture/parse-report";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
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
  await connectDB();
  const filter: Record<string, unknown> = { channel: { $in: ["sms", "notification", "n8n"] } };
  const user = arg("user");
  if (user) filter.user = new mongoose.Types.ObjectId(user);
  const days = Number(arg("days"));
  if (Number.isFinite(days) && days > 0) filter.receivedAt = { $gte: new Date(Date.now() - days * 86_400_000) };

  let unreadable = 0;
  function* inputs(rows: Row[]): Generator<ReportInput> {
    for (const r of rows) {
      let text: string;
      try {
        text = decryptField(r.rawText, CAPTURE_KEY_ENV);
      } catch {
        unreadable += 1;
        continue;
      }
      yield { text, receivedAt: r.receivedAt, channel: r.channel, sender: r.sender, packageName: r.packageName, storedKind: r.parse?.kind };
    }
  }

  const rows = await CapturedMessage.find(filter, { channel: 1, sender: 1, packageName: 1, rawText: 1, receivedAt: 1, "parse.kind": 1 })
    .lean<Row[]>();
  const report = buildReport(inputs(rows));
  console.log(formatReport(report));
  console.log(`\n${rows.length} captures${unreadable ? `, ${unreadable} could not be decrypted` : ""}.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
