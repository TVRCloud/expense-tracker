import connectDB from "@/lib/mongodb";
import PushSubscription from "@/models/PushSubscription";
import Account from "@/models/Account";
import { checkEmiDueNotifications } from "./emi-notifications";
import { checkCreditDueNotifications } from "./credit-notifications";
import logger from "./logger";
import type { ICreditMeta } from "@/types/models";

export async function runReminderChecks(): Promise<void> {
  try {
    await connectDB();
    const userIds = await PushSubscription.find({ isActive: true }).distinct("user");
    logger.info(`runReminderChecks: checking ${userIds.length} user(s)`);

    for (const userId of userIds) {
      const id = String(userId);

      void checkEmiDueNotifications(id).catch((err) =>
        logger.error({ err }, `EMI check failed for user ${id}`)
      );

      const creditAccounts = await Account.find({
        user: userId,
        type: "credit_card",
        isDeleted: { $ne: true },
      }).lean<Array<{ _id: unknown; name: string; creditMeta?: ICreditMeta }>>();

      for (const acct of creditAccounts) {
        if (acct.creditMeta?.billingCycleDay) {
          void checkCreditDueNotifications(
            id,
            String(acct._id),
            acct.name,
            acct.creditMeta
          ).catch((err) =>
            logger.error({ err }, `Credit check failed for account ${String(acct._id)}`)
          );
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "runReminderChecks failed");
  }
}
