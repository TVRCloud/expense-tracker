# PWA

Finance OS ships as a Progressive Web App using **next-pwa**.

## Configuration

`next.config.ts` wraps the Next.js config with `withPWA`:

- `dest: "public"` — service worker output directory
- `register: true` — auto-registers the service worker
- `skipWaiting: true` — activates new SW immediately
- `disable: process.env.NODE_ENV === "development"` — SW disabled in dev to avoid caching issues
- `fallbacks.document: "/offline"` — shown when a page fetch fails offline

## Manifest

`src/app/manifest.ts` exports the Web App Manifest via Next.js's built-in `MetadataRoute.Manifest`:

- `start_url: /dashboard`
- `display: standalone`
- `theme_color: #6B46F5`
- Icons: 192x192 (maskable) + 512x512 at `public/icons/`

## Install prompt

`src/components/shared/InstallButton.tsx` listens for the `beforeinstallprompt` event and shows a button to trigger the native install dialog.

## Offline page

`src/app/(app)/offline/page.tsx` — shown by the service worker when a navigation request fails and no cached version is available.

## Caching strategy

next-pwa defaults:
- **Static assets / fonts** — CacheFirst (immutable hashes)
- **API routes** — NetworkFirst with 5s timeout, falling back to cache
- **Pages** — StaleWhileRevalidate
