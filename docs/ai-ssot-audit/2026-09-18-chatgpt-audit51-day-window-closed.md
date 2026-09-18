# 2026-09-18 ChatGPT 독립 SSOT 감사 — audit (51)

## 판정

**MATERIAL / OPEN 강화.** PR #410의 `:17` 전환 뒤 당일 남아 있던 canonical ERP5 scheduled slot 3개(`17:17`, `18:17`, `19:17` KST)가 모두 실제 `event=schedule`로 관측되지 않았다. `19:17`은 금요일 기준 당일 마지막 canonical ERP5 slot이므로, `:05 → :17` 변경이 **당일 cadence recovery를 만들었다는 운영 증거는 확보되지 않았다.**

## 직접 확인한 증거

- 감사 직전 `origin/main`은 `8bd0b01abbf23d2ed716f9c81c02a4bdca91bd7c`이며 audit (50) 이후 변경은 감사 문서 정리뿐이다. application/business logic 신규 변경은 없다.
- current main `.github/workflows/erp5-ssot-refresh.yml`은 `cron: '17 0-10 * * 1-6'`, 즉 월~토 KST `09:17~19:17`을 선언하고 production engine `14892951a929cf03796231f260e6bc2ff3060efc`을 checkout한다.
- 2026-09-18 **19:22 KST 이후** repository-wide `event=schedule`를 재조회했지만 latest scheduled run은 여전히 `35304903901` (`ERP5 SSOT 원천 최신화(매시간)`), created `2026-09-18 12:53:42 KST`, conclusion `failure`다.
- 따라서 PR #410 merge 이후 남아 있던 `17:17`, `18:17`, `19:17` 세 ERP5 slot 모두 새 schedule event가 생성됐다는 증거가 없다. audit (50)의 2회 연속 부재보다 한 단계 강한 운영 증거다.
- repository-wide gap도 그대로다. `mirror-sync.yml`은 `*/30 * * * *`, `sales-erp-hourly.yml`은 평일 KST 09:00~18:00, `settlement-sync.yml`은 월~토 KST 09:05~18:05 scheduled apply를 선언한다. repository latest schedule이 12:53에 머문 이상 그 이후 이 writer들의 정상 schedule delivery 증거도 없다.
- 반면 current main push CI run `35330351266`은 head `8bd0b01...`, created `2026-09-18 18:35:44 KST`, conclusion `success`다. **Actions 전체 중단이 아니라 scheduled-event delivery만 장시간 미관측**이라는 audit (50)의 경계는 더 강해졌다.
- GitHub scheduled workflow는 지연될 수 있으므로 `:17` cron 자체가 잘못됐거나 GitHub scheduler가 영구 장애라고 단정하지 않는다. 정확한 현재 판정은 **same-day cadence recovery unproven / repository-wide scheduled-event delivery OPEN**이다.

## 함께 재확인한 SSOT 경계

- canonical registry는 계속 RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar, RP031=Google Sheet다.
- `MIRROR_SOURCES` RP023은 여전히 옛 Google Sheet를 `from`으로 갖는다. mirror는 canonical inventory source가 아니다.
- production F86 plan은 `종합`만 timestamp, 공급사 탭은 `회사 · N대`, 장기요금 없는 차도 빈 요금 칸으로 포함한다.
- production `audit-f86-vs-atom.mts`는 여전히 모든 탭에 초 단위 timestamp를 요구해 current naming과 충돌한다. PR #411(`f17747a549cf7857c28932373ada0bfb8eb7d7da`)은 여전히 draft/open이며 production에 미승격이다.
- current main canonical `deposit-policy.ts`와 production special-tab local deposit semantics의 audit (22) split, audit (27) Sonogong deposit recurrence, audit (28) vehicle-price source→Atom lineage, audit (29) sales-tab naming migration, audit (34) newest-Atom freshness, RP031 provenance, RP023 mirror 및 mirror/sales/settlement legacy writer ownership은 직접 해소 증거가 없어 유지한다.

## Claude 구현 Owner 인계

1. PR #410의 `:17` code/config 반영은 완료로 두되, **2026-09-18 당일 post-merge 잔여 3/3 slot 미관측**을 cadence recovery 실패 증거가 아니라 recovery **미증명** 증거로 정확히 다룬다.
2. ERP5 하나만 보지 말고 repository-wide workflow enabled/disabled 상태와 scheduled-event delivery를 확인한다. push CI 정상과 schedule event 부재를 분리한다.
3. 실제 `event=schedule`이 여러 연속 회차로 다시 생성되기 전 cadence/timeliness HOLD를 닫지 않는다. 수동 dispatch/push는 대체 증거가 아니다.
4. PR #411은 merge/repin + actual scheduled F86 freshness green 전까지 OPEN 유지한다. 차량/칸 parity 검사는 약화하지 않는다.
5. 기존 RP031/deposit/vehicle-price/sales-tab/newest-Atom/mirror/sales/settlement HOLD는 각각 직접 해소 증거가 생길 때만 닫는다.

이번 ChatGPT 감사에서는 application code나 business logic을 수정하지 않았다.
