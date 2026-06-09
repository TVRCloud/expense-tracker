import { createHash } from "crypto";
import connectDB from "@/lib/mongodb";
import type { AuthUser } from "@/lib/auth-guard";
import Account from "@/models/Account";
import Budget from "@/models/Budget";
import CreditStatement from "@/models/CreditStatement";
import Goal from "@/models/Goal";
import LedgerBackfill from "@/models/LedgerBackfill";
import LedgerBlock from "@/models/LedgerBlock";
import Loan from "@/models/Loan";
import Repayment from "@/models/Repayment";
import Transaction from "@/models/Transaction";

export type LedgerScope =
  | "transaction"
  | "account"
  | "budget"
  | "goal"
  | "loan"
  | "repayment"
  | "credit_statement";

export type LedgerAction = "import" | "create" | "update" | "delete" | "restore" | "system";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type AppendLedgerBlockInput = {
  userId: string;
  scope: LedgerScope;
  entityId: string;
  action: LedgerAction;
  before?: unknown;
  after?: unknown;
  actor?: AuthUser;
  idempotencyKey?: string;
};

type LedgerBlockRecord = {
  sequence: number;
  scope: LedgerScope;
  entityId: string;
  action: LedgerAction;
  before?: unknown;
  after?: unknown;
  actor?: unknown;
  previousHash: string;
  hash: string;
  createdAt: Date | string;
};

const GENESIS_HASH = "0".repeat(64);
const MAX_APPEND_RETRIES = 5;
const BACKFILL_VERSION = 1;

export const LEDGER_SCOPES: LedgerScope[] = [
  "account",
  "budget",
  "credit_statement",
  "goal",
  "loan",
  "repayment",
  "transaction",
];

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasToHexString(value: unknown): value is { toHexString: () => string } {
  return isObjectRecord(value) && typeof value.toHexString === "function";
}

function hasToObject(value: unknown): value is { toObject: () => unknown } {
  return isObjectRecord(value) && typeof value.toObject === "function";
}

function normalizeForLedger(value: unknown): JsonValue {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (value instanceof Date) return value.toISOString();
  if (hasToHexString(value)) return value.toHexString();
  if (hasToObject(value)) return normalizeForLedger(value.toObject());
  if (Array.isArray(value)) return value.map((item) => normalizeForLedger(item));

  if (isObjectRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, JsonValue>>((acc, key) => {
        if (typeof value[key] !== "undefined") {
          acc[key] = normalizeForLedger(value[key]);
        }
        return acc;
      }, {});
  }

  return String(value);
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalizeForLedger(value));
}

function hashLedgerBlock(input: {
  userId: string;
  sequence: number;
  scope: LedgerScope;
  entityId: string;
  action: LedgerAction;
  before?: unknown;
  after?: unknown;
  actor?: unknown;
  previousHash: string;
  createdAt: string;
}) {
  return createHash("sha256").update(canonicalStringify(input)).digest("hex");
}

function actorSnapshot(actor?: AuthUser) {
  if (!actor) return undefined;
  return {
    id: actor.id,
    name: actor.name,
    email: actor.email,
    role: actor.role,
  };
}

function isDuplicateKeyError(error: unknown) {
  return isObjectRecord(error) && error.code === 11000;
}

export async function appendLedgerBlock(input: AppendLedgerBlockInput) {
  await connectDB();

  if (input.idempotencyKey) {
    const existing = await LedgerBlock.findOne({
      user: input.userId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) return existing;
  }

  const before = normalizeForLedger(input.before);
  const after = normalizeForLedger(input.after);
  const actor = actorSnapshot(input.actor);

  for (let attempt = 0; attempt < MAX_APPEND_RETRIES; attempt += 1) {
    const latest = await LedgerBlock.findOne({ user: input.userId })
      .sort({ sequence: -1 })
      .lean<{ sequence: number; hash: string }>();
    const sequence = (latest?.sequence ?? 0) + 1;
    const previousHash = latest?.hash ?? GENESIS_HASH;
    const createdAt = new Date();
    const hash = hashLedgerBlock({
      userId: input.userId,
      sequence,
      scope: input.scope,
      entityId: input.entityId,
      action: input.action,
      before,
      after,
      actor,
      previousHash,
      createdAt: createdAt.toISOString(),
    });

    try {
      return await LedgerBlock.create({
        user: input.userId,
        sequence,
        scope: input.scope,
        entityId: input.entityId,
        action: input.action,
        before,
        after,
        actor,
        previousHash,
        hash,
        idempotencyKey: input.idempotencyKey,
        createdAt,
        updatedAt: createdAt,
      });
    } catch (error) {
      if (input.idempotencyKey) {
        const existing = await LedgerBlock.findOne({
          user: input.userId,
          idempotencyKey: input.idempotencyKey,
        });
        if (existing) return existing;
      }
      if (isDuplicateKeyError(error) && attempt < MAX_APPEND_RETRIES - 1) continue;
      throw error;
    }
  }

  throw new Error("Unable to append ledger block");
}

export async function verifyLedgerChain(userId: string) {
  await connectDB();

  const blocks = await LedgerBlock.find({ user: userId })
    .sort({ sequence: 1 })
    .lean<LedgerBlockRecord[]>();

  let previousHash = GENESIS_HASH;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const expectedSequence = index + 1;

    if (block.sequence !== expectedSequence) {
      return {
        valid: false,
        checkedBlocks: index,
        failedAtSequence: block.sequence,
        reason: `Expected sequence ${expectedSequence}, received ${block.sequence}`,
      };
    }

    if (block.previousHash !== previousHash) {
      return {
        valid: false,
        checkedBlocks: index,
        failedAtSequence: block.sequence,
        reason: "Previous hash does not match the prior block",
      };
    }

    const computedHash = hashLedgerBlock({
      userId,
      sequence: block.sequence,
      scope: block.scope,
      entityId: block.entityId,
      action: block.action,
      before: block.before,
      after: block.after,
      actor: block.actor,
      previousHash: block.previousHash,
      createdAt: new Date(block.createdAt).toISOString(),
    });

    if (computedHash !== block.hash) {
      return {
        valid: false,
        checkedBlocks: index,
        failedAtSequence: block.sequence,
        reason: "Block hash does not match its contents",
      };
    }

    previousHash = block.hash;
  }

  return {
    valid: true,
    checkedBlocks: blocks.length,
    latestHash: previousHash,
  };
}

async function importScope(
  userId: string,
  scope: LedgerScope,
  records: Array<{ _id: unknown }>
) {
  for (const record of records) {
    const entityId = String(record._id);
    await appendLedgerBlock({
      userId,
      scope,
      entityId,
      action: "import",
      after: record,
      idempotencyKey: `import:${scope}:${entityId}`,
    });
  }
}

export async function ensureLedgerBackfill(userId: string) {
  await connectDB();
  const completed = await LedgerBackfill.findOne({ user: userId, version: BACKFILL_VERSION }).lean();
  if (completed) return { created: false };

  const [accounts, budgets, creditStatements, goals, loans, repayments, transactions] =
    await Promise.all([
      Account.find({ user: userId }).lean<Array<{ _id: unknown }>>(),
      Budget.find({ user: userId }).lean<Array<{ _id: unknown }>>(),
      CreditStatement.find({ user: userId }).lean<Array<{ _id: unknown }>>(),
      Goal.find({ user: userId }).lean<Array<{ _id: unknown }>>(),
      Loan.find({ user: userId }).lean<Array<{ _id: unknown }>>(),
      Repayment.find({ user: userId }).lean<Array<{ _id: unknown }>>(),
      Transaction.find({ user: userId }).lean<Array<{ _id: unknown }>>(),
    ]);

  await importScope(userId, "account", accounts);
  await importScope(userId, "budget", budgets);
  await importScope(userId, "credit_statement", creditStatements);
  await importScope(userId, "goal", goals);
  await importScope(userId, "loan", loans);
  await importScope(userId, "repayment", repayments);
  await importScope(userId, "transaction", transactions);

  await LedgerBackfill.findOneAndUpdate(
    { user: userId, version: BACKFILL_VERSION },
    { $set: { scopes: LEDGER_SCOPES, completedAt: new Date() } },
    { upsert: true, new: true }
  );

  return { created: true };
}
