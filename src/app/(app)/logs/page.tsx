import { LogsClient } from "@/features/logs/components/LogsClient";

export const metadata = { title: "Logs — Finance OS" };

export default function LogsPage() {
  return (
    <div className="flex flex-col gap-6">
      <LogsClient />
    </div>
  );
}
