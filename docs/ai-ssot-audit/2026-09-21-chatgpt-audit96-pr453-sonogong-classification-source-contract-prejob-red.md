# ChatGPT Audit 96 — PR #453 Sonogong classification repin / Source Contract pre-job red

Date: 2026-09-21
Role: independent auditor only. No application code or business logic was modified.

## Verdict

**MATERIAL IMPLEMENTATION CHANGE / VALIDATION HOLD / CI-GOVERNANCE REGRESSION / Audit 90–91 runtime↔main registry skew OPEN.**

## Evidence

1. **PR #453 is now merged.** Current main is merge `79db9988500d7fd7634f24c52f382016d8cb5730` and `.github/workflows/erp5-ssot-refresh.yml` advances the production engine from `c3838708b84527db241f1985c140a3ec6ece6bff` to `0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e`. The validated-engine allowlist / AI Core engine revision moved with it.

2. **The new engine makes Sonogong classification persistent and changes the active sales-tab projection contract.** `sonogong-product-v1` preserves `source_bucket`, `response_bucket`, `product_type`, and `sales_group`; the requested buckets map `LOW_SONOKONG_DAILY → 중고렌트`, `LOW_SONOKONG → 오공구독`, `LOW_TCAR → 픽업구독`. Sales grouping sends Sonogong non-pickup (`중고렌트` and `오공구독`) to `손오공상품` and pickup to `픽업구독`.

3. **F01 and F86 are now aligned on the same four canonical published bases in the pinned engine:** `상품리스트 · 손오공상품 · 픽업구독 · 오플구독`. In `sales-published-tabs.ts`, old `손오공구독` / `오공구독` names are read aliases that canonicalize to `손오공상품`. Published titles still carry count metadata (and the first F01/F86 aggregate carries the publication mark according to each publisher contract), so Audit 95's statement that current F01 is `상품리스트 · 오공구독 · 픽업구독 · 오플구독` is stale.

4. **Audit 90–91 runtime↔main registry skew is NOT resolved.** Current `main:lib/domain/inventory-source-registry.ts` still declares RP012 channels only as `LOW_SONOKONG · LOW_TCAR` and retains the obsolete hold `일반 렌트재고 ERP API 버킷은 아직 코드에서 확인되지 않음`. Production engine `0e0bfb3...` explicitly uses the three-bucket Sonogong classification. Do not roll production truth back to the stale registry; reconcile main/contract to runtime truth in the implementation-owner session.

5. **The new pin does not yet have a full-green production-equivalent run.** First post-merge ERP5 run `35570499422` (`workflow_dispatch`) was cancelled during `현재 원천 재수집`. Source-contract/credential setup had succeeded, but settlement lock, Atom ingest, fixed snapshot, public/F01/F86 publish, freshness/cross-audit/photo/evidence stages were all skipped. This is a validation HOLD, not evidence of data corruption.

6. **Current-main SSOT Source Contract enforcement is red before any job runs.** Push run `35570482765` for head `79db998...` concluded `failure` with **zero jobs**. Therefore the current production-pin/source-contract change did not receive an executed main-push Source Contract check. Generic CI run `35570483614` on the same head is green, but generic CI is not a substitute for the dedicated Source Contract gate.

7. **Audit-control/ledger drift remains.** `docs/AI-SSOT-AUDIT-LOG.md` still ends at Audit (93), while dated Audit (94)/(95) details and `CLAUDE-AUDIT.md` already exist. A temporary `audit95-recorder` remains inside `.github/workflows/ssot-source-contract.yml`, but because the workflow failed before jobs it did not backfill 94/95 or restore itself. This auditor does not repair that workflow or CI implementation; the central append-only ledger should be backfilled with 94/95 and this Audit 96 without changing application/business logic.

## Unchanged SSOT boundaries

- RP012 source authority remains the Sonogong ERP/API (`sokrc.com/api`); this is classification/projection evolution, not a second inventory source.
- RP023 remains RebornCar canonical.
- `mirror-sync.yml` and `sales-erp-hourly.yml` remain schedule-free manual dry-run retired workflows.
- RTDB/mirror paths remain non-canonical inventory authority.
- Existing scheduler/recovery/monitor OPEN items are not closed by this repin.

## Claude implementation-owner handoff

- Treat PR #453 / engine `0e0bfb3...` as current production configuration; do not revert its Sonogong classification merely to match stale main metadata.
- Reconcile current-main RP012 registry/runtime helper/Source Contract with the three-bucket and source-specific status semantics, fail-closed.
- Repair the dedicated Source Contract workflow pre-job failure and remove/retire the temporary audit recorder in the implementation/governance session.
- Obtain a production-equivalent full-green run on `0e0bfb3...` through Atom → fixed snapshot → public/F01/F86 → freshness/cross-audit/photo before closing the validation HOLD.
- Preserve canonical source authority, retired legacy writer boundary, and parity gates.
