import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Session from "@/models/Session";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { forgetUserSessions } from "@/lib/perf/session-cache";
import { forgetUserKeys } from "@/lib/integrations/auth";
import { deleteAllReceiptsOfUser } from "@/lib/receipt-service";
import { deleteAaDataForUser, markAllConsentsWithdrawPending, purgeAaRecordsOfDeletedUser } from "@/lib/aa-service";
import { revokeAllSharesOfUser } from "@/lib/share-service";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatar: z.string().url().optional(),
  currency: z.string().optional(),
});

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const profile = await User.findById(user.id).select("-password -passwordResetToken -passwordResetExpires").lean();
    if (!profile) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json({ data: profile });
  } catch (err) {
    logger.error({ err }, "GET /api/me failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    await connectDB();
    const updated = await User.findByIdAndUpdate(
      user.id,
      { $set: parsed.data },
      { new: true }
    ).select("-password -passwordResetToken -passwordResetExpires").lean();

    return NextResponse.json({ data: updated });
  } catch (err) {
    logger.error({ err }, "PATCH /api/me failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Soft-delete: reuses the same `isActive` gate auth-options.ts and the
// integration auth layer already enforce for admin-deactivated users, so a
// self-deleted account is immediately blocked from logging in again without
// any new schema or auth-check plumbing.
export async function DELETE() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const existing = await User.findById(user.id).select("email").lean<{ email: string }>();
    if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });
    // Bank links: withdrawn at the provider first, before anything is deleted for good (a link that cannot be withdrawn stops the deletion here), so nothing keeps reading the account.
    const aa = await deleteAaDataForUser(user.id);
    if (aa.remaining > 0) {
      return NextResponse.json(
        { error: "A bank link could not be withdrawn right now, so the account was not deleted. Remove the link from the Bank links screen, or try again later." },
        { status: 409 }
      );
    }
    // Private receipt images go for good. First, while the account is still active: if this
    // fails the request fails and nothing is locked, so it can simply be tried again.
    await deleteAllReceiptsOfUser(user.id);
    // Household sharing: every share they own or belong to ends now (also retryable while active).
    await revokeAllSharesOfUser(user.id, existing.email);
    // Tombstone the email so the same address can register a fresh account.
    await User.findByIdAndUpdate(user.id, {
      $set: {
        isActive: false,
        deletedAt: new Date(),
        deletedEmail: existing.email,
        email: `deleted+${user.id}@deleted.invalid`,
      },
    });
    // Also terminate every active session immediately (not just future
    // logins) — same mechanism admin-forced logout already relies on, see
    // the jwt() callback in auth-options.ts checking Session.isActive.
    await Session.updateMany({ user: user.id, isActive: true }, { $set: { isActive: false } });
    forgetUserSessions(user.id);
    forgetUserKeys(user.id);
    // Once more, last: catches an invite accepted by a request that was already running.
    await revokeAllSharesOfUser(user.id, existing.email).catch((err) => logger.error({ err, userId: user.id }, "final share revoke failed"));
    // And a receipt added by a request that was already running. The account
    // is locked by now, so a failure here is retried once and then only logged.
    try {
      await deleteAllReceiptsOfUser(user.id);
    } catch {
      await deleteAllReceiptsOfUser(user.id).catch((err) => logger.error({ err, userId: user.id }, "final receipt purge failed"));
    }
    // Same for a bank link added by a request that was already running. The account is gone by now, so whatever
    // still could not be withdrawn is logged (for withdrawing by hand) and its record removed.
    await deleteAaDataForUser(user.id)
      .then(async (r) => {
        if (r.remaining > 0) await purgeAaRecordsOfDeletedUser(user.id);
      })
      .catch(async (err) => {
        logger.error({ err: err instanceof Error ? err.name : "unknown", userId: user.id }, "final bank link purge failed");
        // Hand whatever is left to the sweep (hidden, retried) rather than leave it active with no one reading it.
        await markAllConsentsWithdrawPending(user.id).catch(() => undefined);
      });

    return NextResponse.json({ data: { message: "Account deleted" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/me failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
