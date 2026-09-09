"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import apiClient from "@/lib/api-client";
import { type INotification } from "@/types/models";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
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

  return (
    <div className="flex flex-col gap-5">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: "var(--ink-2)" }}>
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </span>
        </div>
        {unreadCount > 0 && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="h-auto flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full"
            style={{ color: "var(--violet)" }}
          >
            <CheckCheck size={15} />
            Mark all read
          </Button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-(--r-md)" />)}
        </div>
      ) : notifications.length === 0 ? (
        <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-20">
          <div
            className="w-16 h-16 rounded-full grid place-items-center text-3xl"
            style={{ background: "var(--card-2)" }}
          >
            <Bell size={28} style={{ color: "var(--ink-3)" }} />
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No notifications</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {notifications.map((n) => {
            const href = notificationHref(n);
            return (
            <Card
              key={String(n._id)}
              radius="md"
              className={`flex items-start gap-4 px-4 py-4${href ? " cursor-pointer transition-colors hover:bg-(--card-2)" : ""}`}
              style={{ borderLeft: n.isRead ? "3px solid transparent" : "3px solid var(--violet)" }}
              onClick={href ? () => {
                if (!n.isRead) markRead.mutate(String(n._id));
                router.push(href);
              } : undefined}
            >
              {/* Icon */}
              <div
                className="w-10 h-10 rounded-full grid place-items-center flex-none mt-0.5"
                style={{ background: "var(--card-2)" }}
              >
                {(() => {
                  const TypeIcon = NOTIFICATION_TYPE_ICONS[n.type] ?? Bell;
                  return <TypeIcon size={18} style={{ color: NOTIFICATION_TYPE_COLORS[n.type] ?? "var(--ink-2)" }} />;
                })()}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[14px]" style={{ color: "var(--ink)" }}>
                  {n.title}
                </div>
                <div className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>
                  {n.body}
                </div>
                <div className="text-xs mt-1.5 font-medium" style={{ color: "var(--ink-3)" }}>
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-none">
                {!n.isRead && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Mark as read"
                    onClick={(e) => { e.stopPropagation(); markRead.mutate(String(n._id)); }}
                    className="w-8 h-8 rounded-full"
                    style={{ background: "var(--card-2)" }}
                  >
                    <Check size={15} style={{ color: "var(--green)" }} />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Delete notification"
                  onClick={(e) => { e.stopPropagation(); deleteNotif.mutate(String(n._id)); }}
                  className="w-8 h-8 rounded-full"
                  style={{ background: "var(--card-2)" }}
                >
                  <Trash2 size={14} style={{ color: "var(--red)" }} />
                </Button>
              </div>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
