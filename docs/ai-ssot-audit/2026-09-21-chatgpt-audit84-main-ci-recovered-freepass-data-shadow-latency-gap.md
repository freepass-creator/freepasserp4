# ChatGPT Audit 84 — main CI recovered; FreePass Data shadow latency coupling

Date: 2026-09-21 KST  
Repository: `freepass-creator/freepasserp4`  
Pre-audit main: `cd77fdfabce41a58612f1c92df0a598437b476c9`

## Decision

**RESOLVED(main CI HOLD) / MATERIAL IMPLEMENTATION CHANGE / OPEN(shadow runtime non-interference) / ERP5 canonical authority unchanged.**

## 1. Audit 83 generic CI HOLD is resolved

Current pre-audit main `cd77fdfabce41a58612f1c92df0a598437b476c9` has generic CI run `35547094484` completed `success`. Unlike Audit 83's failed run, the downstream SSOT steps actually executed and passed, including ERP4 MAIN stability, ERP5 canonical Firebase boundary, RTDB direct-open/retirement guards, settlement guards, AI Core SHADOW check, simulations, and Production build.

Therefore Audit 83's statement that latest main lacks downstream SSOT verification is stale for this head.

The separate `Production Deploy Recovery` failure `35544475310` remains OPEN because no later green recovery run was observed. Generic CI recovery is not evidence that the repository deploy-recovery credential path is fixed.

## 2. New implementation: FreePass Data is attached as a shadow reader only

PR #445 / merge `757ec62ff521c3046d136ec8004ce38a1e4abf19` adds `contracts/ai-core/freepass-data-erpcom-shadow.consumer.json`, `lib/server/freepass-data-shadow.ts`, and a call from `lib/server/guest-listing.ts`.

The contract preserves active owner `freepasserp5`, mode `PRODUCTION_READ`, fallback `NONE`, target FreePass Data mode `SHADOW_READ`, writer cutover `OUT_OF_SCOPE`, and RTDB `NO_NEW_USAGE`. The merge's `SSOT Source Contract` run `35545948422` is green. There is no evidence here of canonical writer cutover, RTDB resurrection, or customer-visible data takeover by FreePass Data.

## 3. New gap: shadow read is awaited on the customer request path

For an unfiltered public catalog request, `loadGuestListing()` executes `await observeFreepassDataShadow(products)`. When `FREEPASS_DATA_ERP_COM_SHADOW_READ_ENABLED=true`, the observer performs a network fetch to FreePass Data. Its timeout defaults to 1200ms and is bounded between 100ms and 5000ms.

The observer catches errors and never substitutes FreePass Data values into the customer response, so **data authority/value non-interference is preserved**. However, because the call is awaited, a slow or unavailable shadow endpoint can add bounded latency to the customer response. The contract says `shadow_failure: DO_NOT_AFFECT_CUSTOMER_READ`; if that policy includes latency/non-blocking semantics, this is an implementation-policy gap. If the policy is intentionally data-only, the wording should be clarified.

Production activation of the shadow flag was not proven in this audit, so this is **not classified as a current production outage**. It is `OPEN / HOLD(shadow enablement) / WATCH(runtime)`.

## 4. Canonical boundary cross-check

No new drift observed in ERP5 production pin `cf940df642edf315adbc6da2b4134fbad53da160`, 24-source canonical registry, F01/F86 same fixed-snapshot chain, F86 aggregate exclusion of RP012/RP023 while retaining Sonogong `오공구독`/`픽업구독` and AutoPlus `오플구독`, retired automatic `mirror-sync`/`sales-erp-hourly` writers, or RTDB/mirror non-canonical boundary.

Still OPEN: audit 67 quote-default freshness; audit 71 shared ERP5 concurrency/pending-replacement + 15:05 reconciliation; audit 76 false replay of an already-successful native slot; native cadence/timeliness HOLD; Audit 83 Production Deploy Recovery credential-path failure.

## Claude handoff

Treat Audit 83's generic CI chain-break as resolved. Keep FreePass Data non-authoritative and ERP5 as active public reader. Before enabling shadow broadly, decide whether `DO_NOT_AFFECT_CUSTOMER_READ` includes latency. If it does, move shadow observation off the customer-response critical path; implementation remains Claude single-SSOT-session owned.

No application code or business logic was modified by the auditor.
