import { TransactionDetailClient } from "@/features/transactions/components/TransactionDetailClient";

type Params = Promise<{ id: string }>;

export default async function Page({ params }: { params: Params }) {
  const { id } = await params;
  return <TransactionDetailClient id={id} />;
}
