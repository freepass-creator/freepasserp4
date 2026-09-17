# ChatGPT 독립 SSOT 감사 — audit 31: canonical schedule delivery 재오픈

검수일: 2026-09-17 20:23 KST

## 판정

**운영 schedule-delivery/enablement drift를 다시 OPEN으로 판정한다.**

Claude 구현 로그에는 F86 A1 오류를 고친 뒤 `erp5-ssot-refresh.yml`을 `disabled_manually → active`로 재활성화했다고 기록돼 있다. 그러나 현재 repository의 cron 선언과 실제 GitHub Actions `schedule` event 기록이 다시 갈린다. 이번 감사에서는 정확한 원인을 `disabled`라고 단정하지 않는다. 확인된 사실은 **2026-09-17 하루 동안 scheduled event가 0건**이라는 것이다.

## 증거 1 — canonical workflow는 여전히 hourly cron을 선언한다

current main `.github/workflows/erp5-ssot-refresh.yml`:

- workflow: `ERP5 SSOT 원천 최신화(매시간)`
- cron: `5 0-10 * * 1-6`
- 의미: 월~토 KST 09:05~19:05
- production checkout ref: `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`

따라서 2026-09-17 목요일에는 repository 선언상 09:05~19:05 scheduled runs가 존재해야 한다.

## 증거 2 — 2026-09-17 `event=schedule`은 전체 repository 기준 0건

GitHub Actions API 조회:

`actions/runs?event=schedule&created=2026-09-17&per_page=100`

결과:

- `total_count: 0`
- `workflow_runs: []`

감사 시각은 20:23 KST이므로 당일 canonical cron의 마지막 예정 시각(19:05)도 이미 지났다. ERP5 refresh만 빠진 것이 아니라 **repository 전체 scheduled event가 0건**이다.

## 증거 3 — 마지막 관측 canonical scheduled run은 전날이다

2026-09-16 scheduled event 목록에서 마지막으로 확인되는 canonical ERP5 run:

- run `35053074482`
- workflow `ERP5 SSOT 원천 최신화(매시간)`
- event `schedule`
- conclusion `success`
- created `2026-09-16T03:46:35Z` = 2026-09-16 12:46:35 KST
- workflow id `358276101`

그 뒤 audit (23)에서 workflow가 disabled였음이 확인됐고, Claude 구현 로그는 F86 A1 fix 후 이를 다시 active로 돌렸다고 적었다. 하지만 이번 독립 조회에서는 **재활성화 뒤 실제 scheduled dispatch 증거가 없다.**

## 범위

- audit (30)의 F86 A1 values-write blocker production 해소 판정은 유지한다. one-time run `35208040283`의 F86 publish 성공은 유효하다.
- 그러나 그 one-time/manual run은 canonical `schedule` source→Atom→snapshot→F01/F86 full path가 자동으로 다시 돌고 있다는 증거가 아니다.
- audit (23)의 F86 freshness checker drift는 계속 OPEN이다.
- audits (27)/(28)/(29)의 Sonogong deposit recurrence, vehicle-price semantics, sales-tab naming migration도 계속 OPEN이다.
- canonical source는 RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar로 변화 없다.
- mirror/RTDB legacy writer는 canonical source 권한이 없고 기존 ownership HOLD를 유지한다.
- audit (30) 이후 main의 신규 변경은 이안카 사이트/계정 진단용 read-only workflow·script 계열이며, 이번 schedule gap을 해소하는 core SSOT 변경은 확인되지 않았다.

## Claude 구현 Owner 인계

1. GitHub Actions에서 `erp5-ssot-refresh.yml`의 **실제 enabled state와 schedule delivery**를 확인한다. repository cron이 존재한다는 것만으로 active라고 판단하지 않는다.
2. 자동 운용이 의도라면 실제 `event=schedule` 회차가 다시 생성되는 것까지 증명한다. `workflow_dispatch`나 one-time writer 성공으로 대체하지 않는다.
3. 그 scheduled run이 current production pin을 사용해 source→Atom→snapshot→F01/F86을 통과하는지 확인하고, F86 freshness checker 정렬 후 cross-audit까지 green을 확보한다.
4. schedule event가 없다는 사실을 writer retirement로 간주하려면 repository의 cron/예약지도/ownership 계약도 함께 그 의도에 맞게 변경돼 있어야 한다.

이번 감사에서는 application code/business logic을 수정하지 않았다.
