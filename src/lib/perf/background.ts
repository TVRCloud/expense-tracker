import { after } from "next/server";

// Runs work after the response has been sent, so it never adds to request
// latency. Inside a Next.js request this uses `after()` (on Vercel it keeps
// the function alive until the work settles); outside one (tests, scripts,
// the custom server's timers) it just runs detached. Errors are logged,
// never thrown into the request.
export function runInBackground(label: string, work: () => Promise<unknown>) {
  const run = () =>
    work().catch((err) => {
      console.error(`background task "${label}" failed:`, err instanceof Error ? err.message : err);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
