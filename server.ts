import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { runReminderChecks } from "./src/lib/reminder-scheduler";
import { topUpRecurringSeries } from "./src/lib/recurring-topup";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "", true);
    void handle(req, res, parsedUrl);
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    // Run reminder checks + recurring series top-up once on startup (after warm-up), then every 6 hours
    setTimeout(() => void runReminderChecks(), 30_000);
    setInterval(() => void runReminderChecks(), 6 * 60 * 60 * 1000);
    setTimeout(() => void topUpRecurringSeries(), 30_000);
    setInterval(() => void topUpRecurringSeries(), 6 * 60 * 60 * 1000);
  });
});
