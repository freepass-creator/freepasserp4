# Claude 실행 오더 — Audit (97) current entry point

최우선 최신 판정: **PR #453의 ERP5 engine advance는 현재 production이 아니다. PR #455가 merge `025765424ef60a233474e447c4bb5b695ae1d376`으로 즉시 safety revert했고, production engine은 다시 검증된 `c3838708b84527db241f1985c140a3ec6ece6bff`다. Audit (96)의 `0e0bfb3...` current-production 지시는 point-in-time 기록으로만 남기고 현재 실행 지시로 사용하지 않는다.**

PR #455는 workflow pin, Core receipt engine revision, AI Core pipeline source, shadow revision, 예약작업 지도, validated-engine allowlist를 `c3838708...`로 되돌렸다. Revert 설명상 거절된 수동 ERP5 runs `35570499422`, `35570713351`은 write 단계 전에 취소됐고, live F01/F86 시트나 데이터 의미를 이 revert가 직접 변경하지 않았다.

따라서 현재 production projection baseline은 Audit (95)와 같다. **F01 canonical prefixes = `상품리스트 · 오공구독 · 픽업구독 · 오플구독`; F86 canonical bases = `상품리스트 · 손오공상품 · 픽업구독 · 오플구독`.** PR #453 engine의 `sonogong-product-v1` persistence와 F01 `손오공상품` canonicalization은 현재 production engine에 배포된 정본으로 취급하지 않는다.

**Audit 90–91 runtime↔main semantic skew는 여전히 OPEN이다.** Current-main `lib/domain/inventory-source-registry.ts`는 RP012 channels를 여전히 `LOW_SONOKONG · LOW_TCAR` 둘만 선언하고 `일반 렌트재고 ERP API 버킷은 아직 코드에서 확인되지 않음` HOLD를 유지한다. Safety revert는 unvalidated cutover를 막았을 뿐, current-main metadata/runtime helper/Source Contract를 production truth에 정합화한 것은 아니다. 이 정합 작업은 fail-closed로 별도 구현한다.

**Dedicated SSOT Source Contract gate도 계속 OPEN이다.** Safety-revert head `025765424...`의 main-push run `35571305694`가 pre-job `failure`로 끝났고 jobs는 0개다. 같은 head generic CI `35571307041`은 success지만 dedicated Source Contract 실행을 대체하지 않는다. Current `.github/workflows/ssot-source-contract.yml`의 temporary audit recorder / YAML governance 문제는 Claude 구현·governance 세션에서 수리하고 정상 guard를 복구한다.

15:05 recovery의 Audit (95) full-green 증거(`35569054709` → ERP5 `35569097238`)는 그대로 유효하다. Native cadence/recovery timeliness, persistent monitor reconciliation, Production Deploy Recovery credential path 등 기존 OPEN도 safety revert만으로 닫지 않는다.

Canonical authority는 유지한다: RP012 Sonogong ERP/API, RP023 RebornCar. `mirror-sync.yml` / `sales-erp-hourly.yml`은 schedule-free manual dry-run retired 상태이며 RTDB/mirror는 non-canonical이다.

상세 근거:
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit97-pr455-safety-revert-audit96-race-correction.md`
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit96-pr453-sonogong-classification-source-contract-prejob-red.md` — superseded point-in-time
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit95-1505-downstream-erp5-full-green.md`
- `docs/ai-ssot-audit/2026-09-21-chatgpt-audit94-1505-late-recovery-audit93-race-correction.md`
- `docs/AI-SSOT-AUDIT-LOG.md` — append-only 중앙 원장

이 파일은 최신 실행 진입점이다. 과거 감사 이력은 중앙 원장과 `docs/ai-ssot-audit/` dated decisions를 따른다.
