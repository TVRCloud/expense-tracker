import { GoalsClient } from "@/features/goals/components/GoalsClient";

export const metadata = { title: "Goals — Finance OS" };

export default function GoalsPage() {
  return (
    <div className="flex flex-col gap-6">
      <GoalsClient />
    </div>
  );
}
