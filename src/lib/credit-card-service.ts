import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import CreditStatement from "@/models/CreditStatement";
import type { AuthUser } from "@/lib/auth-guard";
import { appendLedgerBlock } from "@/lib/ledger";
import {
  computeMinPayment,
  computeUtilization,
  getCurrentCycle,
  getDueDateForStatementClose,
  getDueDateStatus,
  getPastCycles,
} from "@/lib/credit-card";
import { computeCycleBalancesForRanges, getCardCycleBalances } from "@/lib/credit-balance";
import { checkCreditDueNotifications } from "@/lib/credit-notifications";
import { type ICreditMeta } from "@/types/models";
import { redis } from "@/lib/redis";
import { runInBackground } from "@/lib/perf/background";

// Shared by GET /api/credit-cards/* (browser) and GET /api/integrations/credit-cards/*
// (Android app) so both report the same dues and statements.

function summaryCacheKey(userId: string) {
  return `credit-summary:${userId}`;
}

type CardMeta = {
  billingCycleDay?: number;
  paymentDueDay?: number;
  creditLimit?: number;
  minPaymentPct?: number;
  network?: string;
  lastFourDigits?: string;
};

export async function getCreditSummary(userId: string) {
  try {
    const cached = await redis?.get(summaryCacheKey(userId));
    if (cached) return JSON.parse(cached);
  } catch {
    // Redis unavailable — continue without cache
  }

  await connectDB();

  const cards = await Account.find({ user: userId, type: "credit_card", isArchived: false }).lean();

  if (cards.length === 0) {
    return {
      totalDebt: 0,
      totalPayableStatementDue: 0,
      totalUnbilledUsage: 0,
      totalCreditExposure: 0,
      totalAvailableCredit: 0,
      cards: [],
    };
  }

  const cardSummaries = await Promise.all(
    cards.map(async (card) => {
      const meta = card.creditMeta as CardMeta | undefined;

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
        userId,
        String(card._id),
        config
      );

      // Notification check after the response — reuses the balances just
      // computed above instead of redoing the same queries.
      runInBackground("credit-due-notifications", () =>
        checkCreditDueNotifications(userId, String(card._id), card.name, meta as ICreditMeta, {
          currentCycle: cycle,
          unbilledUsage,
          pastCycles: payableStatements,
        })
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

  const data = {
    totalDebt: totalCreditExposure,
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
    await redis?.setex(summaryCacheKey(userId), 60, JSON.stringify(data));
  } catch {
    // Redis unavailable — response still returned below
  }

  return data;
}

export class CreditCardServiceError extends Error {
  code: "ACCOUNT_NOT_FOUND" | "NOT_A_CREDIT_CARD";
  constructor(code: "ACCOUNT_NOT_FOUND" | "NOT_A_CREDIT_CARD", message: string) {
    super(message);
    this.code = code;
    this.name = "CreditCardServiceError";
  }
}

// Statements for one card plus its open cycle. Lazily creates a statement
// record for every closed cycle that lacks one (and appends a ledger block),
// so a read can write: both routes have always behaved this way.
export async function getCardStatements(actor: AuthUser, accountId: string) {
  const userId = actor.id;
  await connectDB();

  const account = await Account.findOne({ _id: accountId, user: userId }).lean();
  if (!account) throw new CreditCardServiceError("ACCOUNT_NOT_FOUND", "Not found");
  if (account.type !== "credit_card") {
    throw new CreditCardServiceError("NOT_A_CREDIT_CARD", "Not a credit card account");
  }

  const meta = account.creditMeta as CardMeta | undefined;

  if (!meta?.billingCycleDay || !meta?.paymentDueDay) {
    return { data: [], currentCycle: null, message: "Billing cycle not configured" };
  }

  const config = {
    billingCycleDay: meta.billingCycleDay,
    paymentDueDay: meta.paymentDueDay,
    creditLimit: meta.creditLimit ?? 0,
    minPaymentPct: meta.minPaymentPct ?? 2,
  };

  // Fire-and-forget notification checks (non-blocking)
  void checkCreditDueNotifications(userId, accountId, account.name, meta as ICreditMeta);

  // Current open cycle (no DB record)
  const current = getCurrentCycle(config);

  // Past 12 closed cycles
  const pastCycles = getPastCycles(config, 12);

  // Lazy-create statement records for past cycles that don't have one yet
  for (const cycle of pastCycles) {
    const existingStatement = await CreditStatement.findOne({
      account: new Types.ObjectId(accountId),
      periodStart: cycle.periodStart,
      isDeleted: { $ne: true },
    });
    if (!existingStatement) {
      const statement = await CreditStatement.create({
        user: new Types.ObjectId(userId),
        account: new Types.ObjectId(accountId),
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        dueDate: cycle.dueDate,
        status: cycle.dueDate < new Date() ? "overdue" : "closed",
        isPaid: false,
        paidAmount: 0,
      });
      await appendLedgerBlock({
        userId,
        scope: "credit_statement",
        entityId: statement._id.toString(),
        action: "create",
        after: statement,
        actor,
      });
    }
  }

  // Fetch all statement records
  const statements = await CreditStatement.find({
    account: new Types.ObjectId(accountId),
    user: userId,
    isDeleted: { $ne: true },
  })
    .sort({ periodStart: -1 })
    .lean();

  // Enrich with computed balance — one batched query covering the current
  // open cycle plus every statement's period, instead of one aggregate
  // per statement.
  const ranges = [
    { periodStart: current.periodStart, periodEnd: current.periodEnd },
    ...statements.map((s) => ({ periodStart: new Date(s.periodStart), periodEnd: new Date(s.periodEnd) })),
  ];
  const [currentBalance, ...statementBalances] = await computeCycleBalancesForRanges(userId, accountId, ranges);

  const enriched = statements.map((s, i) => {
    const statementBalance = statementBalances[i]!;
    const paidAmount = s.paidAmount ?? 0;
    const remainingDue = Math.max(0, statementBalance - paidAmount);
    const minPayment = computeMinPayment(remainingDue, config.minPaymentPct);
    const dueDate = getDueDateForStatementClose(config.paymentDueDay, new Date(s.periodEnd));
    const isPayable = remainingDue > 0;

    // Auto-update status if stale
    let status = s.status as string;
    if (remainingDue === 0) {
      status = "paid";
    } else {
      const now = new Date();
      if (dueDate < now) status = "overdue";
      else if (new Date(s.periodEnd) < now) status = "closed";
    }

    return {
      ...s,
      dueDate,
      balance: statementBalance,
      statementBalance,
      paidAmount,
      remainingDue,
      isPayable,
      isPaid: remainingDue === 0,
      minPayment,
      status,
    };
  });

  // Hide empty cycles — no transactions and never paid
  const filtered = enriched.filter((s) => s.statementBalance > 0 || s.paidAmount > 0);
  const payableStatementDue = filtered.reduce((sum, statement) => sum + statement.remainingDue, 0);

  return {
    data: filtered,
    currentCycle: {
      balance: currentBalance,
      unbilledUsage: currentBalance,
      payableStatementDue,
      totalOutstanding: currentBalance + payableStatementDue,
      minPayment: 0,
      periodStart: current.periodStart.toISOString(),
      periodEnd: current.periodEnd.toISOString(),
      dueDate: current.dueDate.toISOString(),
      label: current.label,
    },
  };
}
