import { BudgetsClient } from "@/features/budgets/components/BudgetsClient";

export const metadata = { title: "Budgets — Finance OS" };

export default function BudgetsPage() {
  return (
    <div className="flex flex-col gap-6">
      <BudgetsClient />
    </div>
  );
}
