import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { getApkDownloadUrl, getLatestAppRelease } from "@/lib/app-update";

// GET /api/integrations/app-update/download — a signed URL (valid for a few
// minutes) for the latest APK. The phone downloads from it directly and
// checks the SHA-256 from /app-update before installing.
export const GET = withIntegrationRoute("app-update-download", async ({ requestId }) => {
  const release = await getLatestAppRelease();
  if (!release) return integrationError("NOT_FOUND", "No app update is available", requestId);
  const url = await getApkDownloadUrl(release.apk.assetId);
  if (!url) return integrationError("INTERNAL_ERROR", "Could not prepare the download", requestId);
  return integrationOk({ url, build: release.build, sizeBytes: release.apk.size, sha256: release.apk.sha256 }, requestId);
});
