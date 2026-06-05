import { TransactionsClient } from "@/features/transactions/components/TransactionsClient";
import Link from "next/link";
import { Plus } from "lucide-react";

export const metadata = { title: "Transactions — Finance OS" };

type SearchParams = Promise<{ accountId?: string }>;

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const { accountId } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="hidden md:flex items-center justify-between">
        <h1 className="text-2xl font-extrabold" style={{ color: "var(--ink)" }}>
          Transactions
        </h1>
        <Link
          href="/transactions/add"
          className="flex items-center gap-2 rounded-[var(--r-sm)] px-5 py-2.5 text-sm font-bold transition-all hover:opacity-90"
          style={{ background: "var(--fab)", color: "var(--fab-ink)" }}
        >
          <Plus size={17} />
          Add Transaction
        </Link>
      </div>

      <TransactionsClient accountId={accountId} />
    </div>
  );
}
