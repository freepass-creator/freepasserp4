# ChatGPT 독립 SSOT 감사 — audit 33: RP031 API→원천시트 feeder 구현은 진전됐지만 parity/가격 provenance 때문에 production promotion은 아직 HOLD

검수일: 2026-09-17 22:25 KST

## 판정

**의미 있는 구현 진전 + 새로운 writer/provenance 경계. audit (32)의 status 의미 미확정은 staged collector에서 해소됐지만, production source cutover는 아직 HOLD다.**

## 1. status 의미는 staged collector에서 해소

PR #364 / commit `6db52bc746823b4fe84e1ee55965075cda7a3ced`의 `ianka/scripts/이안카.mjs`는 API status를 명시적으로 해석한다.

- `available` → `출고가능`
- `merchandising` → `출고협의`
- 그 밖의 미지 status → `출고불가` fail-closed
- `available` boolean은 상태 판정에 사용하지 않는다.

run `35223219209`의 실제 수집은 85대, `출고가능` 84대로 끝까지 성공했다. audit (32)에서 확인한 `status available 84 + merchandising 1`을 정확히 보존한다. 따라서 상태 우선순위 자체는 staged 구현에서 해결됐다.

## 2. 새 topology는 direct API→ERP5가 아니라 API→source-sheet feeder

같은 PR의 `ianka/scripts/이안카-재고시트.mjs`에는 `--쓰기` 경로가 있다. API 덤프를 현재 RP031 Google Sheet `1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs`, 탭 `이안카`에 반영할 수 있다.

이 writer는 API가 사실로 제공하는 차량번호·배차상태·연식·연료·주행거리·차명(원문)만 갱신하고, 제조사/모델 정제·상품구분·보증금·1~60개월 요금은 기존 sheet 값을 보존한다. API에서 사라진 기존 sheet 차량은 삭제하지 않고 `출고불가`로 남긴다.

반면 current main과 active production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`의 `inventory-source-registry.ts`는 RP031을 계속 `kind:'google_sheet'`로 정의한다. 따라서 feeder가 live writer가 되면 실제 계보는:

`xn--le5bt3bwxk.com /api/inventory → RP031 Google Sheet → IankaAdapter → ERP5 Atom`

이 된다. audit (32)에서 예상한 direct website/API canonical adapter와 다른 구조다. 이 방식을 택한다면 feeder가 canonical-source writer임을 writer topology와 Source Contract에 명시해야 한다.

현재 `.github/workflows/diag-ianka-collector.yml`은 `workflow_dispatch` 전용이고 `--쓰기` 없이 preview만 실행한다. 즉 capability는 생겼지만 live production writer로 승격되지는 않았다.

## 3. parity gap은 큼

run `35223219209` 로그:

- API units = 85대
- 기존 sheet에 없어 `신규`로 계산된 API 차량 = 72대
- API에는 없지만 기존 sheet에 있어 보존 = 3대
- preview 최종 = 88행

따라서 plate 기준 교집합은 13대이고, 당시 기존 sheet plate row는 16대(교집합 13 + sheet-only 3)로 역산된다. API feeder를 쓰면 canonical sheet가 단순 소폭 갱신되는 것이 아니라 16대 → 88행 규모로 재구성되는 변화다.

이 차이가 기존 sheet의 stale/불완전 때문일 수 있지만, 바로 `--쓰기`를 실행하기 전에 72 신규 차량의 판매대상 여부와 3 sheet-only 차량의 의미를 차량번호 기준으로 확정해야 한다. audit (32)의 parity 요구는 아직 해소되지 않았다.

## 4. 기간별 요금/보증금 provenance는 아직 API로 닫히지 않음

latest diagnostic run `35226939533`은 인증 후 `/api/rates` 경로가 존재하는 것을 확인했지만 현재 계정으로:

- GET `/api/rates?...` → HTTP 403, `관리자 권한이 필요합니다.`
- POST `/api/rates` → HTTP 403, `최고관리자만 기준 요금표를 교체할 수 있습니다.`

였다. 홈/RSC 및 다른 후보 endpoint에서도 1~60개월 요금 데이터는 찾지 못했다.

따라서 feeder는 금융 필드를 기존 sheet에서 보존한다. 기존 13개 교집합 차량에는 혼합 provenance(API 상태/제원 + sheet 금융값)가 생기고, 72개 신규 API 차량은 기존 row가 없으므로 기간별 요금/보증금이 비어 있을 가능성이 높다. `IankaAdapter`는 요금이 하나도 없으면 `NO_RENT` warning을 낸다. cutover 전에 이 72대가 F01/F86 판매 노출에서 어떤 결과를 내는지 검증해야 한다.

## 5. current Source Contract/production/schedule은 audit (32) 상태 유지

- `scripts/check-inventory-source-contract.mts`는 RP031 kind/location 또는 API feeder ownership을 별도 assert하지 않는다.
- canonical `erp5-ssot-refresh.yml` production checkout ref는 계속 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`이다.
- 2026-09-17 GitHub Actions `event=schedule` 재조회는 0건으로 audit (31)의 schedule-delivery OPEN이 유지된다.
- audit (32) 이후 main의 SSOT 관련 신규 변경은 RP031 feeder/diagnostic 계열이며 F01/F86 projection, 손오공/오토플러스 특수탭, mirror/RTDB ownership을 직접 해소하지 않았다.

## 관측성 보완점

`diag-ianka-collector.yml`은 artifact에 `tmp/이안카재고시트-preview.json`을 올리려 하지만 script는 실제로 `ianka/tmp/이안카재고시트-preview.json`에 쓴다. run `35223219209` artifact에는 원문 `이안카차량.json`만 포함되고 sheet preview JSON은 빠졌다. production blocker는 아니지만 parity 감사를 반복하려면 경로를 맞추는 편이 안전하다.

## Claude 구현 Owner 인계

1. PR #364의 status 매핑(`available → 출고가능`, `merchandising → 출고협의`, unknown → 출고불가)은 staged 해소로 유지하고 `available` boolean 기반 판정으로 되돌리지 않는다.
2. RP031 architecture를 하나로 명시한다. website/API를 registry canonical source로 직접 승격할지, API→source-sheet feeder를 canonical writer로 인정할지 결정한다. 후자를 택하면 writer topology와 Source Contract가 feeder를 검사해야 한다.
3. `--쓰기` promotion 전 85 API ↔ 16 기존 sheet ↔ ERP5 Atom을 plate 기준으로 대조하고 72 신규·3 sheet-only의 업무 의미를 확정한다.
4. 가격/보증금은 현재 credential로 API에서 읽을 수 없음이 확인됐다. 권한/다른 endpoint가 확보되기 전에는 값을 지어내지 말고 신규 72대의 NO_RENT/F01/F86 결과를 먼저 검증한다.
5. live cutover 완료 판정은 source feeder/adapter promotion + ERP5 snapshot + F01/F86 cross-audit + 실제 scheduled run 증거가 모두 생긴 뒤 한다.
6. audit (23) F86 freshness checker, audit (27) deposit recurrence, audit (28) vehicle-price semantics, audit (29) sales-tab migration, legacy mirror/sales/settlement/RTDB ownership은 별도 OPEN/HOLD로 유지한다.

이번 감사에서는 application code/business logic을 수정하지 않았다.
