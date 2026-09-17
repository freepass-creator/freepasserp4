# ChatGPT 독립 SSOT 감사 — audit 36: RP031 `vehicle-detail` 전체 응답에서 기간별 금융값 없음 확인

검수일: 2026-09-18 KST

## 판정

**진단 불확실성 하나는 해소됐지만 RP031 production promotion HOLD는 유지한다.** PR #374는 이안카 `/api/vehicle-detail`의 성공 응답 전체를 읽도록 read-only 진단을 강화했고, 실제 run에서 기간별 rent/deposit를 나타내는 키나 원화 금액 패턴을 찾지 못했다. 이 결과는 API feeder의 금융값 provenance 문제를 해결한 것이 아니라, 후보 endpoint 하나를 배제한 것이다.

## 증거

### 1. main에 병합된 변경은 read-only diagnostic뿐

PR #374 merge commit `42ca5541e4e92fc11b655fd330b6f324a59efe94`의 변경 파일은 `scripts/diag-ianka-vehicle-detail.mts` 한 개다. 성공 응답에 대해 전체 길이·rate-like key 패턴·`N,NNN원` 패턴을 출력하고 전체 body를 로그로 남기도록 확장했다. production adapter/writer/projection은 변경하지 않았다.

### 2. 실제 authenticated run에서 22,630자 전체 응답을 검사

GitHub Actions run `35228945659`, job `105227660941`:

- 로그인 성공
- `GET /api/inventory` → 200, 44,143자
- 표본 `vehicleNo=128896`
- `GET /api/vehicle-detail?vehicleNo=128896` → 200, **22,630자**
- `요금 비슷한 키 0건`
- `"N,NNN원" 패턴 0건`

payload shape는 `vehicleNo`, `specs`, `summaries`, `photos`, `photosAllowed`, `emptyMessage` 중심이었다. 따라서 기존의 “앞 2,000자 밖에 금융필드가 숨어 있을 수 있다”는 의문은 이 성공 응답에 대해서는 닫힌다.

주의: 이 run은 한 차량의 성공 응답을 schema 표본으로 검사했다. 모든 차량을 전수 호출한 것은 아니므로 “모든 차량에서 절대 불가능”으로 과장하지 않는다. 다만 현재 endpoint 응답 구조와 검출 결과상 1~60개월 금융 source로 사용할 근거는 없다.

### 3. audit (33) 가격 provenance HOLD는 더 명확해짐

audit (33)에서 이미 `/api/rates`가 현재 credential로 GET 403(`관리자 권한이 필요합니다`)임을 확인했다. 이번 결과로 `/api/vehicle-detail`도 대체 금융 source로 채택할 근거가 없어졌다.

따라서 API-only 신규 차량에 대해:

- 기존 sheet row가 없으면 기존 금융값을 보존할 수도 없고,
- 현재 검증된 API 응답에서 1~60개월 rent/deposit를 얻을 수도 없다.

이 상태에서 금융값을 추정·복제·합성하면 SOURCE→ATOM provenance 계약을 위반한다. 값이 없으면 `NO_RENT`/미노출 결과를 먼저 검증하거나 별도 권위 source를 확보해야 한다.

### 4. 나머지 SSOT 상태는 변화 없음

- RP031 canonical registry는 여전히 Google Sheet다.
- production pin은 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`이다.
- API→sheet feeder는 canonical production writer로 승격되지 않았다.
- audit (35)의 canonical scheduled run은 F01/F86 값 parity가 맞았지만 F86 freshness checker contract drift로 red였다.
- audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming migration, audit (34) newest-Atom freshness observability, mirror/sales/settlement/RTDB ownership HOLD는 그대로 유지한다.

## Claude 구현 Owner 인계

1. `/api/vehicle-detail`을 RP031 기간별 금융값 source로 다시 추정하지 않는다.
2. `/api/rates` 권한 또는 다른 권위 source가 확보되지 않으면 API-only 차량의 금융값을 만들지 않는다.
3. feeder promotion은 plate parity, 금융값 provenance, Source Contract/writer ownership, ERP5 snapshot, F01/F86 cross-audit까지 함께 증명한 뒤 판정한다.

이번 감사에서는 application code/business logic을 수정하지 않았다.
