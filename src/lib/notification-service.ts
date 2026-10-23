import connectDB from "@/lib/mongodb";
import Notification from "@/models/Notification";

// Shared by the browser /api/notifications routes and the integration routes
// so the inbox behaves the same on web and in the app.

export async function listNotifications(
  userId: string,
  opts: { unreadOnly?: boolean; skip?: number; limit?: number } = {}
) {
  const skip = opts.skip ?? 0;
  const limit = Math.min(opts.limit ?? 20, 50);
  const query: Record<string, unknown> = { user: userId };
  if (opts.unreadOnly) query.isRead = false;

  await connectDB();
  const [data, total, unreadCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(query),
    Notification.countDocuments({ user: userId, isRead: false }),
  ]);
  return { data, total, unreadCount, skip, limit };
}

// Returns null when the notification is not this user's.
export async function setNotificationRead(userId: string, id: string, isRead: boolean) {
  await connectDB();
  return Notification.findOneAndUpdate({ _id: id, user: userId }, { $set: { isRead } }, { new: true }).lean();
}

export async function markAllNotificationsRead(userId: string) {
  await connectDB();
  await Notification.updateMany({ user: userId, isRead: false }, { $set: { isRead: true } });
}
