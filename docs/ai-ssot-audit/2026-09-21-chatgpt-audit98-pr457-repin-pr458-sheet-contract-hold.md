# Audit 98 — PR #457 re-pin + PR #458 Sheet Contract writer; validation HOLD

Date: 2026-09-21 KST
Auditor: ChatGPT independent SSOT audit

## Verdict

**MATERIAL IMPLEMENTATION CHANGE / Audit (97) current-production summary STALE / HOLD(post-repin ERP5 full validation + dedicated Source Contract) / NEW MANUAL DISPLAY-WRITER TOPOLOGY / PR #458 AUTH FAILURE PARTIALLY RESOLVED BY PR #459 DRY-RUN / Audit 90–91 semantic skew OPEN.**

## Evidence

1. **PR #457 re-advanced the configured production engine.** Merge `5266d634187493d871f4c5f13a07af0fb0f70698` moved `.github/workflows/erp5-ssot-refresh.yml`, the Core ingest receipt engine revision, AI Core shadow pipeline source/revision, and the validated-engine allowlist from `c3838708b84527db241f1985c140a3ec6ece6bff` to `0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e`. Therefore Audit (97)'s statement that `c3838708...` is the current configured production pin is stale.

2. **The new pin has not earned a full-green production-equivalent validation.** ERP5 run `35572350744` (`workflow_dispatch`, head `0bfdefd9f1c7224b408d905289d241df72f578bc`) completed `cancelled`. Engine checkout, OIDC, source contract, current source recollection, T-car audit, and settlement→Atom contract lock succeeded; `원천에서 ERP5 현재 원자 계산` concluded `cancelled`. AI Core shadow receipt steps completed, but fixed snapshot, public catalog, F01 publish, F86 backup/publish, freshness, Atom↔F01↔F86 cross-audit, photo audit, and evidence preservation were skipped. This is **validation HOLD**, not evidence of published data corruption, because the publication steps did not run.

3. **Audit 90–91 runtime↔main semantic skew remains OPEN.** Current-main `lib/domain/inventory-source-registry.ts` still declares RP012 channels as only `LOW_SONOKONG · LOW_TCAR` and retains the hold that the general-rental ERP API bucket is unconfirmed, while the active `0e0bfb3...` lineage uses the Sonogong three-bucket/source-specific classification semantics already audited. Canonical source authority itself is unchanged: RP012 remains Sonogong ERP/API; RP023 remains RebornCar.

4. **Dedicated SSOT Source Contract is still not an effective fail-closed gate.** After the re-pin, its push runs continued to fail before a source-contract job was created, including `35571946592`, PR #458 head run `35572954687`, `35572965499`, and later main run `35573667738`. Generic CI success does not substitute for this dedicated gate.

5. **PR #458 added a new manual, display-only F01/F86 writer topology.** Merge `0366d714532ecbee86763716efa13279067675de` added `.github/workflows/sheet-formatting-only.yml`, `contracts/sheets/sheet-contract-v1.json`, `contracts/sheets/reference-audit.json`, and the planner/executor. It is `workflow_dispatch` only, shares `erp5-inventory-publish` concurrency, and is explicitly scoped away from ingest/Firestore/row writes. `widths` mode can emit only column-width updates after fail-closed evidence checks. `full` mode can also plan titles/wrapping but remains blocked while `reference-audit.json` is `UNAVAILABLE` because Apps Script/external-consumer title dependencies are not verified. This is a **new opt-in formatting writer**, not a new inventory authority.

6. **The first F01 and F86 formatting runs failed before any sheet write.** Run `35572968635` (F01) and run `35573151608` (F86) both passed the local contract regression and credential preparation, then failed in `Snapshot, preflight, optional narrow apply, readback`. Their uploaded failure receipts reported `writeAttempted=false` and `unauthorized_client`. Therefore those two runs did not establish a live mutation.

7. **PR #459 partially resolved the delegated-auth failure, but only for a dry-run path.** Merge `9a5a21e7fa5b71984f9761868722125c963e7054` changed the Sheet Contract JWT Drive scope from `drive.readonly` to the existing publisher's authorized `drive` scope. Fresh run `35573509757` then completed `success` on target `F01`, mode `widths`, with `SHEET_FORMAT_APPLY=false`; credential preparation, exact contract regression, snapshot/preflight/readback, and sanitized evidence all passed. This resolves the previous delegated-auth/preflight failure for **F01 width-only dry-run**. It does **not** prove a live width mutation, does not validate F86, and does not unblock `full` mode while the reference audit is `UNAVAILABLE`.

8. **Legacy boundaries remain unchanged.** `mirror-sync.yml` and `sales-erp-hourly.yml` remain manual/dry-run retired paths, and RTDB/mirror remains non-canonical. No evidence in the audited delta changes the 24-source canonical authority boundary or promotes a legacy path back to SSOT.

## Claude implementation-owner handoff

- Treat Audit (97)'s `c3838708...` current-pin statement as superseded by the configured `0e0bfb3...` re-pin, but do **not** call the new pin fully validated until a production-equivalent ERP5 run reaches snapshot → F01/F86 publish → freshness/cross-parity/photo evidence green.
- Keep the dedicated Source Contract HOLD until the workflow actually creates and passes its source-contract job; generic CI is insufficient.
- Reconcile current-main RP012 registry/runtime helpers/Source Contract with the validated three-bucket and source-specific Sonogong semantics instead of weakening the production meaning to match stale metadata.
- Treat `sheet-formatting-only.yml` as a separate, opt-in formatting writer. F01 width-only dry-run authentication/preflight is now green after PR #459, but do not infer live apply, F86 validation, or full-mode safety from that result. Keep `full` title/wrapping apply fail-closed until reference dependencies are `VERIFIED`, and verify any live apply independently.
- Do not weaken F01/F86 fixed-snapshot parity, Sonogong/AutoPlus source authority, or retired mirror/RTDB boundaries.

No application code or business logic was modified by this audit.
