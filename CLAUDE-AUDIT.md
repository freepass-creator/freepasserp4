# CLAUDE-AUDIT — latest SSOT audit entry point

## Audit (75) override — 2026-09-19 KST

Claude is the sole implementation owner. ChatGPT is an independent auditor only.

### New material delta

- **Audit (74) specific overlap pair RESOLVED:** settlement-chain ERP5 `35434667030` and direct native ERP5 `35434923578` both completed `success`. The queued direct run was not lost in this pair.
- **Audit (71) structural queue hazard remains OPEN:** current ERP5 workflow still shares one `erp5-inventory-publish` concurrency group with `cancel-in-progress:false` across `schedule`, settlement `workflow_run`, and heartbeat `push`, with no trigger-level dedupe/coalescing. The 15:05 ERP5 `35427915834` cancelled-before-job slot remains unreconciled.
- **Native cadence/timeliness remains HOLD:** the observed 18:05 settlement and 18:17 ERP5 direct events arrived roughly 20m and 14m late. Do not infer cadence recovery from the two green completions.
- **New main implementation hardening:** `d041da248fa131e62043ed3c66bbace98cda4e44` adds ERP4 MAIN stability lock + required `check:erp4-main`. Public guest listing is now CI-locked to `readWhitelabelCatalogFromErp5` and legacy ERP4 store/RTDB fallback is forbidden. `2d9fd07075aae7d6d64687fabbf61126e166c34c` locks term/rent/deposit/filter/sort/card pricing to one price row. Verify run `35437192663` succeeded.
- Production pin `cf940df642edf315adbc6da2b4134fbad53da160`, 24-source canonical registry, same-snapshot F01/F86, Sonogong/AutoPlus special tabs, retired legacy automatic writers and RTDB/mirror boundary are unchanged. Audit (67) quote-defaults freshness trigger gap remains OPEN.

### Claude handoff

1. Close audit (74)'s specific pair only; keep audit (71) queue safety and the 15:05 reconciliation OPEN.
2. Implement explicit dedupe/coalescing/lossless serial queue semantics for settlement-chain/direct-cron/heartbeat production triggers without weakening canonical write gates.
3. Close native cadence only with consecutive real `event=schedule` evidence and acceptable delay.
4. Preserve ERP4 MAIN's ERP5-only public read lock and current canonical source/F01-F86/special-tab/legacy-retirement contracts.
5. Keep audit (67) quote-defaults projection freshness HOLD separate.

Detail: `docs/ai-ssot-audit/2026-09-19-chatgpt-audit75-overlap-green-public-main-lock.md`

No application code or business logic was modified by the auditor.
