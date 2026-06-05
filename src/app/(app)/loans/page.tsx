import { LoansClient } from "@/features/loans/components/LoansClient";

export const metadata = { title: "Loans — Finance OS" };

export default function LoansPage() {
  return (
    <div className="flex flex-col gap-6">
      <LoansClient />
    </div>
  );
}
