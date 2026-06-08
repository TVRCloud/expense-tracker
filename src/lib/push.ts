import webpush from "web-push";
import { config } from "./config";

if (config.push.publicKey && config.push.privateKey) {
  webpush.setVapidDetails(
    `mailto:${config.push.contactEmail}`,
    config.push.publicKey,
    config.push.privateKey
  );
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
}

export async function sendPushToSubscription(
  subscription: webpush.PushSubscription,
  payload: PushPayload
): Promise<{ success: boolean; expired?: boolean }> {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { success: true };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 410 || status === 404) {
      return { success: false, expired: true };
    }
    throw err;
  }
}

export { webpush };

export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<void> {
  try {
    const connectDB = (await import("./mongodb")).default;
    const PushSubscription = (await import("@/models/PushSubscription")).default;
    await connectDB();

    const subs = await PushSubscription.find({ user: userId, isActive: true }).lean();
    await Promise.all(
      subs.map(async (sub) => {
        const result = await sendPushToSubscription(
          { endpoint: sub.endpoint, keys: sub.keys as webpush.PushSubscription["keys"] },
          payload
        );
        if (result.expired) {
          await PushSubscription.findByIdAndUpdate(sub._id, { isActive: false });
        }
      })
    );
  } catch (err) {
    const logger = (await import("./logger")).default;
    logger.error({ err }, "sendPushToUser failed");
  }
}
