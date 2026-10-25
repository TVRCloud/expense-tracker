import mongoose from "mongoose";
import logger from "@/lib/logger";

// Shared by GET /api/events (browser session) and GET /api/integrations/events
// (mobile app, API key). One MongoDB change stream per SSE connection, opened
// on the whole database and narrowed to the collections below — instead of one
// cursor per collection.

export type RealtimeResource =
  | "transactions"
  | "accounts"
  | "budgets"
  | "goals"
  | "loans"
  | "notifications"
  | "captures"
  | "repayments"
  | "statements"
  | "spendLimits"
  | "subscriptions"
  | "sinkingFunds"
  | "netWorth"
  | "holdings"
  | "anomalies"
  | "aa";

// Allow-list: MongoDB collection name -> resource name sent to clients. Every
// model listed here has a required `user` ObjectId field, which is what the
// stream filters on. Collection names are the explicit ones passed to model()
// in src/models/*.ts (CapturedMessage is "captured_messages").
export const RESOURCES: Readonly<Record<string, RealtimeResource>> = {
  transactions: "transactions",
  accounts: "accounts",
  budgets: "budgets",
  goals: "goals",
  loans: "loans",
  notifications: "notifications",
  captured_messages: "captures",
  repayments: "repayments",
  credit_statements: "statements",
  spend_limits: "spendLimits",
  subscription_decisions: "subscriptions",
  sinking_funds: "sinkingFunds",
  manual_assets: "netWorth",
  aa_consents: "aa",
  anomalies: "anomalies",
  holdings: "holdings",
};

export const RESOURCE_NAMES: readonly RealtimeResource[] = Object.values(RESOURCES);

export function collectionToResource(collection: string | undefined | null): RealtimeResource | null {
  if (!collection) return null;
  return Object.prototype.hasOwnProperty.call(RESOURCES, collection) ? RESOURCES[collection] : null;
}

// Deletes are intentionally NOT watched. A `delete` event carries no
// fullDocument (no pre-images), so it can't be attributed to a user and would
// have to be broadcast to everyone. The app soft-deletes transactions,
// budgets, goals and loans (isDeleted: true -> an `update` carrying `user`),
// and accounts are archived. The only hard delete is a single notification
// (DELETE /api/notifications/:id) plus the 90-day TTL expiry; the acting tab
// invalidates itself, and other tabs catch up on the next refetch/reconnect.
export function buildPipeline(userObjectId: mongoose.Types.ObjectId) {
  return [
    {
      $match: {
        "ns.coll": { $in: Object.keys(RESOURCES) },
        operationType: { $in: ["insert", "update", "replace"] },
        "fullDocument.user": userObjectId,
      },
    },
  ];
}

export interface UserChangeWatcher {
  close: () => Promise<void>;
}

/**
 * Opens ONE change stream on the database for this user. `onChange` is called
 * with the resource that changed; `onError` when the cursor dies (caller should
 * end the SSE response so the client reconnects and refetches).
 */
export function watchUserChanges(
  db: mongoose.mongo.Db,
  userId: string,
  onChange: (resource: RealtimeResource) => void,
  onError: (err: Error) => void
): UserChangeWatcher {
  const cs = db.watch(buildPipeline(new mongoose.Types.ObjectId(userId)), { fullDocument: "updateLookup" });
  cs.on("change", (change) => {
    const coll = (change as { ns?: { coll?: string } }).ns?.coll;
    const resource = collectionToResource(coll);
    if (resource) onChange(resource);
  });
  cs.on("error", (err: Error) => {
    logger.error(`Change stream error: ${err.message}`);
    onError(err);
  });
  let closed = false;
  return {
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await cs.close();
      } catch (err) {
        logger.warn(`Change stream close failed: ${(err as Error).message}`);
      }
    },
  };
}
