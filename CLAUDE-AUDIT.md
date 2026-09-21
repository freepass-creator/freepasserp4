# Claude 실행 오더 — Audit (100) current entry point

최우선 최신 판정: **configured ERP5 production engine `0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e`의 production-equivalent validation HOLD는 해소됐다.** ERP5 run `35580953322`이 pinned engine부터 source contract/source recollection/settlement→Atom/Atom calculation/fixed snapshot/public/F01/F86 backup+publish/freshness/cross-audit/photo/evidence까지 전부 success했다. `register_sonogong_current`는 skipped였다. Audit (99)의 “새 pin full-green 미확정” 요약은 superseded다.

**Persistent safe-chain monitor도 17:05 KST까지는 reconciliation PASS다.** current `.automation/safe-chain-monitor.json`은 settlement `35580899275`, ERP5 `35580953322`, production writes 및 F86 freshness/F01-F86 parity/photo audit PASS를 기록하고 `lastKnownGoodErp5RunId=35580953322`로 전진했다. 다만 **native cadence/recovery timeliness HOLD는 닫지 않는다.** 17:05 논리 슬롯은 20분 grace 뒤 fallback으로 복구됐고, 직전 16:05 ERP5 `35574765889`은 source calculation 중 cancelled됐다. 최신 data plane green과 scheduler 신뢰성은 별도 판정한다.

**Dedicated SSOT Source Contract에는 새로 확인된 audit-infrastructure conflict가 있다.** current `.github/workflows/ssot-source-contract.yml` 안에 과거 감사용 `audit95-recorder` job이 그대로 남아 있고 `contents: write` 권한으로 `origin/main` reset → Audit 94/95 append → historical `cf71d4c...` workflow restore → commit/push를 수행한다. 이 job은 inventory authority는 아니지만 production contract gate 안의 latent repository writer다. Claude 구현 owner가 이 stale recorder를 제거/무력화하고 Source Contract를 pure fail-closed verifier로 복구한 뒤 실제 `source-contract` job green을 확보한다. Generic CI green은 전용 gate를 대체하지 않는다.

**Audit 90–91 RP012 runtime↔main semantic skew는 계속 OPEN이다.** Current-main `lib/domain/inventory-source-registry.ts`는 RP012 channels를 여전히 `LOW_SONOKONG · LOW_TCAR` 둘만 선언하고 `일반 렌트재고 ERP API 버킷은 아직 코드에서 확인되지 않음` HOLD를 남긴다. Validated production meaning에 맞춰 registry/runtime helper/Source Contract를 fail-closed로 정렬한다. Canonical authority는 RP012 Sonogong ERP/API, RP023 RebornCar로 유지한다.

**F01/F86 projection 경계는 유지한다.** 같은 fixed snapshot에서 F01은 `상품리스트 · 오공구독 · 픽업구독 · 오플구독`, F86은 `상품리스트 · 손오공상품 · 픽업구독 · 오플구독` 규칙을 유지하고 latest full-green cross-audit도 통과했다. stale metadata에 맞추려고 production semantics를 rollback하지 않는다.

**Sheet Contract writer 상태는 Audit (99)와 동일하다.** F01 widths mode auth·snapshot precondition·zero-op apply/readback은 PASS지만 실제 mutation/rollback 증거는 아직 없다. Fresh F86 post-fix validation과 `full` title/wrapping mode는 별도 HOLD이며 `contracts/sheets/reference-audit.json`이 VERIFIED되기 전 full apply는 fail-closed로 둔다.

Legacy boundary는 유지한다. `mirror-sync.yml` / `sales-erp-hourly.yml`은 schedule-free manual dry-run retired 상태이며 RTDB/mirror는 non-canonical이다. Production Deploy Recovery credential path 등 다른 OPEN은 이번 Audit (100)으로 자동 해소하지 않는다.

상세 근거:
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit100-erp5-repin-full-green-source-contract-recorder-drift.md`
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit99-sheet-auth-dryrun-partial-resolution.md`
- `docs/AI-SSOT-AUDIT-LOG.md` — append-only 중앙 원장

이 파일은 최신 실행 진입점이다. 과거 감사 이력은 중앙 원장과 `docs/ai-ssot-audit/` dated decisions를 따른다.
