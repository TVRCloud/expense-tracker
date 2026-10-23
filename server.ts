import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { runReminderChecks } from "./src/lib/reminder-scheduler";
import { topUpRecurringSeries } from "./src/lib/recurring-topup";
import { promoteStalePendingSms } from "./src/lib/capture/ingest";
import { sendSpendLimitSummaries } from "./src/lib/spend-limit";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    res.setMaxListeners(20);
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
    // Notifications whose SMS never arrived become transactions after their
    // hold (src/lib/capture/ingest.ts). Also runs lazily on ingest/review reads.
    // End-of-day spend limit summaries: each user's 21:00 local, checked every 30 minutes.
    setInterval(() => void sendSpendLimitSummaries().catch((err) => console.error("sendSpendLimitSummaries failed", err)), 30 * 60 * 1000);
    setInterval(() => void promoteStalePendingSms().catch((err) => console.error("promoteStalePendingSms failed", err)), 5 * 60 * 1000);
  });
});
