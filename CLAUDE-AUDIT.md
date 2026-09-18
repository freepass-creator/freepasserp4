# ChatGPT → Claude SSOT 감사 진입점 — audit (51) override

> 이 파일은 구현 지시의 최신 진입점이다. Claude 단일 SSOT 세션만 application/business logic을 수정한다. ChatGPT는 독립 감사·증거 기록만 한다.

## 최신 판정

### 1) OPEN/HOLD(runtime cadence) — `:17` 전환 당일 post-merge 잔여 3/3 ERP5 slot 미관측, repository-wide schedule delivery gap

PR #410은 merge 완료됐고 canonical ERP5 cron은 `17 0-10 * * 1-6` = 월~토 KST 09:17~19:17이다.

2026-09-18 19:22 KST 이후 repository-wide `event=schedule`를 재조회했지만 latest scheduled run은 여전히:

- run `35304903901`
- workflow `ERP5 SSOT 원천 최신화(매시간)`
- created `2026-09-18 12:53:42 KST`
- conclusion `failure` (기존 F86 freshness checker false-positive)

이다. 따라서 post-merge `17:17`, `18:17`, `19:17` **당일 잔여 세 ERP5 slot 모두 schedule event가 생성됐다는 증거가 없다.** `19:17`은 오늘 마지막 canonical ERP5 slot이므로 `:05 → :17` 이동으로 **same-day cadence recovery가 됐다는 증거는 확보되지 않았다.**

또 current main의 다른 scheduled apply writer인 `mirror-sync.yml`(30분), `sales-erp-hourly.yml`(평일 09:00~18:00 KST), `settlement-sync.yml`(월~토 09:05~18:05 KST)도 repository-wide schedule latest가 12:53에 멈춘 이상 같은 시간대의 새 schedule evidence가 없다. **ERP5 단일 cron 문제가 아니라 repository-level scheduled-event delivery gap으로 진단할 것.**

반면 push-triggered CI run `35330351266`은 18:35:44 KST에 current main head `8bd0b01...`로 생성돼 success했다. Actions 전체 장애라고 단정하지 말고, schedule delivery와 push execution을 분리해서 본다.

GitHub scheduled workflow는 지연될 수 있으므로 `:17` 변경 자체가 실패했다고 단정하지 않는다. 정확한 판정은 **same-day cadence recovery unproven / scheduled-event delivery OPEN**이다. 실제 `event=schedule`이 여러 연속 회차로 재등장하기 전까지 cadence/timeliness HOLD를 유지한다. 수동 dispatch/push는 schedule 복구 증거가 아니다.

### 2) RESOLVED(운영 증거) / OPEN(checker) — current production pin full apply는 증명됨, F86 freshness false-positive만 남음

run `35310163711`은 `workflow_dispatch`, `apply=true`로 current production pin `14892951a929cf03796231f260e6bc2ff3060efc`을 실제 checkout해 source 24/24 ingest, Atom, snapshot, public catalog, F01 678대, F86 19탭/678대, Atom↔F01↔F86 parity, photo-link audit까지 수행했다. 데이터/발행 parity는 PASS다.

전체 job의 blocker는 current tab naming을 `탭 이름에 발행 시각이 없다`로 오판하는 F86 freshness checker다. PR #411 / head `f17747a549cf7857c28932373ada0bfb8eb7d7da`는 이 계약 정렬안이지만 **여전히 draft/open, merged=false**다.

**우선순위:** PR #411 review/merge → production pin 전진 + `VALIDATED_ENGINES` 등록 → 실제 scheduled run에서 F86 freshness step 자체가 green인지 확인한다. 차량/칸 parity 검사는 약화하지 않는다.

### 3) IMPORTANT topology 정정 유지 — F86 freshness step은 downstream cross/photo audit gate가 아님

current `erp5-ssot-refresh.yml`에서 cross-audit와 photo-audit은 freshness step outcome이 아니라 F01/F86 publish outcome으로 실행된다. run `35310163711`에서도 freshness failure 뒤 cross-audit/photo-audit은 모두 success했다. 이미 확보된 downstream parity 증거를 skipped로 취급하지 않는다.

### 4) 색상 상태 — code/contract + publisher execution RESOLVED, color-specific effectiveFormat proof HOLD

PR #409로 production pin이 `14892951...`로 올라가며 `신차렌트=#FF00FF` 및 publisher color-SSOT 참조가 포함됐고 run `35310163711`로 full `apply=true` publisher 실행도 증명됐다. 다만 Google Sheets `effectiveFormat` 직접 assert는 별도 HOLD다.

### 5) OPEN/HOLD — RP031 provenance

RP031 canonical registry는 계속 Google Sheet(`1fJu...`)다. API inventory + rendered-DOM finance feeder가 canonical Sheet에 실제 write한 crossing은 남아 있다. backup↔live diff, 신규/변경 identity, finance cells provenance와 deterministic mapping 증명이 끝나기 전 DOM-derived finance를 독립 authoritative SSOT로 승격하지 않는다.

### 6) 기존 HOLD 유지

직접 해소 증거가 없는 다음 항목은 유지한다.

- RP023 canonical RebornCar vs legacy `MIRROR_SOURCES` old Google Sheet source
- `mirror-sync.yml` 30분 scheduled apply writer
- `sales-erp-hourly.yml` 평일 scheduled apply writer
- `settlement-sync.yml` legacy ledger→supplier-status writer
- audit (22) Sonogong/AutoPlus deposit-policy 이중정의
- audit (27) Sonogong deposit recurrence
- audit (28) vehicle-price source→Atom lineage
- audit (29) sales-tab naming migration
- audit (34) newest-Atom freshness semantics

## 현재 기준

- current production pin: `14892951a929cf03796231f260e6bc2ff3060efc`
- canonical schedule: KST `:17` / PR #410 merged
- latest independently observed scheduled evidence: run `35304903901` at 2026-09-18 12:53:42 KST
- missing post-merge ERP5 slots independently observed: `17:17`, `18:17`, `19:17` KST (오늘 잔여 3/3)
- push CI counter-evidence: run `35330351266` at 18:35:44 KST success
- staged F86 checker PR: #411 / `f17747a549cf7857c28932373ada0bfb8eb7d7da` (draft/open)
- 상세 근거: `docs/ai-ssot-audit/2026-09-18-chatgpt-audit51-day-window-closed.md`
- 중앙 로그: `docs/AI-SSOT-AUDIT-LOG.md` → `2026-09-18(51)`

**구현은 Claude 단일 SSOT 세션만 수행한다.**
