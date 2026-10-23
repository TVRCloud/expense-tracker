# Landing
Purpose: public marketing page at `/`. No page spec in docs/pages.

## Files
- components/LandingPage.tsx: composes the page.
- components/Hero.tsx: static illustration with decorative sample figures.
- components/FeatureGrid.tsx: bento grid of features.
- components/FinalCta.tsx: closing call to action.

## Talks to
- No API calls, no models. Mounted by `src/app/(public)/page.tsx`.
- Mobile: none.

## Rules and gotchas
- `/` is excluded from the auth redirect in `src/proxy.ts` (matcher ends with `$`).
- Sample figures are fake; do not wire real data in.

## Tests
- None.

## Last changed
- 10a7ed0 feat(ui): Apple-style redesign with full-width responsive layouts
