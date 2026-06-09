export type TransactionActivityInput = {
  date: Date | string;
  recurringId?: unknown;
  installmentStatus?: string;
  paidAt?: Date | string;
};

export function getTransactionActivityDate(transaction: TransactionActivityInput) {
  if (transaction.recurringId && transaction.installmentStatus === "paid" && transaction.paidAt) {
    return new Date(transaction.paidAt);
  }

  return new Date(transaction.date);
}

export function activityDateAddFields() {
  return {
    activityDate: {
      $cond: [
        {
          $and: [
            { $eq: ["$installmentStatus", "paid"] },
            { $ne: ["$paidAt", null] },
          ],
        },
        "$paidAt",
        "$date",
      ],
    },
  };
}
