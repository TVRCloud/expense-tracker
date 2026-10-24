import { z } from "zod";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf } from "@/lib/integrations/write-helpers";
import { type BackupBucket, backupBusy, backupFailure, refundBackupBuckets, backupRateLimited, readBackupBody } from "@/lib/integrations/backup-http";
import { BackupError, backupEnvelopeSchema, decryptBackup, envelopeDigest, passphraseSchema, withKeyGate } from "@/lib/backup-crypto";
import { parsePayload, restoreBackup } from "@/lib/backup-service";

const bodySchema = z.object({
  passphrase: passphraseSchema,
  backup: backupEnvelopeSchema,
  dryRun: z.boolean().optional(),
  // Only "merge" exists: rows already here are kept, nothing is deleted or overwritten.
  mode: z.literal("merge").optional(),
});

// POST /api/integrations/backup/restore — restore a file made by POST /backup.
// `dryRun: true` reads and checks the file and reports what would be added,
// writing nothing, with no Idempotency-Key. A real restore needs one. The file
// is opened with the passphrase on every call, a replay included, so a wrong
// passphrase never gets an old answer back.
export const POST = withIntegrationRoute("backup-restore", async ({ req, user, requestId }) => {
  const counted: BackupBucket[] = [];
  let started = false;
  try {
    // Busy first, so a busy answer does not use up one of the caller's request slots.
    const busy = backupBusy(requestId);
    if (busy) return busy;
    const early = await backupRateLimited(user.id, "request", requestId);
    if (early) return early;
    counted.push("request");
    const read = await readBackupBody(req, requestId, user.id);
    if (!read.ok) {
      if (read.refund) await refundBackupBuckets(user.id, counted);
      return read.res;
    }
    const parsed = bodySchema.safeParse(read.body);
    if (!parsed.success) {
      const envelopeBad = parsed.error.issues.some((i) => i.path[0] === "backup");
      return integrationError(
        "VALIDATION_ERROR",
        envelopeBad ? "This is not a backup file this server can read" : "A passphrase of 12 to 256 characters is required",
        requestId,
        envelopeBad ? { reason: "invalid" } : undefined
      );
    }
    const { passphrase, backup, dryRun = false } = parsed.data;

    const key = idempotencyKeyOf(req);
    if (!dryRun && !key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);

    const bucket = dryRun ? "dryRun" : "restore";
    const limited = await backupRateLimited(user.id, bucket, requestId);
    if (limited) return limited;
    counted.push(bucket);

    // A key slot is held before the file is opened or the database touched, so "busy"
    // comes back first; once work has started nothing is given back.
    return await withKeyGate(async () => {
      started = true;
      const payload = parsePayload(await decryptBackup(backup, passphrase));
      if (dryRun) return integrationOk(await restoreBackup(user.id, payload, { dryRun: true }), requestId);

      const outcome = await withIdempotency({
        userId: user.id,
        endpoint: "integrations:backup-restore:POST",
        key: key!,
        body: { backup: envelopeDigest(backup), mode: "merge" },
        execute: async () => {
          const report = await restoreBackup(user.id, payload, { dryRun: false });
          return { status: 200, body: report as unknown as Record<string, unknown> };
        },
      });
      if (outcome.kind === "conflict") {
        return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
      }
      return integrationOk(outcome.body, requestId, { status: outcome.status });
    });
  } catch (err) {
    if (!started && err instanceof BackupError && err.reason === "busy") await refundBackupBuckets(user.id, counted);
    return backupFailure(err, requestId, "backup-restore");
  }
});
