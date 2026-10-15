import { TransactionsClient } from "@/features/transactions/components/TransactionsClient";

export const metadata = { title: "Transactions — Finance OS" };

type SearchParams = Promise<{ accountId?: string }>;

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const { accountId } = await searchParams;

  return <TransactionsClient accountId={accountId} />;
}
