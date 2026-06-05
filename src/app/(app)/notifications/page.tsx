import { NotificationsClient } from "@/features/notifications/components/NotificationsClient";

export const metadata = { title: "Notifications — Finance OS" };

export default function NotificationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <NotificationsClient />
    </div>
  );
}
