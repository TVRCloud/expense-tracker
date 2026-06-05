"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import apiClient from "@/lib/api-client";
import { type INotification } from "@/types/models";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const TYPE_ICONS: Record<string, string> = {
  budget_alert: "⚠️",
  loan_due: "📅",
  goal_reached: "🎯",
  system: "📢",
  transaction: "💳",
};

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
          <button
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full"
            style={{ background: "var(--card)", color: "var(--violet)", boxShadow: "var(--shadow-sm)" }}
          >
            <CheckCheck size={15} />
            Mark all read
          </button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-[var(--r-md)]" />)}
        </div>
      ) : notifications.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-[var(--r-lg)] py-20"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <div
            className="w-16 h-16 rounded-full grid place-items-center text-3xl"
            style={{ background: "var(--card-2)" }}
          >
            <Bell size={28} style={{ color: "var(--ink-3)" }} />
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No notifications</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {notifications.map((n) => (
            <div
              key={String(n._id)}
              className="flex items-start gap-4 rounded-[var(--r-md)] px-4 py-4 transition-all"
              style={{
                background: "var(--card)",
                boxShadow: "var(--shadow-sm)",
                borderLeft: n.isRead ? "3px solid transparent" : "3px solid var(--violet)",
              }}
            >
              {/* Icon */}
              <div
                className="w-10 h-10 rounded-full grid place-items-center text-xl flex-none mt-0.5"
                style={{ background: "var(--card-2)" }}
              >
                {TYPE_ICONS[n.type] ?? "🔔"}
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
                  <button
                    onClick={() => markRead.mutate(String(n._id))}
                    className="w-8 h-8 rounded-full grid place-items-center"
                    style={{ background: "var(--card-2)" }}
                  >
                    <Check size={15} style={{ color: "var(--green)" }} />
                  </button>
                )}
                <button
                  onClick={() => deleteNotif.mutate(String(n._id))}
                  className="w-8 h-8 rounded-full grid place-items-center"
                  style={{ background: "var(--card-2)" }}
                >
                  <Trash2 size={14} style={{ color: "var(--red)" }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
