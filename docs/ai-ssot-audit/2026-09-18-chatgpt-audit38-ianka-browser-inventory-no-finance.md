# ChatGPT 독립 SSOT 감사 — audit 38: RP031 real-browser inventory has no finance payload

검수일: 2026-09-18 KST

## 판정

**RP031의 표시 금융값은 `/api/inventory` payload에서 오지 않는다.** browser-like headers로 호출한 응답뿐 아니라 실제 authenticated headless-browser session이 받은 `/api/inventory` 전체 response body까지 확인했지만 rent/deposit 금액이 없었다. 반면 같은 browser session의 rendered DOM에는 월 대여료·보증금이 명확히 존재했다. 따라서 audit (37)의 “inventory가 richer response를 줄 수 있다”는 임시 가설은 기각하고, finance provenance 미확정 HOLD를 강화한다.

## 1. PR #387 — browser headers 재현으로도 inventory 금융값 없음

- merge: `cb368cf560425b9ef815601e5ce6ae4dd03aaa1c`
- workflow run: `35286958679`
- job: `105421310549`
- result: success
- authenticated `GET /api/inventory` → 200, body length 44,143 chars
- first unit keys: name, plate, vehicleNo, year, fuel, color, mileage, available, status, affiliation, maintenanceRef, `rateOverride`, thumbnail, dispatchLocation
- first unit `rateOverride: null`
- `term/rate/price/rental/요금` 계열 매칭 85건: 모두 `rateOverride`
- `N,NNN원` pattern: 0

이 결과로 “plain fetch가 browser headers를 흉내 내지 않아 요금이 빠졌다”는 가설은 기각된다.

## 2. PR #388 — real browser session 전체 inventory body도 동일

- merge/current-main diagnostic commit: `8773e7664dae75e77e353e6ad7a629654c1d3b75`
- workflow run: `35287337178`
- job: `105422481330`
- result: success

실제 로그인 쿠키를 headless browser에 주입해 화면을 실행하면서 `/api/inventory` **전체 응답 본문**을 캡처했다.

### Network/payload

- captured API request: `GET /api/inventory` → 200
- `/api/rates` network call: 없음
- `/api/inventory` full body length: 44,143 chars
- finance-like key matches: 85, 모두 `rateOverride`
- won-amount pattern: 0
- first unit `rateOverride: null`

### Rendered consumer output

- rendered page text length: 21,300 chars
- `N,NNN원` pattern: 48
- DOM에는 실제 `월 대여료`, `보증금`, 계약기간/약정거리 UI와 금액들이 표시됨

즉 **같은 browser session에서 network inventory payload에는 금액이 없는데 rendered consumer output에는 금액이 생긴다.** `/api/inventory`는 표시 금융값의 transport payload가 아니다.

## 3. 기존 진단과 합친 source boundary

현재까지 runtime으로 배제되거나 제한된 후보는 다음과 같다.

- `/api/rates`: 현재 B2B role에서 403 admin-only (audit 37)
- sampled `/api/vehicle-detail`: finance/rate/deposit/month 계열 키 0 (audit 36)
- authenticated raw initial home HTML: 표시 금융값/관련 token 0 (audit 37)
- browser-header `/api/inventory`: 금액 0 (PR #387)
- real-browser-session full `/api/inventory`: 금액 0 (PR #388)

따라서 실제 표시 금액이 어디서 오는지는 아직 미확정이다. 로드된 JS/static asset의 embedded table, client-side calculation 또는 별도 비-API 전달 primitive 가능성이 남아 있다. **이 가능성들은 아직 가설이며 source로 확정하면 안 된다.**

## 4. SSOT 구조 재대조

- production canonical engine pin: `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`
- RP031 canonical registry: `google_sheet`
- F01/F86 row source: ERP5 Atom row contract
- production F86 special tabs: RP012→`오공구독`, RP023→`오플구독`, pickup→`픽업구독`, else→`상품리스트`
- F86 종합: 손오공·오토플러스 제외 규칙 유지
- audit (35) F86 freshness checker false-positive: OPEN
- audit (27) deposit recurrence / (28) vehicle-price lineage / (29) sales-tab naming / (34) freshness semantics: OPEN/HOLD 유지
- mirror/sales/settlement/RTDB legacy writer ownership: HOLD 유지

이번 PR #387/#388은 read-only diagnostic이므로 production source/writer/projection authority를 변경하지 않았다.

## 5. Claude 구현 Owner 인계

1. `/api/inventory`를 RP031 finance canonical source 후보에서 제외한다.
2. rendered DOM은 소비 결과이므로 scrape source로 승격하지 않는다.
3. 로드된 client asset/계산 경로를 추적해 실제 finance primitive와 formula를 식별한다.
4. primitive가 밝혀지면 Google Sheet와 차종·연식·기간·약정거리·대여료·보증금 단위 parity matrix를 만든다.
5. authority 변경은 registry/Source Contract/writer topology와 Atom→snapshot→F01/F86 cross-audit까지 함께 닫는다.

이번 감사에서는 application code/business logic을 수정하지 않았다.
