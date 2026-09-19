# 2026-09-19 ChatGPT 독립 SSOT 감사 64 — chained ERP5 full green / native schedule WATCH

## 판정

**PARTIAL RESOLVED / production chain runtime PASS / native GitHub schedule WATCH + governance drift 유지.**

Audit (63) 작성 시 `workflow_run`으로 실행 중이던 canonical ERP5 run `35413099804`가 끝까지 **success**로 완료됐다. 따라서 heartbeat settlement recovery → canonical ERP5 chain은 실제 production runtime에서 full path를 통과했다. 다만 이 성공은 `event=workflow_run`이며 native GitHub `event=schedule` delivery 복구 증거가 아니다.

## 1. settlement recovery → ERP5 chain full green

선행 settlement heartbeat recovery:

- run `35413059063`
- event=`push`
- conclusion=`success`
- missing `프리패스 당월 계약접수` canonical sheet를 auto-heal로 생성한 뒤 intake sync 재시도 성공

그 뒤 생성된 canonical ERP5:

- run `35413099804`
- event=`workflow_run`
- conclusion=`success`
- production engine=`cf940df642edf315adbc6da2b4134fbad53da160`

최종 job에서 다음 production 단계가 모두 success로 종료됐다.

- checkout / OIDC / npm install / Source Contract
- canonical source collection
- paid-option audit
- settlement ledger contract lock
- ERP5 current Atom calculation
- policy reference reconciliation
- fixed snapshot
- public catalog reconciliation
- F01 publish
- F86 backup + publish
- F86↔Atom freshness/value audit
- Atom↔F01↔F86 cross-audit
- vehicle-number/photo-link audit
- run evidence preservation

따라서 audit (63)의 `35413099804 in progress / full green 미확정` 항목은 **RESOLVED**다.

## 2. native schedule WATCH는 그대로

repository-wide `event=schedule`를 다시 조회했지만 최신 scheduled run은 여전히:

- `35347508078`
- ERP5 canonical
- created `2026-09-18 21:58:18 KST`
- conclusion=`success`

이다. 2026-09-19 native `schedule` event는 아직 새로 관측되지 않았다.

따라서 정확한 운영 판정은:

- settlement heartbeat recovery: PASS
- settlement→ERP5 `workflow_run` canonical chain: **full runtime PASS**
- native cron delivery: **WATCH / delayed-or-missing**

이다. `push`/`workflow_run` recovery 성공을 native cron 정상화로 대체하지 않는다.

## 3. governance drift도 유지

Audit (63)에서 확인한 다음 drift는 이 runtime success로 해소되지 않는다.

- `docs/예약작업-지도.md`가 heartbeat `push.paths`, settlement→ERP5 `workflow_run`, ERP5 direct heartbeat fallback을 production trigger map으로 표현하지 않음
- `scripts/check-schedule-map.mts`가 cron map/retired writer/legacy settlement 재연결은 검사하지만 위 non-cron production trigger plane은 fail-closed로 검증하지 않음

따라서 current CI가 green이어도 실제 production trigger plane과 운영지도가 갈릴 수 있다.

## 4. 기존 canonical 경계

이번 runtime completion은 source/projection/business rule 변경이 아니다. 다음 기존 계약은 그대로다.

- production pin `cf940df642edf315adbc6da2b4134fbad53da160`
- 24-source ERP5 canonical registry
- RP006=Iron website, RP012=Sonogong ERP/API, RP023=RebornCar
- F01/F86 fixed-snapshot projection
- F86 `종합`에서 Sonogong/AutoPlus 제외, 두 공급사는 자기 전용 탭/고유 요금축 유지
- retired mirror/sales/contract automatic writers는 manual dry-run only
- RTDB/mirror는 canonical inventory source/writer 권한 없음

기존 RP023/RP031 provenance, deposit policy/recurrence, vehicle-price lineage, sales-tab naming, newest-Atom freshness, `/inventory` boundary HOLD도 직접 해소 증거가 없어 유지한다.

## Claude 구현 Owner 인계

1. `35413099804`는 **full green**으로 닫는다.
2. heartbeat/workflow-run recovery plane을 승인된 production architecture로 둘지 결정하고, 승인 시 예약지도 + `check:schedules`가 non-cron trigger plane까지 fail-closed로 검증하도록 정합화한다.
3. native cron WATCH는 실제 `event=schedule` 재출현 및 연속 성공 전까지 유지한다.
4. recovery 성공을 근거로 native cron 또는 기존 HOLD를 자동 해소 처리하지 않는다.

이번 ChatGPT 독립 감사에서는 application code/business logic을 수정하지 않았다.
