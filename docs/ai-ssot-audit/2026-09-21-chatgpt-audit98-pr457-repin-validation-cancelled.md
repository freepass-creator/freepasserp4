# Audit 98 — PR #457 re-pin; post-pin validation cancelled

Date: 2026-09-21 KST
Auditor: ChatGPT independent SSOT audit

## Verdict

**MATERIAL REPIN / Audit 97 production-pin conclusion SUPERSEDED / HOLD(post-pin full publication validation) / HOLD(dedicated Source Contract) / Audit 90–91 semantic skew OPEN.**

## Evidence

1. PR #457 merged as `5266d634187493d871f4c5f13a07af0fb0f70698` at 2026-09-21 16:13:25 KST. It re-advanced the active ERP5 workflow pin from `c3838708b84527db241f1985c140a3ec6ece6bff` to `0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e` in `.github/workflows/erp5-ssot-refresh.yml`, the Core ingest receipt revision, the AI Core shadow pipeline source, and the validated-engine allowlist. Audit 97's statement that `c3838708...` is current production is therefore stale.
2. The pinned `0e0bfb3...` engine is the Sonogong classification/projection lineage: it preserves `sonogong-product-v1`, treats RP012 `중고렌트 + 오공구독` as `손오공상품`, keeps T-car `픽업구독` separate, and uses the F86 logical first-four contract `상품리스트 · 손오공상품 · 픽업구독 · 오플구독`; only the leading `상품리스트` carries the refresh mark/count. Sonogong source authority remains its ERP/API and RP023 remains RebornCar.
3. Audit 90–91 is not resolved. Current-main `lib/domain/inventory-source-registry.ts` still declares RP012 channels only as `LOW_SONOKONG · LOW_TCAR` and still carries the obsolete hold that the general-rental ERP API bucket is unconfirmed, while the active pinned engine has the audited three-bucket/source-specific classification semantics.
4. Generic CI for merge `5266d634...`, run `35571948484`, completed success. The dedicated `.github/workflows/ssot-source-contract.yml` push run `35571946592` failed before job creation (`jobs=[]`). Generic CI does not substitute for that dedicated fail-closed gate.
5. Post-pin ERP5 run `35572350744` (`workflow_dispatch`) started at 16:18:33 KST and completed `cancelled` at 16:27:01 KST. Engine checkout, OIDC, pinned-engine source contract, source recollection, T-car source audit, settlement-to-Atom lock, and `원천에서 ERP5 현재 원자 계산` all succeeded. The remaining artifact-path/post-engine/publication chain was skipped, including AI Core receipt, fixed snapshot, public catalog, F01, F86 backup/publish, freshness, Atom↔F01↔F86 cross-audit, photo audit, and evidence. This is a HOLD on complete new-pin validation, not evidence of data corruption.
6. Audit 97→current-main delta does not change `inventory-source-registry.ts`, mirror/sales legacy workflows, or RTDB authority. Retired mirror/sales automatic writers and RTDB/mirror non-canonical boundaries remain unchanged. Audit 95's `c3838708...` full-green remains valid historical evidence but is not validation of `0e0bfb3...`.

## Claude implementation-owner handoff

Do not roll the active pin backward merely to match stale current-main metadata. First obtain and inspect a complete `0e0bfb3...` publication run through F01/F86/freshness/cross-audit. Keep the dedicated Source Contract HOLD until it actually creates and passes its source-contract job. Separately reconcile current-main RP012 registry/runtime helpers/Source Contract to the validated production three-bucket and source-specific status/classification meaning. Do not weaken F01/F86 fixed-snapshot parity, Sonogong/AutoPlus source authority, or the retired mirror/RTDB boundary.

No application code or business logic was modified by this audit.
