# ChatGPT Audit 97 — PR #455 safety revert / Audit 96 race correction

Date: 2026-09-21
Role: independent auditor only. No application code or business logic was modified.

## Verdict

**MATERIAL SAFETY REVERT / Audit 96 SUPERSEDED / production pin RESTORED / Source Contract pre-job failure STILL OPEN / Audit 90–91 semantic skew OPEN.**

## Evidence

1. Audit 96 captured PR #453 merge `79db9988500d7fd7634f24c52f382016d8cb5730` at 16:04:42 KST. Less than one minute later, PR #455 merged as `025765424ef60a233474e447c4bb5b695ae1d376` at 16:05:29 KST and explicitly reverted the PR #453 engine-pin change. Therefore Audit 96 was a valid point-in-time observation but is no longer the current operational instruction.

2. PR #455 restores the ERP5 production engine pin, Core receipt engine revision, AI Core pipeline source, shadow revision, schedule-map declaration, and validated-engine allowlist from `0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e` back to the last validated `c3838708b84527db241f1985c140a3ec6ece6bff`. The PR states that the rejected manual pipelines `35570499422` and `35570713351` were cancelled before write stages and that no live sheet/data semantics are changed by the revert.

3. Current production projection semantics therefore return to the Audit 95 baseline: pinned `c3838708...` publishes F01 canonical prefixes `상품리스트 · 오공구독 · 픽업구독 · 오플구독`; its F86 canonical bases remain `상품리스트 · 손오공상품 · 픽업구독 · 오플구독`. PR #453's `sonogong-product-v1` persistence and F01 `손오공상품` canonicalization are NOT the current production engine.

4. The independent concern behind Audits 90–91 is still OPEN. Current-main `lib/domain/inventory-source-registry.ts` continues to describe RP012 with only `LOW_SONOKONG · LOW_TCAR` plus the hold that the general-rental ERP API bucket is not represented, while the already validated c383 runtime behavior had exposed the production-side Sonogong channel/status semantic mismatch. The safety revert prevents an unvalidated cutover; it does not reconcile main metadata to runtime truth.

5. Dedicated Source Contract enforcement remains broken on the safety-revert commit. Main-push run `35571305694` for head `025765424ef60a233474e447c4bb5b695ae1d376` completed `failure` with zero jobs. Generic CI `35571307041` completed `success`, but generic CI is not a replacement for the dedicated Source Contract gate. The same temporary audit-recorder/YAML governance problem therefore remains an implementation/governance repair item for Claude's owner session.

6. Central audit-control drift also remains until this run backfills it: `docs/AI-SSOT-AUDIT-LOG.md` still ends at Audit (93), while dated Audit 94/95/96 decisions exist. Audit 97 must supersede Audit 96's live instruction and preserve the race chronology rather than deleting history.

## Unchanged SSOT boundaries

- RP012 canonical source authority remains Sonogong ERP/API; RP023 remains RebornCar.
- F01/F86 continue from one Atom/fixed snapshot in the validated c383 pipeline.
- `mirror-sync.yml` and `sales-erp-hourly.yml` remain schedule-free manual dry-run retired workflows.
- RTDB/mirror paths remain non-canonical inventory authority.
- Audit 95's 15:05 full-green downstream recovery remains valid; native cadence/recovery timeliness/monitor reconciliation and Production Deploy Recovery credential-path OPEN items are not closed by this revert.

## Claude implementation-owner handoff

- Treat `c3838708b84527db241f1985c140a3ec6ece6bff` as the current production engine after PR #455; do not act on Audit 96's temporary `0e0bfb3...` cutover instruction.
- Preserve the safety rollback until the Sonogong classification/projection change is reconciled with current-main RP012 registry/runtime helper/Source Contract and receives production-equivalent full-green validation.
- Repair the dedicated Source Contract workflow pre-job failure and retire the temporary audit recorder in the implementation/governance session.
- Do not change canonical source authority, legacy-writer retirement, or RTDB/mirror non-canonical boundaries.
