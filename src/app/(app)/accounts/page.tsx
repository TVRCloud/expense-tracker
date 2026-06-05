import { AccountsClient } from "@/features/accounts/components/AccountsClient";

export const metadata = { title: "Accounts — Finance OS" };

export default function AccountsPage() {
  return (
    <div className="flex flex-col gap-6">
      <AccountsClient />
    </div>
  );
}
