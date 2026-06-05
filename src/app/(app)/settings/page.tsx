import { SettingsClient } from "@/features/settings/components/SettingsClient";

export const metadata = { title: "Settings — Finance OS" };

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsClient />
    </div>
  );
}
