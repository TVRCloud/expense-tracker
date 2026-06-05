export const config = {
  mongodb: {
    uri: process.env.MONGODB_URI!,
  },
  jwt: {
    accessToken: {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: "5m",
      maxAge: Number.parseInt(process.env.ACCESS_TIMEOUT || "300"),
    },
    refreshToken: {
      secret: process.env.JWT_REFRESH_SECRET!,
      expiresIn: "10d",
      maxAge: Number.parseInt(process.env.REFRESH_TIMEOUT || "864000"),
    },
  },
  app: {
    name: process.env.NEXT_PUBLIC_APP_NAME || "Finance OS",
    version: process.env.APP_VERSION || "1.0.0",
    url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    nodeEnv: process.env.NODE_ENV || "development",
  },
  email: {
    host: process.env.SMTP_HOST || "",
    port: Number.parseInt(process.env.SMTP_PORT || "587"),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "noreply@financeOS.app",
  },
  redis: {
    url: process.env.REDIS_URL || "",
  },
  push: {
    contactEmail: process.env.VAPID_CONTACT_EMAIL || "",
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
  },
  sentry: {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || "",
  },
};
