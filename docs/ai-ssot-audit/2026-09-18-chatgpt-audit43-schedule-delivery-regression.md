# 2026-09-18 ChatGPT 독립 SSOT 감사 — audit (43)

## 판정

**운영 회귀 / OPEN — scheduled event delivery가 다시 멈춘 상태로 보인다.** audit (35)에서 단 한 번 재출현했던 `event=schedule` run 이후, 2026-09-18 10:21 KST 현재 repository 전체에 새로운 scheduled run이 없다. 원인이 workflow disabled인지 GitHub scheduler delivery 문제인지는 현재 증거만으로 단정하지 않는다.

## 1. 현재 Actions 관측

GitHub Actions repository-wide `event=schedule` 조회에서 최신 run은 여전히 다음 한 건이다.

- run: `35235961510`
- workflow: `ERP5 SSOT 원천 최신화(매시간)`
- created: `2026-09-17T14:47:38Z` = `2026-09-17 23:47:38 KST`
- conclusion: `failure`

2026-09-18 10:21 KST까지 그 뒤 schedule event가 생성되지 않았다.

반면 push/manual 계열 Actions는 같은 오전에도 실행되고 있다. 따라서 이 관측은 GitHub Actions 전체가 멈췄다는 증거가 아니라 **schedule delivery/enablement 경로에 국한된 운영 증거**다.

## 2. 선언된 schedule과 실제 미생성

current main은 여전히 다음 자동 schedule을 선언한다.

1. `.github/workflows/mirror-sync.yml`
   - `cron: '*/30 * * * *'`
   - schedule이면 `scripts/sync-mirror-all.mts --apply`
2. `.github/workflows/sales-erp-hourly.yml`
   - `cron: '0 0-9 * * 1-5'`
   - 평일 KST 09:00~18:00
3. `.github/workflows/erp5-ssot-refresh.yml`
   - `cron: '5 0-10 * * 1-6'`
   - 월~토 KST 09:05~19:05
   - production checkout pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`

따라서 금요일인 2026-09-18 10:21 KST 기준으로 최소한 sales writer의 09:00/10:00, ERP5 canonical의 09:05/10:05, mirror writer의 다수 30분 회차가 생성됐어야 한다. repository-wide 최신 `event=schedule`이 전날 23:47에 머물러 있으므로 이 회차들은 실제 생성되지 않았다.

## 3. audit (35)와의 관계

audit (35)는 run `35235961510`의 출현으로 audit (31)의 “schedule 0건” 관측을 부분 해소했지만, 해당 run 자체가 선언된 마지막 slot 19:05보다 4시간 42분 이상 늦어 **cadence/timeliness 정상화는 HOLD**로 남겼다.

이번 audit (43)은 그 HOLD를 더 강하게 재확인한다. 다음 영업일 오전의 선언된 schedule들이 연속으로 생성되지 않았으므로, `workflow_dispatch` 또는 단발성 늦은 run을 자동화 복구 증거로 사용하면 안 된다.

복구 판정은 최소 다음을 요구한다.

- 실제 `event=schedule` run이 선언된 시간대에 지속적으로 생성될 것
- canonical ERP5 run이 current production pin에서 source → Atom → snapshot → F01/F86 경로를 수행할 것
- audit (35)의 F86 freshness checker drift를 고친 뒤 full run green을 별도로 증명할 것

## 4. 코드/SSOT 상태는 audit (42) 이후 변하지 않음

PR #403 merge `88b16da5c07a1091eba401540891c41280731408` 이후 current main `8c520685c47807abf29fbcc23b34f6cf7c730b84`까지 application/business-logic delta는 없다. 변경은 audit 문서와 일회성 audit recorder 정리뿐이다.

따라서 다음 판정은 유지한다.

- RP031 registry는 계속 Google Sheet canonical
- production pin은 계속 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`
- audit (42)의 RP031 FILLIFEMPTY mitigation 및 identity/finance boundary HOLD 유지
- audit (35)의 F86 freshness checker OPEN 유지
- audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming, audit (34) newest-Atom freshness semantics 유지
- mirror/sales/settlement/RTDB legacy writer ownership HOLD 유지

## Claude 구현 Owner 인계

1. 우선 GitHub workflow enabled 상태와 schedule delivery 자체를 확인한다. 원인이 확인되기 전 임의로 코드 원인으로 단정하지 않는다.
2. 수동 dispatch 성공이나 Atom의 최신 timestamp를 scheduled automation 복구 증거로 사용하지 않는다.
3. 선언 시간대에 실제 `event=schedule` run이 연속 생성되는 것을 확인한 뒤 cadence를 해소 판정한다.
4. 별도로 audit (35)의 F86 checker contract를 고치고 canonical scheduled full-run green을 증명한다.
5. audit (42) RP031 write/promotion HOLD 및 기존 SSOT HOLD를 그대로 유지한다.

이번 독립 감사에서는 application code/business logic을 수정하지 않았다.
