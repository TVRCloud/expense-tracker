import type { NextConfig } from "next";
// @ts-expect-error — no types for next-pwa
import withPWA from "next-pwa";

const nextConfig: NextConfig = {
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
});

export default pwaConfig(nextConfig);
