# Design system

The web UI follows an Apple-style system (calm neutral surfaces, grouped lists, translucent chrome, fluid full-width layouts). The living reference is a Design System artifact; this file records how it relates to the code.

- **Artifact (reference):** https://claude.ai/artifact/4yGcEcEcL5UZq8Xukpe7uJ — tokens in light and dark, usage rules, and live previews of the shell, page header, grids, grouped lists, transaction rows, stat tiles, hero, budget card, controls, settings, mobile nav and auth.
- **Code (source of truth):** `src/app/globals.css`. If the artifact and code disagree, the code wins; update the artifact.
- **Workflow:** request a change against the artifact, implement it in code, then republish the matching artifact files so both stay equal.

## Where things live

| Area | File |
| --- | --- |
| Tokens, layout classes, glass and interaction layer | `src/app/globals.css` |
| App shell (fluid container, no narrow max-width) | `src/app/(app)/layout.tsx` |
| Sidebar (full ≥1280px, icon rail 768–1279px), topbar, mobile header, bottom nav | `src/components/layout/*` |
| Large page title that hands off to the topbar | `src/components/shared/PageHeader.tsx` |
| Shared controls (prop APIs unchanged) | `src/components/_ui/*` |
| Settings primitives (`Group`, `Row`, `Segmented`) | `src/features/settings/components/SettingsUi.tsx` |
| Auth layout | `src/features/auth/components/AuthShell.tsx` |

`src/components/ui/*` is shadcn CLI output; do not hand-edit it.

## Layout rules

- Pages are fluid and use the full width. Gutter is `--gutter` (`clamp(16px, 2.6vw, 44px)`); `--maxw` (2000px) only caps ultrawide. Do not wrap a page in a narrower max-width, except `max-w-2xl`/`max-w-3xl` for a single-column form or text.
- Start every top-level page with `<PageHeader title subtitle actions />` inside a `.page-stack`.
- Layout classes: `.grid-cards` (set `--card-min`), `.grid-split` + `.rail` (sticky side rail from 1024px), `.grid-2`, `.inset-group` (set `--inset`), `.section-head`, `.chrome` (translucent bar).
- Mobile: single column, 44px touch targets, safe-area padding; bottom bar and mobile header replace the sidebar below 768px.

## Visual rules

- Tokens only, no literal hex, so light and dark both work. Tints use `color-mix(in srgb, <token> 12–14%, transparent)`.
- Gold (`--hero-*`, `--amber`) is for the balance hero, the auth side panel, the landing CTA and the dark-mode `--fab`. Nowhere else.
- `green` and `red` always come with a word or sign. Money figures use `--font-mono` with tabular numbers.
- Radii: `--r-lg` 24px, `--r-md` 16px, `--r-sm` 11px, pills `9999px`. Translucent materials only for chrome; never stack one on another.
- Motion: respond on pointer-down, critically damped springs, transform and opacity only, honour `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast`.

The full set of values and per-component anatomy is in the artifact.
