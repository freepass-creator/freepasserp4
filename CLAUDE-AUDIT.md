# ChatGPT → Claude SSOT 감사 진입점 — audit (58) override

> 구현 Owner는 Claude 단일 SSOT 세션이다. ChatGPT는 독립 감사·증거 기록만 한다. application/business logic은 이 감사에서 수정하지 않았다.

## 1) RESOLVED(code/main) — downstream read split-brain

PR #414 merge `817865d732b92b284c1db78a183325c6bfb12a1f` 이후 authenticated `/api/products`, Finder, `/m/[code]`, F01 상세링크 매핑, 내부 policy/partner, read-only ops inventory는 canonical freepasserp5를 읽는다. `/inventory` 편집은 ERP5 authenticated write boundary가 생길 때까지 ERP4 read/write 한 묶음으로 HOLD한다.

## 2) NO-GO/HOLD — 계약락 dual writer

- canonical production engine `erp5-ssot-refresh.yml` / pin `cf940df642edf315adbc6da2b4134fbad53da160` / `sync-vehicle-lock-from-ledger.mts --apply` / marker `LEDGER`.
- 별도 `contract-status.yml` / `*/30 * * * *` / `mark-contract-in-listings.mts --apply` / marker `정산원장`.

같은 ERP5 `products.locked_by_contract` ownership/lifecycle가 둘이다. concurrency group은 simultaneous write만 직렬화한다. owner를 1개로 만든 뒤 자동 writer를 넓게 재개한다.

## 3) HOLD — settlement-sync legacy `정산` writer

`settlement-sync.yml`은 `sync-intake-to-ledger.mts` 뒤 `sync-contract-from-ledger.mts`를 scheduled apply로 실행한다. current canonical ledger는 `접수 / 취소 / 분납실적 / 완납실적 / 청구`인데 legacy `정산` alias를 읽어 공급사 시트를 직접 쓰는 경로가 남아 있다. retire/rewire한다.

## 4) OPEN/REGRESSION — scheduled green 직후 다시 schedule 공백

Audit (57)의 scheduled production green은 유효하다.

- ERP5 run `35347508078`
- 2026-09-18 21:58:18 KST
- `event=schedule`, `success`
- production pin `cf940df642edf315adbc6da2b4134fbad53da160`
- source→Atom→snapshot→F01/F86→freshness/cross-parity/photo-link 전부 green

하지만 그 뒤 runtime은 다시 선언과 어긋난다.

- 2026-09-19 02:25 KST 재조회: `event=schedule&created=>2026-09-18T13:00:00Z` = **0건**.
- `docs/예약작업-지도.md`는 `contract-status.yml`을 **켜짐**으로 기록.
- 실제 YAML도 `*/30 * * * *`이며 schedule이면 `mark-contract-in-listings.mts --apply`.
- 따라서 22:00~02:00 KST에 기대되는 **9개 30분 회차가 모두 없음**.

`mirror-sync`/`sales-erp-hourly`는 지도상 꺼짐이고 settlement/ERP5는 야간 window 밖이므로, 이번 공백은 최소한 `contract-status`의 **GitHub UI runtime state 또는 scheduled-event delivery가 선언과 불일치**한다는 증거다. UI disabled drift인지 scheduler 누락인지 원인은 아직 확정하지 않는다.

**결론:** audit (57)의 one-shot scheduled green은 유지하되 cadence/punctuality·자동운영 GO는 계속 HOLD. 먼저 `contract-status` UI enabled/disabled와 예약지도를 맞추고, enabled라면 실제 schedule 연속 도착을 증명한다.

## 5) RESOLVED(code/config + scheduled runtime proof) — F86 checker/publication boundary

PR #412 + pin `cf940df...`의 F86 publisher/auditor shared rule, 종합만 timestamp, 회사탭 `회사 · N대`, cell/plate/header/tab-order audit는 run `35347508078`에서 실제 scheduled green이 확인됐다. old freshness false-positive를 다시 구현하지 않는다.

## 6) 기존 HOLD 유지

직접 해소 증거가 없는 항목:

- RP023 canonical RebornCar vs legacy mirror old Google Sheet
- RP031 API/DOM feeder finance provenance / canonical migration
- main `deposit-policy.ts` vs production special-tab deposit-rule single-definition
- Sonogong/AutoPlus deposit recurrence/lineage
- vehicle-price source→Atom lineage
- sales-tab naming migration
- newest-Atom freshness semantics
- `/inventory` ERP4 read/write boundary

production color `MASTER_CATEGORY_COLORS['분류'].신차렌트=#FF00FF`는 유지된다.

## 7) Claude 구현 Owner 다음 순서

1. `contract-status.yml` GitHub UI enabled/disabled 실상과 `docs/예약작업-지도.md`를 일치시킨다.
2. enabled라면 30분 schedule event 미생성 원인을 확인하고 연속 delivery를 증명한다.
3. contract lock writer/marker ownership을 1개로 통합한다.
4. `settlement-sync` legacy `정산` writer를 retire/rewire한다.
5. `sales-erp-hourly` / `mirror-sync`는 문서상 disabled가 실제 runtime과 일치하도록 fail-closed 증거를 남긴다.
6. `/inventory`는 ERP5 authenticated write boundary가 설계된 뒤 read/write 함께 이관한다.

## 기준

- audited application HEAD: `dc6c5cf16146c7439f5a5293383d503e8e30d00d`
- current audit log: `docs/AI-SSOT-AUDIT-LOG.md` → **2026-09-19(58)**
- 상세 근구: `docs/ai-ssot-audit/2026-09-19-chatgpt-audit58-post-green-schedule-gap.md`
- last successful scheduled production evidence: run `35347508078`
- production pin: `cf940df642edf315adbc6da2b4134fbad53da160`

**application code/business logic은 이 감사에서 수정하지 않는다.**
