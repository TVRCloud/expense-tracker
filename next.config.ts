import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  turbopack: {},
  serverExternalPackages: ["mongoose", "pino", "pino-pretty"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

const withSerwist = withSerwistInit({
  swSrc: "worker/index.ts",
  swDest: "public/sw.js",
  register: true,
  disable: process.env.NODE_ENV === "development",
  // .map files 403 on Vercel (sourcemaps aren't served publicly) — Serwist's
  // install handler aborts on the first non-200 precache fetch, so a
  // precached .map leaves the service worker stuck "trying to install"
  // forever, which also means push notifications never work (no active SW
  // to attach a push listener to).
  exclude: [/middleware-manifest\.json$/, /\.map$/],
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
});

export default withSentryConfig(withSerwist(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  telemetry: false,
});
