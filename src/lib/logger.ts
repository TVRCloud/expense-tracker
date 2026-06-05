import pino from "pino";
import { config } from "./config";

const isDev = config.app.nodeEnv === "development";

const logger = pino({
  level: isDev ? "debug" : "info",
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, ignore: "pid,hostname" },
        },
      }
    : {}),
});

export default logger;
