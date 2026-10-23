# New feature checklist

1. Issue exists and uses the feature form. Branch `<issue>-<slug>`.
2. Create the feature dir. Copy `docs/templates/feature-CLAUDE.md` into it and fill it.
3. Add a row to `docs/feature-map.md` (and the other repo's row if it has a counterpart).
4. Write tests with the code. Update the API contract doc if an endpoint changed.
5. Record a lasting decision as an ADR from `docs/templates/adr.md`.
6. Run the repo checks and `scripts/check-feature-docs.sh`.
7. PR title prefix per CLAUDE.md. Tick the PR checklist.
