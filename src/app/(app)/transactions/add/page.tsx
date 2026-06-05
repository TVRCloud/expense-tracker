import { AddTransactionForm } from "@/features/transactions/components/AddTransactionForm";

export const metadata = { title: "Add Transaction — Finance OS" };

export default function AddTransactionPage() {
  return (
    <div className="flex flex-col gap-6">
      <AddTransactionForm />
    </div>
  );
}
