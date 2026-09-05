import { defaultCache } from "@serwist/next/worker";
import { NetworkOnly, Serwist } from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

declare const self: ServiceWorkerGlobalScope &
  SerwistGlobalConfig & {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  };

const serwist = new Serwist({
  // /offline isn't a static file in public/ (it's a rendered Next page), so
  // it can't come from the InjectManifest public-folder scan — add it here
  // so the `fallbacks` config below can precache and serve it offline.
  precacheEntries: [...(self.__SW_MANIFEST ?? []), { url: "/offline", revision: null }],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Must come before the default "apis" rule (matches all /api/* with
    // NetworkFirst + caching), which was intercepting this long-lived SSE
    // stream and buffering it for cache.put() — breaking real-time delivery
    // entirely. This route needs to hit the network directly, every time,
    // with no service-worker involvement.
    {
      matcher: /\/api\/events(\?.*)?$/,
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

// Push notifications — unchanged from the pre-Serwist worker, these are
// plain event listeners independent of the precaching/routing layer above.
self.addEventListener("push", (event) => {
  const data = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string };
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Finance OS", {
      body: data.body ?? "",
      icon: "/icons/icon.svg",
      badge: "/icons/icon.svg",
      data: { url: data.url ?? "/notifications" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data?.url ?? "/notifications") as string;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.focus();
          (client as WindowClient).navigate?.(target);
          return;
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
