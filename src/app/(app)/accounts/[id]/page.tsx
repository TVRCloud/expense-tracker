import { AccountDetailClient } from "@/features/accounts/components/AccountDetailClient";

type Params = Promise<{ id: string }>;

export default async function Page({ params }: { params: Params }) {
  const { id } = await params;
  return <AccountDetailClient id={id} />;
}
