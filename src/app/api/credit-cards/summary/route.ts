import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { computeUtilization, getDueDateStatus } from "@/lib/credit-card";
import { getCardCycleBalances } from "@/lib/credit-balance";
import { checkCreditDueNotifications } from "@/lib/credit-notifications";
import { type ICreditMeta } from "@/types/models";
import { redis } from "@/lib/redis";

function cacheKey(userId: string) {
  return `credit-summary:${userId}`;
}

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    try {
      const cached = await redis?.get(cacheKey(user.id));
      if (cached) return NextResponse.json({ data: JSON.parse(cached) });
    } catch {
      // Redis unavailable — continue without cache
    }

    await connectDB();

    const cards = await Account.find({
      user: user.id,
      type: "credit_card",
      isArchived: false,
    }).lean();

    if (cards.length === 0) {
      return NextResponse.json({
        data: {
          totalDebt: 0,
          totalPayableStatementDue: 0,
          totalUnbilledUsage: 0,
          totalCreditExposure: 0,
          totalAvailableCredit: 0,
          cards: [],
        },
      });
    }

    const cardSummaries = await Promise.all(
      cards.map(async (card) => {
        const meta = card.creditMeta as {
          billingCycleDay?: number;
          paymentDueDay?: number;
          creditLimit?: number;
          minPaymentPct?: number;
          network?: string;
          lastFourDigits?: string;
        } | undefined;

        if (!meta?.billingCycleDay || !meta?.paymentDueDay) {
          return {
            accountId: String(card._id),
            name: card.name,
            balance: 0,
            unbilledUsage: 0,
            payableStatementDue: 0,
            creditLimit: meta?.creditLimit ?? 0,
            utilization: 0,
            nextDueDate: null,
            daysUntilDue: null,
            isOverdue: false,
            status: "unconfigured",
            network: meta?.network,
            lastFourDigits: meta?.lastFourDigits,
          };
        }

        const config = {
          billingCycleDay: meta.billingCycleDay,
          paymentDueDay: meta.paymentDueDay,
          creditLimit: meta.creditLimit ?? 0,
          minPaymentPct: meta.minPaymentPct ?? 2,
        };

        const { currentCycle: cycle, unbilledUsage, pastCycles: payableStatements } = await getCardCycleBalances(
          user.id,
          String(card._id),
          config
        );

        // Fire-and-forget notification check (non-blocking) — reuses the
        // balances just computed above instead of redoing the same queries.
        void checkCreditDueNotifications(
          user.id,
          String(card._id),
          card.name,
          meta as ICreditMeta,
          { currentCycle: cycle, unbilledUsage, pastCycles: payableStatements }
        );

        const unpaidStatements = payableStatements
          .filter((statement) => statement.remainingDue > 0)
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
        const payableStatementDue = unpaidStatements.reduce((sum, statement) => sum + statement.remainingDue, 0);
        const balance = unbilledUsage + payableStatementDue;
        const utilization = computeUtilization(balance, config.creditLimit);
        const nextPayable = unpaidStatements[0] ?? null;
        const dueStatus = nextPayable ? getDueDateStatus(nextPayable.dueDate) : null;

        return {
          accountId: String(card._id),
          name: card.name,
          balance,
          unbilledUsage,
          payableStatementDue,
          creditLimit: config.creditLimit,
          utilization,
          nextDueDate: nextPayable ? nextPayable.dueDate.toISOString() : null,
          daysUntilDue: dueStatus?.daysUntilDue ?? null,
          isOverdue: dueStatus?.isOverdue ?? false,
          status: nextPayable ? (dueStatus?.isOverdue ? "overdue" : "closed") : "open",
          network: meta.network,
          lastFourDigits: meta.lastFourDigits,
        };
      })
    );

    const totalPayableStatementDue = cardSummaries.reduce((s, c) => s + (c.payableStatementDue ?? 0), 0);
    const totalUnbilledUsage = cardSummaries.reduce((s, c) => s + (c.unbilledUsage ?? 0), 0);
    const totalCreditExposure = totalPayableStatementDue + totalUnbilledUsage;
    const totalCreditLimit = cardSummaries.reduce((s, c) => s + c.creditLimit, 0);
    const totalAvailableCredit = Math.max(0, totalCreditLimit - totalCreditExposure);
    const totalDebt = totalCreditExposure;

    const data = {
      totalDebt,
      totalPayableStatementDue,
      totalUnbilledUsage,
      totalCreditExposure,
      totalAvailableCredit,
      cards: cardSummaries,
    };

    try {
      // Short TTL rather than invalidate-on-write — same convention as
      // stats-service.ts. This data changes with every transaction, so a
      // long-lived cache would need writes updated in many places; 60s
      // keeps it fresh enough while still cutting the query load way down
      // on repeated dashboard loads.
      await redis?.setex(cacheKey(user.id), 60, JSON.stringify(data));
    } catch {
      // Redis unavailable — response still returned below
    }

    return NextResponse.json({ data });
  } catch (err) {
    logger.error({ err }, "GET /api/credit-cards/summary failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
