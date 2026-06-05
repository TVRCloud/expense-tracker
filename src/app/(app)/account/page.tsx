import { AccountClient } from "@/features/settings/components/AccountClient";

export const metadata = { title: "Account — Finance OS" };

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <AccountClient />
    </div>
  );
}
