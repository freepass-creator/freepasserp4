# ChatGPT → Claude SSOT 감사 진입점 — audit (48) override

> 이 파일은 구현 지시의 최신 진입점이다. Claude 단일 SSOT 세션만 application/business logic을 수정한다. ChatGPT는 독립 감사·증거 기록만 한다.

## 최신 판정

### 1) RESOLVED(운영 증거) / OPEN(checker) — current production pin full apply는 증명됨, F86 freshness false-positive만 남음

run `35310163711`은 `workflow_dispatch`, `apply=true`로 current production pin `14892951a929cf03796231f260e6bc2ff3060efc`을 실제 checkout해 전체 발행 경로를 수행했다.

- source preflight 24/24 success
- 실제 ERP5 ingest 24/24 success
- settlement `접수/취소` Atom-lock bridge success
- snapshot: 등록 1,615 / 출고불가 937 / 현재 재고 678
- public catalog: expected=actual 671, mismatch 0
- F01: 678대 발행 success
- F86: 19탭 / 678대 발행 success
- Atom↔F01↔F86: missing/extra/value diff 0
- photo-link audit: mismatch 0

따라서 audit (46)의 “new pin apply=true 운영 증거 없음”은 닫는다.

다만 전체 job은 F86 freshness checker false-positive 하나로 red다. 같은 checker가 freshness oldest 0분, 19탭 / 1,067행 / 44,283칸 / value mismatch 0을 계산한 뒤 current tab naming을 `탭 이름에 발행 시각이 없다` 19건으로 오판했다.

PR #411 / head `f17747a549cf7857c28932373ada0bfb8eb7d7da`은 이 계약 정렬안이지만 **여전히 draft/open, merged=false**이고 production pin은 움직이지 않았다.

**우선순위 1:** PR #411 review/merge → production pin 전진 + `VALIDATED_ENGINES` 등록 → 실제 apply/scheduled run에서 F86 freshness step 자체가 green인지 확인한다. 차량/칸 parity 검사는 약화하지 않는다.

### 2) IMPORTANT topology 정정 — F86 freshness step은 downstream cross/photo audit 실행 gate가 아님

current `erp5-ssot-refresh.yml`은:

- cross-audit를 F01/F86 publish outcome으로 실행하고,
- photo audit를 F86 publish outcome으로 실행하며,
- freshness step outcome에 의존하지 않는다.

실제 run `35310163711`에서도 freshness step이 failure였는데 Atom↔F01↔F86 cross-audit와 photo-link audit은 모두 실행되어 success했다.

따라서 checker fix는 필요하지만 이미 확보된 downstream parity 증거를 skipped로 취급하지 않는다.

### 3) RESOLVED(code/config) / HOLD(runtime cadence) — PR #410 merge, canonical cron은 `:17`

PR #410은 더 이상 staged/open이 아니다.

- merged: `2026-09-18 16:56:59 KST`
- merge commit: `9f74933f073f5fdfc94985efa5f9de45ecc3bc71`
- current canonical cron: `17 0-10 * * 1-6` = 월~토 KST 09:17~19:17
- `docs/예약작업-지도.md`도 같은 `:17` 규격으로 정렬됨
- production pin `14892951...`, 단계, concurrency, source/Atom/F01/F86 business logic은 이 merge에서 변경되지 않음

따라서 audit (47)의 “PR #410 open/unmerged, current schedule `:05`” 설명은 stale이며 이 항목으로 override한다.

다만 **schedule delivery/cadence HOLD는 닫지 않는다.** audit (48) 시작 시각은 17:12 KST였고 merge 뒤 첫 `:17` 예정 회차는 17:17 KST였다. merge만으로 실제 GitHub `event=schedule` 전달이 복구됐다고 볼 수 없다. 실제 post-merge `:17` 회차가 생성되고 이어지는 회차도 정상 cadence로 도착하는지 확인한다. 마지막 독립 관측 scheduled evidence는 audit (45)의 run `35304903901`이다.

### 4) RESOLVED(code/contract + publisher execution), 색상 특화 runtime 증명 HOLD — 신차렌트 `#FF00FF`

PR #409로 production pin이 `14892951...`로 올라가며 `신차렌트=#FF00FF` 및 publisher color-SSOT 참조가 포함됐고 Source Contract가 green이었다. run `35310163711`로 이 pin의 실제 full `apply=true` publisher 실행까지 증명됐다.

다만 해당 run 로그가 Google Sheets `effectiveFormat`의 `신차렌트=#FF00FF`를 직접 assert하지 않으므로 **code/contract + new-pin live publisher execution은 해소**, color-specific live visual/effectiveFormat proof만 별도 HOLD다.

### 5) OPEN/HOLD — RP031 provenance

RP031 canonical registry는 계속 Google Sheet(`1fJu...`)다. audit (44)의 API inventory + rendered-DOM finance feeder가 canonical Sheet에 실제 write한 crossing은 되돌아가지 않았다. backup↔live diff, 신규/변경 identity, finance cells provenance와 deterministic mapping 증명이 끝나기 전 DOM-derived finance를 독립 authoritative SSOT로 승격하지 않는다.

### 6) 기존 HOLD 유지

직접 해소 증거가 없늕 다음 항목은 유지한다.

- RP023 canonical RebornCar vs legacy `MIRROR_SOURCES` old Google Sheet source.
- `mirror-sync.yml` 30분 scheduled apply writer.
- `sales-erp-hourly.yml` 평일 scheduled apply writer.
- `settlement-sync.yml` legacy ledger→supplier-status writer.
- audit (22) Sonogong/AutoPlus deposit-policy 이중정의(main canonical fail-closed vs production local fallback 포함).
- audit (27) Sonogong deposit recurrence.
- audit (28) vehicle-price source→Atom lineage.
- audit (29) sales-tab naming migration.
- audit (34) newest-Atom freshness semantics.

## 현재 기준

- current main: `9f74933f073f5fdfc94985efa5f9de45ecc3bc71` (PR #410 merged)
- current production pin: `14892951a929cf03796231f260e6bc2ff3060efc`
- new-pin full apply evidence: run `35310163711`
- canonical schedule: KST `:17` / PR #410 merged
- latest independently observed scheduled evidence: run `35304903901` (pre-`:17` change)
- staged F86 checker PR: #411 / `f17747a549cf7857c28932373ada0bfb8eb7d7da` (draft/open)
- 상세 근거: `docs/ai-ssot-audit/2026-09-18-chatgpt-audit48-schedule-pr410-merged.md`
- 중앙 로그: `docs/AI-SSOT-AUDIT-LOG.md` → `2026-09-18(48)`

**구현은 Claude 단일 SSOT 세션만 수행한다.**
