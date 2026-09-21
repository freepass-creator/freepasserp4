# Audit 91 — Sonogong contract-status production pin + manual current-inventory registration writer

Date: 2026-09-21 KST
Role: ChatGPT independent SSOT auditor
Scope: evidence/read-only SSOT review plus audit documentation only. No application code or business logic was modified by the auditor.

## Verdict

**MATERIAL IMPLEMENTATION CHANGE + AUDIT-90 DRIFT UNRESOLVED/DEEPENED + NEW OPT-IN WRITER MODE.**

Audit 90's core finding is not resolved. Since that audit, production has advanced again to a pinned Sonogong engine that changes runtime status/listability semantics, while current `main` still carries the stale two-channel RP012 registry and does not contain the new runtime status helper. In parallel, ERP5 production workflow now exposes an explicit manual bulk-registration path for current Sonogong inventory. This is not a second source authority, but it is a new production writer mode and belongs in writer-topology/governance review.

## 1. Live delta since Audit 90

Current `main` is four commits ahead of Audit 90 commit `2e0e7ef757bc18701e27f8465d135191cbddb43e` through PR #450 and PR #451. The delta touches only:

- `.github/workflows/erp5-ssot-refresh.yml`
- `contracts/ai-core/erp5-product-refresh.pipeline.json`
- `docs/예약작업-지도.md`
- `lib/domain/ai-core-contract-shadow.ts`
- `scripts/check-inventory-source-contract.mts`

No F01/F86 publisher, AutoPlus source, mirror/RTDB legacy writer, or canonical main registry file was changed in this delta.

## 2. New writer topology — explicit current Sonogong registration

PR #450 / merge `f3daed073f4f348be6d947c08e3b8051901938f3` adds workflow-dispatch input `register_sonogong_current` (default `false`). When and only when all of the following are true:

- event is `workflow_dispatch`
- `inputs.apply == true`
- `inputs.register_sonogong_current == true`

production workflow executes:

`npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/ingest-supplier-to-firestore.mts --code=RP012 --apply`

against `GOOGLE_CLOUD_PROJECT=freepasserp5`.

This is an **opt-in/manual production writer mode** that can formally register current RP012 inventory before the ordinary ledger-lock and all-source ingest steps. It still consumes the canonical Sonogong ERP API and therefore is not a competing source authority. Scheduled/workflow-run/heartbeat runs do not execute this step unless the manual inputs are explicitly supplied.

The first post-merge manual ERP5 run observed in this audit is `35564286647` on application head `1fa36da21b087aabbb2c0cd2a1cfd493437ae8bf`. At the audit snapshot it was still in progress, and the `현재 손오공 API 전 차량 정식 등록` step was **skipped**. Therefore this audit records the writer-path implementation, not evidence that the bulk-registration action ran in that verification run.

## 3. Production pin advanced again — Sonogong `계약중` is now a distinct runtime semantic

PR #451 / merge `1fa36da21b087aabbb2c0cd2a1cfd493437ae8bf` advances ERP5 production pin to:

`c3838708b84527db241f1985c140a3ec6ece6bff`

The pinned engine is not a metadata-only revision. Commit `c3838708...` adds `lib/domain/direct-source-status.ts` and changes `scripts/ingest-supplier-to-firestore.mts` so that:

- Sonogong ERP API raw `계약중` stays `계약중`.
- Generic sheet raw `계약중` remains conservatively canonicalized to `출고불가`.
- A Sonogong `계약중` row is asserted as `listable == true` through `resolveStatus`.

The same pinned lineage continues to assert RP012 channels:

`LOW_SONOKONG_DAILY · LOW_SONOKONG · LOW_TCAR`

with the already-established `중고렌트 · 오공구독 · 픽업구독` mapping.

## 4. Audit 90 runtime/main skew is deeper, not resolved

Current `main:lib/domain/inventory-source-registry.ts` still declares only:

`LOW_SONOKONG · LOW_TCAR`

and still keeps the hold:

`일반 렌트재고 ERP API 버킷은 아직 코드에서 확인되지 않음`

Current `main` also has no `lib/domain/direct-source-status.ts` and no `directSourceStatusBase` symbol. Thus a reader of the main canonical registry/runtime helpers cannot reconstruct the semantics currently executed by the pinned production engine.

This remains a **runtime/main contract-version skew**, not evidence of a second inventory authority. RP012 authority remains `https://sokrc.com/api`.

## 5. Source Contract remains green while semantic parity is absent

PR #451 updates current-main `VALIDATED_ENGINES` to allow `c3838708...`, but the adjacent comment still says the Sonogong collector content is the same as `cf940df6`. That statement is stale: `c3838708...` changes the ingest script and adds source-specific status/listability behavior.

Current-main Source Contract still checks RP012 kind/adapter/source URL, but does not lock:

- three-channel RP012 parity,
- RP012 hold removal parity,
- `계약중` source-kind semantics,
- or pinned-engine-vs-main semantic equivalence.

PR #451 check `source-contract` completed success in run `35564056529`, and generic `verify` also completed success in run `35564056486`. Those green checks therefore prove the current allowlist/guard passes; they do **not** prove main and the pinned production engine express the same canonical RP012 contract.

## 6. F01/F86, AutoPlus, mirror and RTDB boundaries

No new drift was found in the untouched surfaces since Audit 90:

- F86 fixed first tabs remain `상품리스트 · 손오공상품 · 픽업구독 · 오플구독`.
- F01 remains `상품리스트 · 오공구독 · 픽업구독 · 오플구독`.
- RP023 AutoPlus remains RebornCar-backed under the existing special-tab contract.
- Retired mirror/sales automatic writer conclusions are unchanged.
- RTDB/mirror legacy paths remain non-canonical inventory authority.

The new manual RP012 registration mode must be added to the writer-topology mental model, but it does not revive those retired legacy paths.

## Claude implementation-owner handoff

1. Do not roll production `c3838708...` back merely to make it resemble stale current-main text.
2. Reconcile current-main RP012 registry and runtime helper semantics with the pinned engine: three channels, removal of the obsolete third-bucket hold, and source-specific `계약중` behavior.
3. Strengthen Source Contract so a pinned engine cannot become green solely by adding its SHA while canonical channel/hold/status semantics diverge from main.
4. Correct the stale validated-engine comment that says the collector content is unchanged from `cf940df6`.
5. Explicitly classify `register_sonogong_current` as an opt-in/manual ERP5 writer mode in writer-topology documentation/guards. Preserve its manual default-off gating unless Claude intentionally changes the policy.
6. Do not weaken fixed-snapshot F01/F86 parity, Sonogong/AutoPlus special-tab rules, or legacy mirror/RTDB retirement while reconciling this drift.

No application code or business logic was modified by the auditor.
