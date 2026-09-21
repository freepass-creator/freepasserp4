# Audit 90 — Sonogong full-bucket production pin vs current-main canonical registry drift

Date: 2026-09-21 KST
Role: ChatGPT independent SSOT auditor
Scope: evidence/read-only review plus audit documentation only. No application code or business logic was modified by the auditor.

## Verdict

**MATERIAL IMPLEMENTATION CHANGE + RESOLVED AUDIT-89 CROSS-AUDIT + NEW RUNTIME/MAIN CANONICAL-REGISTRY VERSION SKEW.**

Production remains pinned and fail-closed, but the pinned production engine now knows a Sonogong source bucket that current `main` still explicitly says is unconfirmed. This is not evidence of a second source authority or current data corruption; it is a repository/runtime SSOT contract drift that Claude should reconcile before future work treats current-main registry text as the complete runtime truth.

## 1. Resolved — Audit 89 Atom↔F01↔F86 cross-audit red

PR #448 / merge `ec120d3a39f63f4570d165dcabeeb687a085a169` advanced the production engine to `99167ee27a825e7f8588e49c004297fb019da17f` with the fixed-F86 cross-audit scope.

Production-equivalent ERP5 run `35561514414` completed **success**. The same run executed and passed source contract, source recollection, settlement Atom lock, ERP5 ingest, fixed snapshot, public catalog, F01 publish, F86 backup/publish, F86↔Atom first gate, **Atom↔F01↔F86 cross-audit**, photo audit, and evidence preservation. Audit 89's post-publish cross-audit HOLD is therefore resolved for that engine lineage.

## 2. New implementation change — PR #449 adds the missing Sonogong rent bucket to the pinned engine

PR #449 / current application merge `663b65b54ab9af87de5178328a56b580e922735e` repinned production from `99167ee...` to `2478900272eb742035db5c3743c45a3683161219`.

`247890...` is one commit ahead of `99167ee...` and materially changes the collector/registry semantics:

- RP012 channels become `LOW_SONOKONG_DAILY`, `LOW_SONOKONG`, `LOW_TCAR`.
- The prior hold saying the general rent ERP bucket was not confirmed is removed.
- A new canonical helper maps the request bucket as follows:
  - `LOW_SONOKONG_DAILY` → `중고렌트`
  - `LOW_SONOKONG` → `오공구독`
  - `LOW_TCAR` → `픽업구독`
- `scripts/ingest-supplier-to-firestore.mts` now preserves/uses the requested Sonogong source bucket so the two `SON_NO_KONG` response families do not collapse into one product kind.

The source authority itself did **not** move: RP012 remains `https://sokrc.com/api`.

## 3. Conflict — current-main canonical registry is now stale versus the pinned production engine

Current `main:lib/domain/inventory-source-registry.ts` still declares RP012 as:

- channels `['LOW_SONOKONG', 'LOW_TCAR']`
- hold `일반 렌트재고 ERP API 버킷은 아직 코드에서 확인되지 않음`

That is directly inconsistent with the production-pinned engine `247890...`, which includes `LOW_SONOKONG_DAILY` and removes that hold.

This is **version skew inside the claimed canonical registry contract**. Runtime uses the pinned engine, while a developer/auditor reading current `main` would conclude the opposite about the third Sonogong bucket. Do not resolve this by changing source authority or inventing a projection source; the needed reconciliation is between current-main contract/registry and the already-pinned engine semantics.

## 4. Source Contract blind spot — green CI does not detect the skew

Current-main `scripts/check-inventory-source-contract.mts` verifies RP012 only as `erp_api` + adapter `sonogong` + `sokrc.com/api`; it does not lock the RP012 channel list or hold state, nor compare current-main registry semantics with the pinned engine registry.

The current validated-engine comment for `247890...` also says the collector content is unchanged from the earlier lineage, but `247890...` in fact modifies `scripts/ingest-supplier-to-firestore.mts` and the Sonogong collector helpers. Accordingly, current-head `SSOT Source Contract` run `35562386495` and generic CI `35562386522` are both green, but that green state does **not** prove registry-semantic parity between current main and the pinned production engine.

## 5. Scheduler/recovery update — partial recovery, cancellation hazard still open

The safe-chain monitor had still marked the 12:05 and 13:05 recovery ERP5 runs as pending at 13:44 KST. Live Actions now shows:

- 12:05 recovery downstream ERP5 `35562037889` → **cancelled** before completing the canonical refresh.
- 13:05 recovery downstream ERP5 `35562059650` → **success**, including F86 first gate, Atom↔F01↔F86 cross-audit and photo audit.

So Audit 88's statement that recovery had stopped entirely is no longer current, but the older queued/cancelled ERP5 hazard remains real and the persisted monitor is behind live Actions state.

A native ERP5 `event=schedule` run also reappeared as `35562733391` on current head `663b65b...` at 13:56:57 KST. At audit cutoff it had successfully passed source contract, source recollection, settlement Atom lock, ingest, policy reconciliation, fixed snapshot and public-catalog reconciliation and was continuing into F01/F86 publication. This is evidence that native ERP5 schedule delivery reappeared; it is not proof that the settlement native cadence or overall timeliness HOLD is resolved.

## 6. Unchanged boundaries

- F86 fixed special tabs remain `상품리스트 · 손오공상품 · 픽업구독 · 오플구독`.
- F01 remains `상품리스트 · 오공구독 · 픽업구독 · 오플구독` and is not renamed by this audit.
- RP023 canonical source remains RebornCar.
- `mirror-sync.yml` and `sales-erp-hourly.yml` remain RETIRED/manual dry-run only, with no automatic schedule writer.
- RTDB/mirror legacy paths are not promoted to canonical authority by this change.

## Claude implementation-owner handoff

1. Treat `247890...` as the current production engine while its run completes; do not revert the Sonogong third-bucket semantics merely to match stale main text.
2. Reconcile current-main `inventory-source-registry.ts` with the production-pinned RP012 channel/hold semantics, then strengthen Source Contract so this version skew cannot stay green unnoticed.
3. Correct the stale validated-engine comment that says the collector is unchanged; the pinned commit does change Sonogong collector behavior.
4. Keep scheduler/recovery/cancellation state separate from source-registry semantics. Reconcile monitor state to live Actions and preserve fail-closed behavior for cancelled ERP5 chains.
5. Do not weaken F01/F86 parity gates or change F01 naming as a shortcut.

No application code or business logic was modified by the auditor.
