# Audit 100 — ERP5 re-pin full-green; monitor reconciled; Source Contract contains stale audit writer

Date: 2026-09-21 KST
Auditor: ChatGPT independent SSOT audit

## Verdict

**RESOLVED (`0e0bfb3...` production-equivalent validation HOLD) / RESOLVED (persistent monitor reconciliation through 17:05 KST) / HOLD (native schedule + recovery timeliness) / NEWLY DISCOVERED CURRENT CONFLICT (stale `audit95-recorder` writer inside dedicated Source Contract workflow) / Audit 90–91 RP012 semantic skew OPEN.**

## Evidence

1. **The configured ERP5 production engine is still `0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e`.** The live `.github/workflows/erp5-ssot-refresh.yml` at the successful run head `eb5a2145545f346305701f88cceea61d0339f6a3` pins that exact ref and uses the same revision in the Core receipt. No workflow/pin file changed between Audit (99) main and the current inspected main; the only post-Audit99 file deltas were safe-chain heartbeat/state and a ShopCard radius-only UI change.

2. **Audit (99)'s re-pin validation HOLD is now resolved by ERP5 run `35580953322`.** The run completed `success` and its sole `refresh` job was green through: pinned engine checkout, OIDC, source contract, source recollection, T-car source audit, settlement→Atom lock, Atom calculation, Core receipt shadow, policy reconciliation, fixed snapshot, public catalog reconciliation, F01 publish, F86 backup, F86 publish, F86↔Atom freshness/cell audit, Atom↔F01↔F86 cell cross-audit, photo-link audit, and evidence retention. `register_sonogong_current` remained skipped. This is the production-equivalent proof Audit (99) explicitly required for `0e0bfb3...`.

3. **The latest persistent safe-chain monitor is reconciled through the 17:05 KST slot.** `.automation/safe-chain-monitor.json` records settlement `35580899275`, ERP5 `35580953322`, `status=success`, production writes completed, and all three tracked audits PASS; it also sets `lastKnownGoodErp5RunId=35580953322`. Therefore the earlier stale-monitor reconciliation issue is not current through this slot.

4. **Native scheduler/recovery quality remains HOLD.** The 17:05 logical settlement slot was recovered only after the declared 20-minute missing-schedule grace using heartbeat commit `eb5a214...`. The preceding 16:05 recovery produced ERP5 `35574765889`, cancelled during source calculation before production publish/audits, and safe-chain policy did not automatically retry because a downstream trigger already existed. The subsequent 17:05 full-green proves the latest data plane is healthy; it does not prove native schedule delivery or recovery timeliness is fixed.

5. **Newly discovered current conflict: the dedicated Source Contract workflow itself still contains a stale audit writer.** Current-main `.github/workflows/ssot-source-contract.yml` has an `audit95-recorder` job with `permissions: contents: write`. On any matching Source Contract push/PR execution it resets to `origin/main`, appends old Audit (94)/(95) text, restores the workflow from historical commit `cf71d4c15cec1377ea0ec7beb0c9abf38f46a403`, commits, and pushes `main`. This job was introduced by prior audit-recording work and was not removed from the final workflow. It is not an inventory writer, but it is a latent repository writer embedded in a production contract gate and can mutate `main` when source-contract paths change. This finding was present before Audit (100) but was not called out by Audit (99); treat it as a newly discovered current conflict, not as a post-Audit99 introduction.

6. **Dedicated Source Contract gate remains HOLD until the implementation owner removes the stale audit recorder and obtains an actual `source-contract` job green.** Generic current-main CI is green (`35582385004`) but is not a substitute for this fail-closed gate.

7. **RP012 registry/runtime semantic skew remains OPEN.** Current-main `lib/domain/inventory-source-registry.ts` still declares RP012 channels `LOW_SONOKONG` and `LOW_TCAR` plus the HOLD `일반 렌트재고 ERP API 버킷은 아직 코드에서 확인되지 않음`, while the pinned production lineage carries the validated three-bucket/source-specific Sonogong semantics. RP012 canonical authority remains Sonogong ERP/API; RP023 remains RebornCar.

8. **Projection/legacy boundaries did not drift.** F01 and F86 continue to publish from the same fixed ERP5 snapshot; the active F86 first four tabs remain `상품리스트 · 손오공상품 · 픽업구독 · 오플구독`, while F01 retains `상품리스트 · 오공구독 · 픽업구독 · 오플구독`. `mirror-sync.yml` and `sales-erp-hourly.yml` remain schedule-free manual dry-run retired paths. RTDB/mirror remains non-canonical. No new inventory authority or application/business-logic change was observed in the six commits after Audit (99).

## Claude implementation-owner handoff

- Close Audit (99)'s `0e0bfb3...` production-equivalent validation HOLD: run `35580953322` is full-green proof for the configured pin.
- Do **not** close native cadence/recovery-timeliness HOLD; 17:05 still required fallback and 16:05 had a cancelled ERP5 chain.
- Treat persistent monitor reconciliation as current through 17:05, while continuing to watch later slots.
- Remove/neutralize the stale `audit95-recorder` from `.github/workflows/ssot-source-contract.yml` under Claude's implementation ownership, then restore the dedicated Source Contract as a pure fail-closed verifier and obtain an actual `source-contract` job green. Do not use an auditor recorder as a production gate writer.
- Keep Audit 90–91 RP012 semantic reconciliation OPEN; align current-main registry/helper/contract with validated production meaning rather than weakening production semantics to stale metadata.
- Sheet Contract status is unchanged from Audit (99): F01 widths auth/precondition/zero-op apply/readback PASS, but no actual formatting mutation/rollback proof; fresh F86 and `full` mode remain separate HOLDs.
- Preserve F01/F86 fixed-snapshot parity, Sonogong/AutoPlus authority, and retired mirror/RTDB boundaries.

No application code or business logic was modified by this audit.
