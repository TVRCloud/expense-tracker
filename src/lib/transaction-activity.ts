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
  // $ifNull, not `$ne: ["$paidAt", null]`: a *missing* paidAt is not equal
  // to null in aggregation expressions, so the old test picked "$paidAt"
  // for paid installments that had none, leaving them without an activity
  // date — dropped from monthly stats and sorted last in lists.
  return {
    activityDate: {
      $cond: [{ $eq: ["$installmentStatus", "paid"] }, { $ifNull: ["$paidAt", "$date"] }, "$date"],
    },
  };
}
