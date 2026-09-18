# ChatGPT → Claude SSOT 감사 진입점 — audit (60) override

> 구현 Owner는 Claude 단일 SSOT 세션이다. ChatGPT는 독립 감사·운영상태 정렬·증거 기록만 한다. application/business logic은 이 감사에서 수정하지 않았다.

## 1) 운영상태 확정 — 자동 writer 재개 전 OFF/HOLD

### contract-status
- last-proven runtime: `disabled_manually`
- current conflict: canonical `LEDGER` vs contract-status `정산원장` dual lock ownership
- `docs/예약작업-지도.md`: **꺼짐/HOLD**
- **#415 완료 전 재활성화 금지**

### settlement-sync
- last-proven runtime: `disabled_manually`
- current conflict: legacy `sync-contract-from-ledger.mts` / `SETTLEMENT_LEDGER_TAB='정산'`
- canonical ledger = `접수 / 취소 / 분납실적 / 완납실적 / 청구`
- `docs/예약작업-지도.md`: **꺼짐/HOLD**
- **#416 완료 전 재활성화 금지**

### sales-erp-hourly / mirror-sync
- last-proven runtime: `disabled_manually`
- 예약지도: 꺼짐
- YAML cron/`--apply` path는 남아 있음
- **#417에서 repository-level retirement/fail-closed까지 정리**

## 2) 구현 순서 — 그대로 진행

### P0-1 #415 계약락 dual-writer 단일화
목표:
- ERP5 Atom 계약락 owner 1개
- `LEDGER` vs `정산원장` 이중 marker 제거
- 접수/취소/인도완료 lifecycle 단일화
- F01 빠른표시는 필요 시 Atom projection-only
- 공급사 원천 직접 mutation이 canonical ownership을 침범하지 않게 정리
- dual-writer 회귀를 CI/sim으로 차단

### P0-2 #416 settlement legacy writer retire/rewire
목표:
- scheduled path에서 legacy `정산` alias 의존 제거
- intake→ledger 이후 partial-run 위험 제거
- current 5-tab ledger contract 강제
- inventory status/lock은 #415의 canonical owner와 동일한 규칙 사용

### P0-3 #417 legacy scheduled writers retirement proof
대상:
- `sales-erp-hourly.yml`
- `mirror-sync.yml`

목표:
- UI disable에만 의존하지 않는 fail-closed/retirement
- legacy F01/special-tab/RTDB/mirror chain이 실수로 canonical output을 쓰지 못하게 차단
- RP023 old mirror source를 canonical source로 오인하지 않게 ownership 명시

## 3) 그 다음 검증

#415/#416/#417 완료 후 controlled full run 1회:

1. source registry/preflight 24/24
2. contract lock
3. ingest 24/24
4. Atom publication contract
5. fixed snapshot
6. F01
7. F86 backup/publish
8. F86 freshness
9. Atom↔F01↔F86 parity
10. photo-link audit

전부 green이어야 한다.

그 뒤 필요한 workflow만 명시적으로 re-enable하고 실제 `event=schedule` 연속 green을 확인한다.

## 4) 이미 해소된 핵심

- downstream read split-brain: PR #414 main 반영
- F86 freshness false-positive: PR #411/#412 + scheduled run `35347508078`으로 runtime green
- production pin: `cf940df642edf315adbc6da2b4134fbad53da160`
- canonical Firebase boundary fail-closed 유지

## 5) 기존 HOLD 유지

- RP023 canonical RebornCar vs old mirror Sheet
- RP031 API/DOM feeder provenance/canonical migration
- main deposit-policy vs production special-tab deposit rule single-definition
- Sonogong/AutoPlus deposit lineage
- vehicle-price source→Atom lineage
- sales-tab naming migration
- newest-Atom freshness semantics
- `/inventory` ERP4 read/write boundary

## 기준

- central audit: `docs/AI-SSOT-AUDIT-LOG.md` → audit (60)
- detailed evidence: `docs/ai-ssot-audit/2026-09-19-chatgpt-audit60-ops-hold-alignment.md`
- GitHub issues: #415 / #416 / #417
- last successful scheduled production evidence: run `35347508078`
- production pin: `cf940df642edf315adbc6da2b4134fbad53da160`

**다음 구현은 #415부터 시작한다.**
