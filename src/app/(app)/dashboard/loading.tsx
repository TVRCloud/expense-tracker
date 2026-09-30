import { Skeleton } from "@/components/_ui/Skeleton";

// Streams with the app shell while the dashboard's data is fetched on the
// server (page.tsx), so the first byte never waits on the database. Same
// block sizes as the dashboard's own loading states, so nothing jumps when
// the real content replaces it.
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="rounded-(--r-lg) mb-5" style={{ height: 196 }} />
      <Skeleton className="h-5 w-32 mb-3" />
      <div className="flex gap-3 overflow-hidden mb-5">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="rounded-(--r-lg) flex-none w-62.5" style={{ height: 164 }} />
        ))}
      </div>
      <Skeleton className="h-5 w-44 mb-3" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="rounded-(--r-lg)" style={{ height: 70 }} />
        ))}
      </div>
    </div>
  );
}
