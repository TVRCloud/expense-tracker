function getEnv(key: string, defaultValue?: string, required = false): string {
  const value = process.env[key] || defaultValue;
  if (required && !value) {
    throw new Error(`[Config Error]: Missing required environment variable "${key}". Please check your .env file.`);
  }
  return value ?? "";
}

export const config = {
  get mongodb() {
    return {
      uri: getEnv("MONGODB_URI", undefined, true),
    };
  },
  get jwt() {
    return {
      accessToken: {
        secret: getEnv("JWT_ACCESS_SECRET", undefined, true),
        expiresIn: "5m",
        maxAge: Number.parseInt(getEnv("ACCESS_TIMEOUT", "300")),
      },
      refreshToken: {
        secret: getEnv("JWT_REFRESH_SECRET", undefined, true),
        expiresIn: "10d",
        maxAge: Number.parseInt(getEnv("REFRESH_TIMEOUT", "864000")),
      },
    };
  },
  get app() {
    return {
      name: getEnv("NEXT_PUBLIC_APP_NAME", "Finance OS"),
      version: getEnv("APP_VERSION", "1.0.0"),
      url: getEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
      nodeEnv: getEnv("NODE_ENV", "development"),
    };
  },
  get email() {
    return {
      host: getEnv("SMTP_HOST"),
      port: Number.parseInt(getEnv("SMTP_PORT", "587")),
      user: getEnv("SMTP_USER"),
      pass: getEnv("SMTP_PASS"),
      from: getEnv("SMTP_FROM", "noreply@financeOS.app"),
    };
  },
  get redis() {
    return {
      url: getEnv("REDIS_URL"),
    };
  },
  get push() {
    return {
      contactEmail: getEnv("VAPID_CONTACT_EMAIL"),
      publicKey: getEnv("VAPID_PUBLIC_KEY"),
      privateKey: getEnv("VAPID_PRIVATE_KEY"),
    };
  },
  get sentry() {
    return {
      dsn: getEnv("NEXT_PUBLIC_SENTRY_DSN"),
    };
  },
  get integrations() {
    return {
      n8nApiKey: getEnv("N8N_API_KEY"),
      n8nUserEmail: getEnv("N8N_USER_EMAIL"),
      rateLimit: Number.parseInt(getEnv("N8N_RATE_LIMIT", "30"), 10),
      rateWindowMs: Number.parseInt(getEnv("N8N_RATE_WINDOW_MS", "60000"), 10),
      idempotencyTtlSeconds: Number.parseInt(getEnv("N8N_IDEMPOTENCY_TTL_SECONDS", "86400"), 10),
    };
  },
};
