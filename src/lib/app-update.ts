import { config } from "@/lib/config";
import logger from "@/lib/logger";

// The Android companion app is sideloaded. Its releases are assets of a
// private GitHub repo, which the phone can't read (and must not hold a token
// for), so this server reads them and tells the phone what is new.

export type AppRelease = {
  version: string; // "1.1.0"
  build: number; // the number after "+", Android's versionCode
  tag: string;
  notes: string;
  publishedAt: string | null;
  apk: { assetId: number; name: string; size: number; sha256: string | null };
};

type GithubAsset = { id: number; name: string; size: number; digest?: string | null };
type GithubRelease = {
  tag_name: string;
  body?: string | null;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GithubAsset[];
};

const TAG = /^v?(\d+\.\d+\.\d+)\+(\d+)$/;

/** Parses a release as the mobile CI publishes it: tag "v1.1.0+12", one .apk asset. */
export function parseRelease(r: GithubRelease): AppRelease | null {
  if (r.draft || r.prerelease) return null;
  const m = TAG.exec(r.tag_name ?? "");
  const apk = r.assets?.find((a) => a.name.toLowerCase().endsWith(".apk"));
  if (!m || !apk) return null;
  const digest = apk.digest?.startsWith("sha256:") ? apk.digest.slice("sha256:".length).toLowerCase() : null;
  return {
    version: m[1]!,
    build: Number.parseInt(m[2]!, 10),
    tag: r.tag_name,
    notes: (r.body ?? "").trim().slice(0, 4000),
    publishedAt: r.published_at ?? null,
    apk: { assetId: apk.id, name: apk.name, size: apk.size, sha256: digest },
  };
}

const API = "https://api.github.com";

function headers(accept: string) {
  return {
    accept,
    authorization: `Bearer ${config.appUpdate.token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "expense-tracker-app-update",
  };
}

// GitHub allows 5000 authenticated calls an hour; a short cache keeps every
// phone's launch check from becoming one.
const TTL_MS = 5 * 60_000;
let cached: { at: number; value: AppRelease | null } | null = null;

export function resetAppUpdateCacheForTests() {
  cached = null;
}

/** Whether updates are set up on this server (a token is configured). */
export function appUpdateConfigured() {
  return Boolean(config.appUpdate.token);
}

/** The newest published release, or null when none or GitHub is unreachable. */
export async function getLatestAppRelease(): Promise<AppRelease | null> {
  if (!appUpdateConfigured()) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const res = await fetch(`${API}/repos/${config.appUpdate.repo}/releases/latest`, {
      headers: headers("application/vnd.github+json"),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const value = parseRelease((await res.json()) as GithubRelease);
    cached = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.error({ err }, "reading the latest app release failed");
    // Serve the last good answer rather than telling phones there is nothing.
    return cached?.value ?? null;
  }
}

/**
 * A short-lived signed URL for the APK. GitHub answers the asset request
 * with a redirect to storage that needs no token and expires in minutes, so
 * the phone downloads straight from there and no APK bytes pass through this
 * server.
 */
export async function getApkDownloadUrl(assetId: number): Promise<string | null> {
  const res = await fetch(`${API}/repos/${config.appUpdate.repo}/releases/assets/${assetId}`, {
    headers: headers("application/octet-stream"),
    redirect: "manual",
  });
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location?.startsWith("https://")) return location;
  logger.error({ status: res.status }, "GitHub gave no download redirect for the app release");
  return null;
}
