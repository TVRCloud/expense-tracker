import { z } from "zod";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf } from "@/lib/integrations/write-helpers";
import { backupFailure, backupRateLimited, readBackupBody } from "@/lib/integrations/backup-http";
import { backupEnvelopeSchema, decryptBackup, envelopeDigest, passphraseSchema } from "@/lib/backup-crypto";
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
  try {
    const early = await backupRateLimited(user.id, "request", requestId);
    if (early) return early;
    const read = await readBackupBody(req, requestId);
    if (!read.ok) return read.res;
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

    const limited = await backupRateLimited(user.id, dryRun ? "dryRun" : "restore", requestId);
    if (limited) return limited;

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
  } catch (err) {
    return backupFailure(err, requestId, "backup-restore");
  }
});
