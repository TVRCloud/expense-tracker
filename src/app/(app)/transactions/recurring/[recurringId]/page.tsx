import { RecurringSeriesClient } from "@/features/recurring/components/RecurringSeriesClient";

export const metadata = { title: "Recurring Series — Finance OS" };

type Params = Promise<{ recurringId: string }>;

export default async function RecurringSeriesPage({ params }: { params: Params }) {
  const { recurringId } = await params;
  return <RecurringSeriesClient recurringId={recurringId} />;
}
