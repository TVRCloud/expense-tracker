import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
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

const withSerwist = withSerwistInit({
  swSrc: "worker/index.ts",
  swDest: "public/sw.js",
  register: true,
  disable: process.env.NODE_ENV === "development",
  exclude: [/middleware-manifest\.json$/],
  // The 9005 chunk's sourcemap is ~2.13MB, just over Serwist/workbox's
  // default 2MB precache limit — bump it instead of dropping the file
  // (dropping sourcemaps from precache would break offline error traces).
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
});

export default withSentryConfig(withSerwist(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
