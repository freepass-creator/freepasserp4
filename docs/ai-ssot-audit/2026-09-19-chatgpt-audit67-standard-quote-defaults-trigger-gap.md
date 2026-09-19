# ChatGPT Audit (67) — standard quote-defaults projection trigger gap

Date: 2026-09-19 KST

## Finding

A new browser-readable standard quote-default snapshot projection is live, but the workflow that publishes it does not track the files that actually define that snapshot.

## Evidence

- Commit `d33522d2951c9b16f7e6e1a035bdb890bad36cbb` introduced `data/new-car/standard-quote-defaults.snapshot.json` and `scripts/export-standard-quote-defaults.mts`.
- `scripts/export-standard-quote-defaults.mts` imports `COST_DEFAULTS` / `configFrom` from `lib/domain/estimate/cost-settings.ts` and writes the public snapshot in `mode: code-defaults`.
- Commit `1c9270f2e2399becd60ba782a5628db60d84e76d` wired `npx tsx scripts/export-standard-quote-defaults.mts` into `.github/workflows/export-newcar-public-snapshot.yml`.
- Push run `35421224976` completed `success`, and bot commit `74d5d47f3cf86e5b12090099d706b33d339f0f79` refreshed the public snapshots. The writer itself therefore works when triggered.
- The current workflow has no cron. Its `push.paths` contains only `scripts/export-newcar-public-snapshot.mts` and `.github/workflows/export-newcar-public-snapshot.yml`; it does **not** include `lib/domain/estimate/cost-settings.ts` or `scripts/export-standard-quote-defaults.mts`.

## Audit conclusion

**판정: 보류 / freshness-trigger contract incomplete**

- Classify `data/new-car/standard-quote-defaults.snapshot.json` as a **derived/public browser projection**, not ERP5 canonical inventory authority.
- A change to the quote-default source or its exporter can leave the published snapshot stale until a manual dispatch or an unrelated push that matches the existing workflow path filter.
- Keep this item HOLD until Claude aligns source-trigger/freshness ownership for this projection.
- Audit (66) conclusions for the ERP5 canonical source registry, F01/F86 projection rules, Sonogong/AutoPlus special tabs, mirror/RTDB legacy paths, legacy-writer HOLDs, and native schedule cadence are unchanged.

No application code or business logic was modified by this audit.
