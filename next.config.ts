import type { NextConfig } from "next";
// @ts-expect-error — no types for next-pwa
import withPWA from "next-pwa";
// @ts-expect-error — no types for next-pwa/cache
import defaultCache from "next-pwa/cache";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {},
  serverExternalPackages: ["mongoose", "pino", "pino-pretty"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

const pwaConfig = withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  buildExcludes: [/middleware-manifest\.json$/],
  fallbacks: {
    document: "/offline",
  },
  runtimeCaching: [
    // Must come before next-pwa's default "apis" rule (matches all /api/*
    // with NetworkFirst + caching), which was intercepting this long-lived
    // SSE stream and buffering it for cache.put() — breaking real-time
    // delivery entirely. This route needs to hit the network directly, every
    // time, with no service-worker involvement.
    {
      urlPattern: /\/api\/events(\?.*)?$/,
      handler: "NetworkOnly",
      options: {},
    },
    ...defaultCache,
  ],
});

export default withSentryConfig(pwaConfig(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
