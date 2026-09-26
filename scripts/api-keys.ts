// Mint / list / revoke API keys for /api/integrations/* callers (n8n, the
// mobile app, etc). Run with: `yarn api-keys <command> [...args]`.
//
// Users can also do all of this themselves at Settings > API keys in the web
// app (src/app/api/me/api-keys). This script is for admin/ops use.
//
// The raw key is only ever shown once, at creation time — it is not
// recoverable afterwards, matching how the collection stores only its hash
// (src/models/ApiKey.ts). If it's lost, revoke it and create a new one.
//
// Usage:
//   yarn api-keys create --label mobile --email amegh@oppam.me [--expires-days 90]
//   yarn api-keys list
//   yarn api-keys revoke --id <apiKeyId>
import connectDB from "../src/lib/mongodb";
import ApiKey from "../src/models/ApiKey";
import User from "../src/models/User";
import { API_KEY_EXPIRY_DAYS, expiryFromDays, generateApiKey } from "../src/lib/integrations/api-keys";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) continue;
    out[flag.slice(2)] = argv[i + 1] ?? "";
  }
  return out;
}

async function create(args: Record<string, string>) {
  const { label, email } = args;
  if (!label || !email) {
    console.error("Usage: yarn api-keys create --label <name> --email <user-email> [--expires-days <7|30|90|365>]");
    process.exit(1);
  }
  const expiresDays = args["expires-days"] ? Number(args["expires-days"]) : null;
  if (expiresDays !== null && !(API_KEY_EXPIRY_DAYS as readonly number[]).includes(expiresDays)) {
    console.error(`--expires-days must be one of: ${API_KEY_EXPIRY_DAYS.join(", ")}`);
    process.exit(1);
  }
  const user = await User.findOne({ email: email.toLowerCase(), isActive: true });
  if (!user) {
    console.error(`No active user found for email: ${email}`);
    process.exit(1);
  }

  const { rawKey, keyHash, lastFour } = generateApiKey();
  const apiKey = await ApiKey.create({
    user: user._id,
    label,
    keyHash,
    lastFour,
    expiresAt: expiryFromDays(expiresDays),
    createdVia: "cli",
  });

  console.log(`\nCreated API key "${label}" for ${email} (id: ${apiKey._id}).`);
  console.log(`\nRaw key (shown once, store it now):\n\n  ${rawKey}\n`);
  console.log(`Use it as: Authorization: Bearer ${rawKey}\n`);
}

async function list() {
  const keys = await ApiKey.find().populate("user", "email").sort({ createdAt: -1 }).lean();
  if (keys.length === 0) {
    console.log("No API keys.");
    return;
  }
  for (const k of keys) {
    const user = k.user as unknown as { email?: string } | null;
    console.log(
      `${k._id}  ${k.revoked ? "[revoked]" : "[active] "}  label=${k.label}  user=${user?.email ?? "?"}  ` +
        `...${k.lastFour}  expires=${k.expiresAt ?? "never"}  lastUsed=${k.lastUsedAt ?? "never"}  created=${k.createdAt}`
    );
  }
}

async function revoke(args: Record<string, string>) {
  const { id } = args;
  if (!id) {
    console.error("Usage: yarn api-keys revoke --id <apiKeyId>");
    process.exit(1);
  }
  const result = await ApiKey.updateOne({ _id: id }, { $set: { revoked: true, revokedAt: new Date() } });
  if (result.matchedCount === 0) {
    console.error(`No API key found with id: ${id}`);
    process.exit(1);
  }
  console.log(`Revoked API key ${id}.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  await connectDB();

  switch (command) {
    case "create":
      await create(args);
      break;
    case "list":
      await list();
      break;
    case "revoke":
      await revoke(args);
      break;
    default:
      console.error("Usage: yarn api-keys <create|list|revoke> [...flags]");
      process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
