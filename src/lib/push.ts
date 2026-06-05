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
