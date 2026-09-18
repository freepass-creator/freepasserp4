# 2026-09-19 ChatGPT audit (60) — 자동운영 재개 전 운영상태 정렬

## 판정

**운영문서 정렬은 완료. application/business logic은 미변경.**

Audit (59)에서 확인한 last-proven runtime state를 기준으로 자동 writer들의 intended state를 명확히 했다.

### 1. contract-status

- last-proven runtime state: `disabled_manually`
- current writer conflict: canonical ERP5 lock marker `LEDGER` vs contract-status marker `정산원장`
- decision: **OFF/HOLD 유지**
- `docs/예약작업-지도.md`를 `꺼짐/HOLD`로 정정
- dual-writer 정리 전 재활성화 금지

### 2. settlement-sync

- last-proven runtime state: `disabled_manually`
- current legacy path: `sync-contract-from-ledger.mts` → `SETTLEMENT_LEDGER_TAB='정산'`
- canonical ledger tabs: `접수 / 취소 / 분납실적 / 완납실적 / 청구`
- decision: **OFF/HOLD 유지**
- `docs/예약작업-지도.md`를 `꺼짐/HOLD`로 정정
- legacy `정산` writer retire/rewire 전 재활성화 금지

### 3. sales-erp-hourly / mirror-sync

- repository history의 last-proven runtime state: `disabled_manually`
- 예약지도도 꺼짐
- YAML cron / schedule apply path는 여전히 존재
- current `check-schedule-map.mts`는 GitHub UI enabled/disabled를 검증하지 못함
- decision: repository-level retirement/fail-closed를 Claude 구현 Owner에게 별도 작업으로 넘김

### 4. GitHub Actions current UI state

현재 연결된 GitHub connector에는 workflow enabled/disabled 상태를 직접 조회하는 endpoint가 노출되지 않았고, 공개 GitHub Actions workflow URL도 외부 fetch가 차단되어 current UI state를 독립 조회하지 못했다.

따라서:
- last-proven `disabled_manually` 증거를 기준으로 운영문서를 OFF/HOLD로 정렬
- 이후 re-enable은 구현/검증 완료 후 명시적 운영행위로 다룬다
- 단순히 YAML에 cron이 있다는 이유로 ON으로 해석하지 않는다

## 구현 Owner handoff

GitHub issues:

- #415 — P0 SSOT: 계약락 dual-writer 단일화
- #416 — P0 SSOT: settlement-sync legacy `정산` writer retire/rewire
- #417 — P0 Ops: legacy scheduled writers retirement proof

## 자동운영 GO 순서

1. #415 완료
2. #416 완료
3. #417 완료
4. controlled full run:
   - source preflight
   - contract lock
   - 24-source ingest
   - snapshot
   - F01
   - F86
   - F86 freshness
   - Atom↔F01↔F86 parity
   - photo-link audit
   전부 green
5. 이후 필요한 workflow만 명시적으로 re-enable
6. 실제 `event=schedule` 연속 green 증명

## 변경 범위

- 수정: `docs/예약작업-지도.md`
- 생성: GitHub issues #415/#416/#417
- application code/business logic: **수정 없음**
