"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, Trash2 } from "lucide-react";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import apiClient from "@/lib/api-client";
import { type INotification } from "@/types/models";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/_ui/Button";
import { toast } from "sonner";
import { NOTIFICATION_TYPE_ICONS, NOTIFICATION_TYPE_COLORS } from "@/lib/icons";

// Every notification producer (budget-alert.ts, emi-notifications.ts,
// credit-notifications.ts) already writes a routable id into `meta` — this
// maps notification type to where tapping it should land.
function notificationHref(n: INotification): string | null {
  const meta = n.meta ?? {};
  switch (n.type) {
    case "transaction":
    case "emi_due":
      return meta.transactionId ? `/transactions/${meta.transactionId}` : null;
    case "credit_due":
    case "credit_overdue":
      return meta.accountId ? `/accounts/${meta.accountId}` : null;
    case "budget_alert":
      return "/budgets";
    case "loan_due":
      return "/loans";
    case "goal_reached":
      return "/goals";
    case "system":
      // Captured bank messages that need review (src/lib/capture/ingest.ts),
      // plus older "Message needs review" rows from the old SMS queue.
      return meta.captureId || meta.smsReviewItemId ? "/reconcile" : null;
    default:
      return null;
  }
}

function useNotifications() {
  return useQuery<{ data: INotification[]; unreadCount: number }>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: INotification[]; unreadCount: number }>("/notifications?limit=50");
      return res.data;
    },
  });
}

export function NotificationsClient() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data, isLoading } = useNotifications();

  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/notifications/${id}`, { isRead: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const deleteNotif = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/notifications/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Notification deleted");
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => apiClient.post("/notifications/read-all"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("All marked as read");
    },
  });

  const notifications = data?.data ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const groups: { label: string; items: INotification[] }[] = [];
  for (const n of notifications) {
    const d = new Date(n.createdAt);
    const label = isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEEE, d MMM");
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  const markAllButton = unreadCount > 0 && (
    <Button
      type="button"
      variant="secondary"
      onClick={() => markAllRead.mutate()}
      disabled={markAllRead.isPending}
      className="h-auto flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-full"
    >
      <CheckCheck size={15} />
      Mark all read
    </Button>
  );

  return (
    <div className="page-stack">
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
        actions={markAllButton}
      />

      {isLoading ? (
        <div className="flex flex-col gap-3 max-w-3xl">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-(--r-md)" />)}
        </div>
      ) : notifications.length === 0 ? (
        <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-20">
          <div className="w-16 h-16 rounded-full grid place-items-center" style={{ background: "var(--card-2)" }}>
            <Bell size={28} style={{ color: "var(--ink-3)" }} aria-hidden />
          </div>
          <p style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>No notifications yet</p>
        </Card>
      ) : (
        <div className="page-stack max-w-3xl">
          {groups.map((g) => (
            <section key={g.label}>
              <div className="section-head"><h2>{g.label}</h2></div>
              <div className="inset-group" style={{ "--inset": "68px" } as React.CSSProperties}>
                {g.items.map((n) => {
                  const href = notificationHref(n);
                  const TypeIcon = NOTIFICATION_TYPE_ICONS[n.type] ?? Bell;
                  const open = href
                    ? () => {
                        if (!n.isRead) markRead.mutate(String(n._id));
                        router.push(href);
                      }
                    : undefined;
                  return (
                    <div
                      key={String(n._id)}
                      role={href ? "link" : undefined}
                      tabIndex={href ? 0 : undefined}
                      onClick={open}
                      onKeyDown={open ? (e) => { if (e.key === "Enter") open(); } : undefined}
                      className={`group flex items-start gap-3 pl-4 pr-3 py-3.5 min-h-16${href ? " cursor-pointer transition-colors hover:bg-(--card-2) active:bg-(--card-2) focus-visible:outline-none focus-visible:bg-(--card-2)" : ""}`}
                    >
                      <div className="w-10 h-10 rounded-full grid place-items-center flex-none" style={{ background: "var(--card-2)" }}>
                        <TypeIcon size={18} style={{ color: NOTIFICATION_TYPE_COLORS[n.type] ?? "var(--ink-2)" }} aria-hidden />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {!n.isRead && (
                            <span className="w-2 h-2 rounded-full flex-none" style={{ background: "var(--ink)" }}>
                              <span className="sr-only">Unread</span>
                            </span>
                          )}
                          <span className="truncate" style={{ font: "var(--text-body)", fontWeight: n.isRead ? 500 : 650, color: "var(--ink)" }}>{n.title}</span>
                        </div>
                        <div className="mt-0.5 line-clamp-2" style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>{n.body}</div>
                        <div className="mt-1" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </div>
                      </div>

                      <div className="flex items-center flex-none sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
                        {!n.isRead && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Mark as read"
                            onClick={(e) => { e.stopPropagation(); markRead.mutate(String(n._id)); }}
                            className="rounded-full"
                          >
                            <Check size={16} style={{ color: "var(--green)" }} />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Delete notification"
                          onClick={(e) => { e.stopPropagation(); deleteNotif.mutate(String(n._id)); }}
                          className="rounded-full"
                        >
                          <Trash2 size={15} style={{ color: "var(--red)" }} />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
