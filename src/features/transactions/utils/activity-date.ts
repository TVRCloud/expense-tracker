import { type ITransaction } from "@/types/models";

export function getTransactionActivityDate(transaction: ITransaction) {
  if (
    transaction.recurringId &&
    transaction.installmentStatus === "paid" &&
    transaction.paidAt
  ) {
    return new Date(transaction.paidAt);
  }

  return new Date(transaction.date);
}

export function isPaidRecurringTransaction(transaction: ITransaction) {
  return Boolean(
    transaction.recurringId &&
    transaction.installmentStatus === "paid" &&
    transaction.paidAt
  );
}
