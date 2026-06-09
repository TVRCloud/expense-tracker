declare const self: ServiceWorkerGlobalScope;

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
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.focus();
          (client as WindowClient).navigate?.(target);
          return;
        }
      }
      return clients.openWindow(target);
    })
  );
});
