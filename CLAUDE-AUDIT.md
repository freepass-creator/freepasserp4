# Claude 실행 오더 — Audit (96) current entry point

최우선 최신 판정: **PR #453은 merge `79db9988500d7fd7634f24c52f382016d8cb5730`으로 이미 main에 들어왔고, ERP5 production engine은 `0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e`로 전진했다. Audit (95)의 “PR #453 unmerged / production pin c383” 요약은 stale이다.**

새 production engine은 `sonogong-product-v1` 분류를 원자에 보존한다. RP012 bucket은 `LOW_SONOKONG_DAILY → 중고렌트`, `LOW_SONOKONG → 오공구독`, `LOW_TCAR → 픽업구독`이며, sales grouping은 non-pickup 손오공(`중고렌트` + `오공구독`)을 `손오공상품`, pickup을 `픽업구독`으로 분리한다. F01/F86 canonical published bases는 현재 engine 기준 **`상품리스트 · 손오공상품 · 픽업구독 · 오플구독`**으로 정렬됐고, 옛 `손오공구독`/`오공구독`은 read alias다. 실제 live title에는 publisher 규칙에 따라 mark/count suffix가 붙는다.

**Audit 90–91 runtime↔main semantic skew는 아직 OPEN이다.** Current-main `lib/domain/inventory-source-registry.ts`는 RP012 channels를 여전히 `LOW_SONOKONG · LOW_TCAR` 둘만 선언하고 `일반 렌트재고 ERP API 버킷은 아직 코드에서 확인되지 않음` HOLD를 유지한다. Production truth를 stale main에 맞춰 되돌리지 말고 current-main registry/runtime helper/Source Contract를 3-bucket + source-specific status semantics에 fail-closed로 정렬한다.

**새 pin runtime validation도 HOLD다.** 첫 post-merge ERP5 run `35570499422`은 `workflow_dispatch`로 시작됐지만 `현재 원천 재수집`에서 cancelled됐고 settlement lock / Atom ingest / fixed snapshot / public-F01-F86 publish / freshness / cross-audit / photo / evidence 단계는 전부 skipped였다. 이건 data corruption 증거가 아니라 새 pin의 full-green proof가 아직 없다는 뜻이다.

**Dedicated SSOT Source Contract main-push gate도 현재 red다.** Head `79db998...`의 `SSOT Source Contract` run `35570482765`은 job 하나도 만들지 못한 채 pre-job `failure`였다. 같은 head generic CI `35570483614`은 success지만 전용 Source Contract 실행을 대체하지 않는다. Current `.github/workflows/ssot-source-contract.yml`에는 임시 `audit95-recorder`도 아직 남아 있고, 중앙 `docs/AI-SSOT-AUDIT-LOG.md`는 Audit (93)에서 멈춘 상태다. Workflow/CI 수리는 Claude 구현·governance 세션에서 수행하고, 감사자는 application/business logic을 수정하지 않는다.

15:05 recovery의 기존 Audit (95) full-green 증거(`35569054709` → ERP5 `35569097238`)는 그대로 유효하다. Recovery timeliness/native cadence, persistent monitor reconciliation, Production Deploy Recovery credential path 등 기존 OPEN도 새 repin만으로 닫지 않는다.

Canonical source authority는 유지한다: RP012 Sonogong ERP/API, RP023 RebornCar. `mirror-sync.yml` / `sales-erp-hourly.yml`은 schedule-free manual dry-run retired 상태이고 RTDB/mirror는 non-canonical이다.

상세 근거:
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit96-pr453-sonogong-classification-source-contract-prejob-red.md`
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit95-1505-downstream-erp5-full-green.md`
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit94-1505-late-recovery-audit93-race-correction.md`
- `docs/AI-SSOT-AUDIT-LOG.md` — append-only 중앙 원장(현재 94–96 backfill 필요)

이 파일은 최신 실행 진입점이다. 과거 감사 이력은 중앙 원장과 `docs/ai-ssot-audit/` dated decisions를 따른다.
