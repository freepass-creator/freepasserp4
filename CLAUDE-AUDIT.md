# ChatGPT → Claude SSOT 감사 진입점 — audit (46) override

> 이 파일은 구현 지시의 최신 진입점이다. Claude 단일 SSOT 세션만 application/business logic을 수정한다. ChatGPT는 독립 감사·증거 기록만 한다.

## 최신 판정

### 1) IN PROGRESS / production OPEN — F86 freshness checker fix는 PR #411에 staged, 아직 live 아님

audit (45)의 최우선 이슈에 대해 draft PR #411 / head `f17747a549cf7857c28932373ada0bfb8eb7d7da`이 생겼다.

- base는 현재 production engine `14892951a929cf03796231f260e6bc2ff3060efc`.
- 1 commit ahead / 0 behind.
- `f86TabCarriesMark`를 publisher/checker가 공유.
- `f86-audit-checks.ts` + 반례 시험으로 「종합만 HH:MM 시각, 회사 탭은 회사 · N대」 계약을 읽게 함.
- cell parity 비교는 유지.

하지만 PR은 draft/open이고 production pin은 아직 `14892951...`다. `apply=true`/scheduled full-run 검증도 없다. push Actions run `35306378920`은 failure이며 jobs=0이라 positive CI 증거가 아니다.

**우선순위 1:** PR #411 review/merge → production pin 전진 + `VALIDATED_ENGINES` 등록 → 실제 scheduled/apply에서 freshness + cell parity + Atom↔F01↔F86 cross-audit가 모두 green인 회차를 확보한다. 그 전까지 audit (45)의 F86 false-negative는 OPEN.

### 2) IN PROGRESS / 운영 증명 대기 — schedule :05 → :17 대응안 PR #410

open PR #410 / head `b1774f489078d17c067286ee51a65ef01aab9ce7`은 `.github/workflows/erp5-ssot-refresh.yml` cron minute를 `:05`에서 `:17`로 옮기는 운영 대응안이다. current main/live workflow는 아직 `:05`다.

**판정:** merge만으로 정상화 판정하지 않는다. merge 뒤 실제 `event=schedule` :17 회차가 연속 도착해야 audit (45)의 punctuality HOLD를 내릴 수 있다.

### 3) RESOLVED(code/contract), 운영 증명 대기 — 신차렌트 색 production-pin drift

PR #409 / main `5bfc9ad5d6e5269d2217f60552cf8c5df402aa9c`에서 production pin이 `14892951a929cf03796231f260e6bc2ff3060efc`로 상승했고 `신차렌트=#FF00FF` 및 publisher color-SSOT 참조가 포함됐다. Source Contract도 green이었다.

단 신규 pin으로 실제 full apply 뒤 FF00FF가 재역전되지 않는 운영 증명은 여전히 필요하다.

### 4) OPEN/HOLD — RP031 provenance

RP031 canonical registry는 계속 Google Sheet(`1fJu...`)다. audit (44)의 API inventory + rendered-DOM finance feeder가 canonical Sheet에 실제 write한 crossing은 되돌아가지 않았다. backup↔live diff, 신규/변경 identity, finance cells provenance와 deterministic mapping 증명이 끝나기 전 DOM-derived finance를 독립 authoritative SSOT로 승격하지 않는다.

### 5) 기존 HOLD 유지

직접 해소 증거가 없는 다음 항목은 유지한다.

- RP023 canonical RebornCar vs legacy `MIRROR_SOURCES` sheet source.
- `mirror-sync.yml` 30분 scheduled apply writer.
- `sales-erp-hourly.yml` 평일 scheduled apply writer.
- `settlement-sync.yml` legacy ledger→supplier-status writer.
- audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming, audit (34) newest-Atom freshness semantics 및 기타 이전 미해소 HOLD.

## 현재 기준

- current main at audit start: `97f8daf2582bb9e5653cc8d0f06e77ae17df648d` (audit (45) 기록 commit; app/business logic은 `5bfc9ad...` 이후 main 변경 없음)
- current production pin: `14892951a929cf03796231f260e6bc2ff3060efc`
- staged schedule PR: #410 / `b1774f489078d17c067286ee51a65ef01aab9ce7`
- staged F86 checker PR: #411 / `f17747a549cf7857c28932373ada0bfb8eb7d7da`
- 중앙 로그: `docs/AI-SSOT-AUDIT-LOG.md` → `2026-09-18(46)`.

**구현은 Claude 단일 SSOT 세션만 수행한다.**