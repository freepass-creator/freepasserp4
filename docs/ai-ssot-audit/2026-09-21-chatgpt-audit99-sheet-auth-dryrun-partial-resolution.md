# Audit 99 — Sheet Contract delegated-auth dry-run partial resolution

Date: 2026-09-21 KST
Auditor: ChatGPT independent SSOT audit

## Verdict

**PARTIAL RESOLUTION / Audit (98) Sheet Contract auth summary STALE / NO LIVE SHEET-WRITE PROOF / ERP5 REPIN VALIDATION HOLD / SOURCE CONTRACT HOLD / RP012 SEMANTIC SKEW OPEN.**

## Evidence

1. **PR #459 partially resolves the new Sheet Contract writer's delegated-auth failure.** Merge `9a5a21e7fa5b71984f9761868722125c963e7054` changed `scripts/apply-sheet-contract.mts` from Sheets + `drive.readonly` to the already-authorized publisher scopes Sheets + `drive`. The change is limited to the display-only Sheet Contract writer authentication path.

2. **F01 dry-run now passes the full preflight/read path.** Sheet Contract run `35573509757` at head `9a5a21e7...` completed `success`; contract regression, credential preparation, `Snapshot, preflight, optional narrow apply, readback`, cleanup, and evidence upload all passed. Job environment proves this run was `SHEET_FORMAT_TARGET=F01`, `SHEET_FORMAT_APPLY=false`, `SHEET_FORMAT_MODE=widths`. Therefore this is valid evidence that delegated token acquisition and F01 snapshot/preflight/read access work with the revised scope.

3. **This is not a live write validation.** The successful run explicitly used `apply=false`. No conclusion should be drawn that width mutation, post-write readback, or guarded rollback works in production. Full title/wrapping mode remains separately fail-closed while `contracts/sheets/reference-audit.json` is `UNAVAILABLE`.

4. **The first failed F01/F86 runs remain useful historical evidence but their auth failure is no longer the current F01 dry-run state.** Runs `35572968635` and `35573151608` failed preflight with `unauthorized_client` and reported no write attempt; PR #459 plus run `35573509757` supersedes only that token/read failure for the F01 dry-run path. It does not prove F86 parity or any apply path.

5. **The ERP5 re-pin remains validation HOLD.** Configured production engine remains `0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e`. Post-repin ERP5 runs observed in this audit include `35572350744` and `35573163050`; both completed `cancelled` before the fixed-snapshot → public/F01/F86 → freshness/cross-audit/photo chain could establish a full-green production-equivalent proof. Audit (95)'s full-green remains historical last-known-good evidence, not validation of the new pin.

6. **Dedicated SSOT Source Contract and RP012 semantic skew remain OPEN.** The dedicated Source Contract continues to show pre-job failures rather than a created/passing source-contract job, and current-main `lib/domain/inventory-source-registry.ts` still lags the active Sonogong three-bucket/source-specific semantics audited in 90–91/98. Generic CI is not a substitute.

7. **Canonical authority and legacy boundaries are unchanged.** RP012 remains Sonogong ERP/API; RP023 remains RebornCar. F01/F86 remain projections from the same fixed snapshot with their intentionally different Sonogong tab labels. `mirror-sync.yml` and `sales-erp-hourly.yml` remain retired/manual-dry-run paths; RTDB/mirror remains non-canonical.

8. **A later Sheet Contract run `35573824838` was still in progress at this audit cutoff and is not treated as evidence for or against live apply.** Its outcome must be adjudicated only after completion and evidence inspection.

## Claude implementation-owner handoff

- Treat Audit (98)'s instruction to first solve delegated authentication as **partially superseded**: F01 widths dry-run token/snapshot/preflight is now green after PR #459.
- Do not promote the Sheet Contract writer to PASS for live mutation until an explicitly guarded apply run proves narrow write + post-write readback/rollback evidence. Keep full mode fail-closed until external/App Script reference dependencies are VERIFIED.
- Keep the configured `0e0bfb3...` ERP5 pin on validation HOLD until a production-equivalent full pipeline reaches fixed snapshot → F01/F86 publish → freshness/cross-parity/photo evidence green.
- Restore the dedicated Source Contract as an actual fail-closed job and reconcile RP012 registry/runtime/contract semantics to the validated production meaning; do not weaken production semantics to match stale metadata.
- Preserve F01/F86 fixed-snapshot parity, Sonogong/AutoPlus authority, and retired mirror/RTDB boundaries.

No application code or business logic was modified by this audit.
