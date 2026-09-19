# 2026-09-19 ChatGPT 독립 SSOT 감사 63 — heartbeat recovery / trigger topology drift

## 판정

**MATERIAL / PARTIAL RESOLVED + GOVERNANCE DRIFT + WATCH(native schedule).**

Audit (62) 이후 application/business logic은 건드리지 않은 채 automation recovery topology가 실제로 확장됐다. settlement intake bootstrap failure는 자동복구 경로로 해소됐지만, native GitHub `event=schedule` delivery는 아직 복구 증거가 없고, 운영 지도/CI guard는 새 non-cron production trigger topology를 아직 표현·검증하지 못한다.

## 1. current main / 새 automation 변경

감사 기준 current main은 `dde2268bb651cf6be9fba58e148f89008dc41024`다. audit (62) 이후 의미 있는 automation 변경은 다음이다.

- `59ee4ed44130818482d6abaaa73669da34957607` — `settlement-intake-sync.yml`에 main의 `.automation/heartbeats/settlement-intake-sync.txt` 전용 `push` fallback을 추가. `push`는 `schedule`과 동일하게 production `--apply` 경로를 탄다.
- `4695feb13c9881f27781dfe18d1cd47d1abc7939` — 성공한 settlement workflow 뒤 `workflow_run`으로 canonical ERP5 refresh를 이어 실행하도록 연결.
- `f900a2fea8bd45ddfb1ae628a5ac8afed8b4ef4a` — ERP5에도 `.automation/heartbeats/erp5-ssot-refresh.txt` 전용 direct `push` fallback을 추가. 이 push도 source ingest → Atom → snapshot → F01/F86 production path를 탈 수 있다.
- `15e56c262ac5c95d8dde4edc6dd3c82c5e8733d7` — settlement apply가 `프리패스 당월 계약접수` 부재로 실패한 경우에 한해 canonical intake sheet를 1회 생성하고 retry하는 auto-heal 추가.
- `dde2268bb651cf6be9fba58e148f89008dc41024` — recovery run/ERP5 chain 상태를 `.automation/safe-chain-monitor.json`에 기록.

따라서 audit (62)의 “cron 09:05 settlement → cron 09:17 ERP5”만으로 설명한 trigger topology는 현재 상태를 다 담지 못한다.

## 2. runtime — 첫 heartbeat recovery 실패 후 auto-heal 재시도 성공

첫 settlement heartbeat recovery run `35412968175`는 `push` event로 시작됐으나 failure였다. 실제 로그의 직접 원인은:

`Error: 「프리패스 당월 계약접수」를 못 찾았다 — create-contract-intake-sheet.mts 먼저`

였다. 즉 새 settlement automation이 사용해야 할 canonical intake sheet가 아직 생성되지 않은 bootstrap gap이 runtime에서 실제 드러났다.

그 뒤 auto-heal commit이 들어간 current main에서 retry run `35413059063`은 `push` event로 **success**했다.

- missing intake sheet를 감지
- canonical intake sheet를 `create-contract-intake-sheet.mts --apply`로 생성
- intake sync를 재시도
- 당시 접수 0대라 ledger 이동행은 0
- ledger 용어/서식 단계까지 success

따라서 “canonical intake sheet 자체가 없어 safe settlement automation이 즉시 죽는 문제”는 current recovery path에서 **해소됨**으로 판정한다.

## 3. canonical ERP5 chain — 시작 확인, full green은 아직 미확정

성공한 settlement recovery `35413059063` 뒤 canonical ERP5 `workflow_run` **`35413099804`**가 생성됐다.

감사 시점 상태:

- event = `workflow_run`
- production engine pin = `cf940df642edf315adbc6da2b4134fbad53da160`
- checkout / OIDC / source contract / credentials / source collection / paid-option audit / ledger contract-lock 단계 success
- `원천에서 ERP5 현재 원자 계산` 단계 in progress

따라서 chained canonical production path가 **실제로 시작되는 것**은 증명됐지만, snapshot → F01/F86 → freshness/cross-parity/photo까지 full green 완료됐다고 아직 기록하지 않는다.

current main CI run `35413059072`은 success다.

## 4. native GitHub schedule WATCH는 해소되지 않음

repository-wide `event=schedule`를 다시 조회했지만 newest scheduled run은 여전히:

- `35347508078`
- ERP5 canonical
- created 2026-09-18 21:58:18 KST
- conclusion success

이다. 2026-09-19 native `schedule` event는 새로 관측되지 않았다.

따라서 heartbeat `push` recovery 성공이나 `workflow_run` chain 성공을 **native cron delivery 복구 증거로 대체하지 않는다.** 정확한 판정은 native schedule **WATCH / delayed-or-missing** 유지다.

## 5. 신규 governance drift — 예약지도와 `check:schedules`가 non-cron production trigger를 못 본다

current `docs/예약작업-지도.md`는 아직 자동운영을 cron 중심으로 설명한다.

- settlement 09:05~18:05
- ERP5 09:17~19:17
- settlement → ERP5를 시간순 흐름으로만 설명
- external heartbeat push fallback / `workflow_run` chain / ERP5 direct heartbeat push를 운영 trigger map에 기록하지 않음

current `scripts/check-schedule-map.mts`도 cron 문자열과 retired schedule 재생성, legacy settlement writer 재연결은 검사하지만 **`push.paths` heartbeat trigger와 `workflow_run` production trigger topology는 검사하지 않는다.**

따라서 current CI가 green이어도 운영 지도와 실제 production writer trigger plane이 어긋날 수 있다. 이 항목은 **governance/observability drift**다. 감사자는 운영 코드/비즈니스 로직을 수정하지 않고 Claude 구현 Owner에게 넘긴다.

## 6. 기존 canonical/projection 경계 재확인

이번 automation delta에서 다음 계약의 신규 회귀는 확인되지 않았다.

- production pin `cf940df642edf315adbc6da2b4134fbad53da160`
- 24-source canonical registry; RP006=Iron website, RP012=Sonogong ERP/API, RP023=RebornCar
- F01/F86 fixed snapshot projection
- F86 `종합`에서 손오공/오토플러스 제외, 두 공급사는 고유 탭/고유 요금축 유지
- `mirror-sync.yml`, `sales-erp-hourly.yml`은 manual dry-run only로 retired
- RTDB는 canonical inventory writer/source로 복귀하지 않음

기존 RP023/RP031 provenance, deposit-policy/recurrence, vehicle-price, sales-tab naming, newest-Atom freshness, `/inventory` boundary HOLD도 직접 해소 증거가 없어 유지한다.

## Claude 구현 Owner 인계

1. heartbeat recovery를 임의로 되돌리지 말고 **이 recovery trigger plane을 승인된 production architecture로 둘지** 먼저 결정한다.
2. 승인한다면 `docs/예약작업-지도.md`와 `check:schedules`가 cron뿐 아니라 heartbeat `push.paths`, settlement→ERP5 `workflow_run`, ERP5 direct heartbeat fallback까지 fail-closed로 검증하도록 정합화한다.
3. 승인하지 않는다면 native schedule reliability를 실제 연속 `event=schedule` green으로 먼저 증명한 뒤 fallback trigger를 retire한다.
4. `35413099804`가 snapshot/F01/F86/audits까지 full green으로 끝나는지 확인한다.
5. native cron WATCH는 실제 `event=schedule` 재출현 전까지 유지한다.

이번 ChatGPT 독립 감사에서는 application code/business logic을 수정하지 않았다.
