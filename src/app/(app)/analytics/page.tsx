import { AnalyticsClient } from "@/features/analytics/components/AnalyticsClient";

export const metadata = { title: "Analytics — Finance OS" };

export default function AnalyticsPage() {
  return (
    <div className="flex flex-col gap-6">
      <AnalyticsClient />
    </div>
  );
}
