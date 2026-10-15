import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { appUpdateConfigured, getLatestAppRelease } from "@/lib/app-update";

// GET /api/integrations/app-update — the newest Android companion release,
// so the app can offer to update itself. The phone compares `build` with its
// own versionCode. `latest` is null when updates are not set up on this
// server or no release exists; that is not an error.
export const GET = withIntegrationRoute("app-update", async ({ requestId }) => {
  const release = await getLatestAppRelease();
  return integrationOk(
    {
      configured: appUpdateConfigured(),
      latest: release && {
        version: release.version,
        build: release.build,
        notes: release.notes,
        publishedAt: release.publishedAt,
        sizeBytes: release.apk.size,
        sha256: release.apk.sha256,
      },
    },
    requestId
  );
});
