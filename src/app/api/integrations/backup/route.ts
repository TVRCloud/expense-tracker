import { z } from "zod";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import {
  type BackupBucket,
  backupBusy,
  backupFailure,
  backupRateLimited,
  readBackupBody,
  refundBackupBuckets,
} from "@/lib/integrations/backup-http";
import { buildBackup } from "@/lib/backup-service";
import {
  BackupError,
  estimatedResponseBytes,
  MAX_RESPONSE_BYTES,
  packBackup,
  passphraseSchema,
  sealPacked,
  withKeyGate,
} from "@/lib/backup-crypto";

const bodySchema = z.object({ passphrase: passphraseSchema });

// POST /api/integrations/backup — an encrypted copy of the caller's data.
// POST because the passphrase must travel in the body, never in a URL. It
// reads and writes nothing, so it takes no Idempotency-Key. The passphrase is
// used for this call only: it is not stored and not logged.
export const POST = withIntegrationRoute("backup", async ({ req, user, requestId }) => {
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
      return integrationError("VALIDATION_ERROR", "A passphrase of 12 to 256 characters is required", requestId);
    }
    const limited = await backupRateLimited(user.id, "export", requestId);
    if (limited) return limited;
    counted.push("export");

    // A key slot is held before any database or compression work starts, so "busy"
    // comes back first; once work has started nothing is given back.
    return await withKeyGate(async () => {
      started = true;
      const { payload, counts, omitted } = await buildBackup(user.id);
      const packed = await packBackup(payload);
      // Refuse before the (slow, memory hungry) encryption if the answer could not be sent.
      if (estimatedResponseBytes(packed.length) > MAX_RESPONSE_BYTES) {
        throw new BackupError(
          "too_large_for_response",
          "This backup is too large to send in one response (the limit is about 4 MB). Export your transactions as a CSV file instead."
        );
      }
      const backup = await sealPacked(packed, parsed.data.passphrase, { createdAt: payload.createdAt });
      return integrationOk({ backup, createdAt: payload.createdAt, counts, omitted }, requestId);
    });
  } catch (err) {
    if (!started && err instanceof BackupError && err.reason === "busy") await refundBackupBuckets(user.id, counted);
    return backupFailure(err, requestId, "backup");
  }
});
