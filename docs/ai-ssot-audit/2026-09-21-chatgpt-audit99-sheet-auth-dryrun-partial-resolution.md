# Audit 99 — Sheet Contract auth resolved to guarded zero-op apply; ERP5 validation still HOLD

Date: 2026-09-21 KST
Auditor: ChatGPT independent SSOT audit

## Verdict

**PARTIAL RESOLUTION / Audit (98) Sheet Contract auth summary STALE / GUARDED F01 APPLY PATH PASS BUT ZERO ACTUAL WRITES / ERP5 REPIN VALIDATION HOLD / SOURCE CONTRACT HOLD / RP012 SEMANTIC SKEW OPEN.**

## Evidence

1. **PR #459 resolves the prior delegated-auth token/read failure for the new Sheet Contract path.** Merge `9a5a21e7fa5b71984f9761868722125c963e7054` changed `scripts/apply-sheet-contract.mts` from Sheets + `drive.readonly` to the already-authorized publisher scopes Sheets + `drive`. The change is limited to the display-only Sheet Contract writer authentication path.

2. **F01 dry-run passed after the scope fix.** Sheet Contract run `35573509757` at head `9a5a21e7...` completed `success`; contract regression, credential preparation, snapshot/preflight/readback, cleanup, and evidence upload all passed. The job environment was `SHEET_FORMAT_TARGET=F01`, `SHEET_FORMAT_APPLY=false`, `SHEET_FORMAT_MODE=widths`.

3. **A later guarded F01 apply-mode run also passed, but it was a zero-op rather than a live mutation.** Run `35573824838` at head `9640be060b8465af21e18bed6ee65b5473d0a649` completed `success` with `SHEET_FORMAT_TARGET=F01`, `SHEET_FORMAT_APPLY=true`, `SHEET_FORMAT_MODE=widths`, and explicit expected snapshot hash/revision/timestamp. Its evidence receipt is `READBACK_PASS`, `beforeHash == afterHash`, `fails=[]`, `writes=0`; the plan had no requests because the target widths were already compliant. This proves guarded apply-mode authentication, snapshot precondition, and no-op readback can complete, but **does not prove an actual sheet mutation or rollback path**.

4. **The first failed F01/F86 runs remain historical evidence but their auth failure is no longer the current F01 state.** Runs `35572968635` and `35573151608` failed preflight with `unauthorized_client` and reported no write attempt. PR #459 plus runs `35573509757` and `35573824838` supersede that auth failure for F01 widths mode. Fresh F86 post-fix validation is still not established here, and `full` title/wrapping mode remains fail-closed while `contracts/sheets/reference-audit.json` is `UNAVAILABLE`.

5. **The ERP5 re-pin remains validation HOLD.** Configured production engine remains `0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e`. Post-repin ERP5 runs observed in this audit include `35572350744` and `35573163050`; both completed `cancelled` before the fixed-snapshot → public/F01/F86 → freshness/cross-audit/photo chain could establish a full-green production-equivalent proof. Audit (95)'s full-green remains historical last-known-good evidence, not validation of the new pin.

6. **Dedicated SSOT Source Contract and RP012 semantic skew remain OPEN.** The dedicated Source Contract continues to show pre-job failures rather than a created/passing source-contract job, and current-main `lib/domain/inventory-source-registry.ts` still lags the active Sonogong three-bucket/source-specific semantics audited in 90–91/98. Generic CI is not a substitute.

7. **Canonical authority and legacy boundaries are unchanged.** RP012 remains Sonogong ERP/API; RP023 remains RebornCar. F01/F86 remain projections from the same fixed snapshot with their intentionally different Sonogong tab labels. `mirror-sync.yml` and `sales-erp-hourly.yml` remain retired/manual-dry-run paths; RTDB/mirror remains non-canonical.

## Claude implementation-owner handoff

- Treat Audit (98)'s delegated-auth HOLD as **superseded for F01 widths mode**: dry-run and guarded apply-mode/no-op readback are green after PR #459.
- Do **not** claim actual formatting write or rollback validation yet: the successful apply-mode receipt had `writes=0` because the sheet was already compliant. A future real diff must still prove narrow write + post-write readback and, if needed, guarded rollback.
- Keep `full` mode fail-closed until external/App Script reference dependencies are VERIFIED; do not promote this display-only writer to inventory SSOT authority.
- Keep configured `0e0bfb3...` ERP5 on validation HOLD until a production-equivalent full pipeline reaches fixed snapshot → F01/F86 publish → freshness/cross-parity/photo evidence green.
- Restore the dedicated Source Contract as an actual fail-closed job and reconcile RP012 registry/runtime/contract semantics to the validated production meaning; do not weaken production semantics to match stale metadata.
- Preserve F01/F86 fixed-snapshot parity, Sonogong/AutoPlus authority, and retired mirror/RTDB boundaries.

No application code or business logic was modified by this audit.
