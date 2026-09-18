# ChatGPT → Claude SSOT 감사 진입점 — audit (59) override

> 구현 Owner는 Claude 단일 SSOT 세션이다. ChatGPT는 독립 감사·증거 기록만 한다. application/business logic은 이 감사에서 수정하지 않았다.

## 1) RESOLVED(code/main) — downstream read split-brain

PR #414 merge `817865d732b92b284c1db78a183325c6bfb12a1f` 이후 authenticated `/api/products`, Finder, `/m/[code]`, F01 상세링크 매핑, 내부 policy/partner, read-only ops inventory는 canonical freepasserp5를 읽는다. `/inventory` 편집은 ERP5 authenticated write boundary가 생길 때까지 ERP4 read/write 한 묶음으로 HOLD한다.

## 2) NO-GO/HOLD — 계약락 dual writer

- canonical production engine `erp5-ssot-refresh.yml` / pin `cf940df642edf315adbc6da2b4134fbad53da160` / `sync-vehicle-lock-from-ledger.mts --apply` / marker `LEDGER`.
- 별도 `contract-status.yml` / `*/30 * * * *` / `mark-contract-in-listings.mts --apply` / marker `정산원장`.

같은 ERP5 `products.locked_by_contract` ownership/lifecycle가 둘이다. concurrency group은 simultaneous write만 직렬화한다. owner를 1개로 만든 뒤 자동 writer를 넓게 재개한다.

## 3) HOLD — settlement-sync legacy `정산` writer

`settlement-sync.yml`은 `sync-intake-to-ledger.mts` 뒤 `sync-contract-from-ledger.mts`를 scheduled apply로 실행한다. current canonical ledger는 `접수 / 취소 / 분납실적 / 완납실적 / 청구`인데 legacy `정산` alias를 읽어 공급사 시트를 직접 쓰는 경로가 남아 있다. retire/rewire한다.

## 4) OPEN/DRIFT 구체화 — schedule 공백의 last-proven 원인은 manual-disable + 예약지도 불일치

Audit (57)의 scheduled production green은 유효하다.

- ERP5 run `35347508078`
- 2026-09-18 21:58:18 KST
- `event=schedule`, `success`
- production pin `cf940df642edf315adbc6da2b4134fbad53da160`
- source→Atom→snapshot→F01/F86→freshness/cross-parity/photo-link 전부 green

Audit (58)은 그 뒤 `contract-status` 30분 회차가 사라진 원인을 `UI disabled drift`와 `GitHub scheduler delivery failure` 두 후보로 남겼다. 이번 audit (59)에서 그 모호성이 좁혀졌다.

- commit `8b7a417578e6e2b2b2fac673588cf1b0db9e59a9`(2026-09-17)은 `sales-erp-hourly · mirror-sync · sheet-sync · contract-status · settlement-sync · direct-ingest-hourly · refresh-30min` **7개가 `disabled_manually` 상태**였다고 직접 기록한다.
- current `docs/예약작업-지도.md`는 그중 `contract-status.yml`과 `settlement-sync.yml`을 여전히 **켜짐**으로 기록한다.
- `contract-status`의 마지막 관측 scheduled run은 `35067894061`(2026-09-16 16:18:54 KST, failure)이며 이후 scheduled run 증거가 없다.
- 그 마지막 run은 `자격증명 놓기`에서 composite-action metadata `secrets.GOOGLE_SA_JSON` parser 오류로 죽어 실제 `계약중 표기` step은 skipped됐다.
- 이 parser 오류 자체는 commit `e8956bcac84e87f8bcf4a0b3b212119c7642be8c`(2026-09-18)에서 수정됐다. current `prepare-credentials/action.yml`은 `inputs.google-sa-json`을 사용한다.

**결론:** `contract-status`에 대해 scheduler failure와 manual-disable을 동등한 두 후보로 두지 않는다. **마지막으로 증명된 runtime state는 manual disabled이고 예약지도 ON 표기가 stale**하다. 현재 UI가 이후 재활성화됐는지는 connector로 직접 증명하지 못했으므로, re-enable 증거가 생기기 전까지 이 상태를 우선 기준으로 삼는다.

또한 같은 commit이 `settlement-sync`도 `disabled_manually`였다고 기록하므로 지도상의 `켜짐` 상태는 이 workflow에도 stale 가능성이 높다. legacy `정산` writer를 정리하기 전 무작정 재활성화하지 않는다.

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

1. `contract-status.yml` / `settlement-sync.yml` 각각을 현재 의도상 켤지 끌지 결정하고 GitHub Actions runtime state와 `docs/예약작업-지도.md`를 일치시킨다.
2. `contract-status`를 다시 켤 경우 current credential action 기준 controlled run을 먼저 통과시키고 실제 30분 `event=schedule` 연속 delivery를 증명한다.
3. contract lock writer/marker ownership을 1개로 통합한다.
4. `settlement-sync` legacy `정산` writer를 retire/rewire한 뒤에만 자동화를 고려한다.
5. `sales-erp-hourly` / `mirror-sync`도 last-proven manual-disabled 상태와 문서/코드가 일치하는지 명시하고 repository-level retirement/fail-closed를 검토한다.
6. `/inventory`는 ERP5 authenticated write boundary가 설계된 뒤 read/write 함께 이관한다.

## 기준

- audit (58) 이후 application/business logic 새 변경 없음; current main delta는 감사 문서 계열
- current audit log target: `docs/AI-SSOT-AUDIT-LOG.md` → **2026-09-19(59)**
- 상세 근거: `docs/ai-ssot-audit/2026-09-19-chatgpt-audit59-manual-disable-evidence.md`
- last successful scheduled production evidence: run `35347508078`
- last observed contract-status scheduled run: `35067894061` (failure before mark step)
- last-proven manual-disable evidence: commit `8b7a417578e6e2b2b2fac673588cf1b0db9e59a9`
- credential parser fix: `e8956bcac84e87f8bcf4a0b3b212119c7642be8c`
- production pin: `cf940df642edf315adbc6da2b4134fbad53da160`

**application code/business logic은 이 감사에서 수정하지 않는다.**
