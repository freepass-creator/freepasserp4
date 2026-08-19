# PLAN — 공급사 시트 → 우리 원자 (가격 포함) 유입 + 저장 전 diff 미리보기

작성: Claude Code · 2026-07-28 · 대상 브랜치: main (sheet-sync WIP 위)
관련: `lib/domain/sheet-import.ts` · `sheet-merge.ts` · `sheet-diff.ts`(신규, 내가 함) · `master-ingress.ts` · `components/SheetSync.tsx` · `lib/domain/product.ts`(price 원자) · `docs/SHEET_SYNC_HANDOFF.md`

## 1. 원래 요구사항 (사용자 원문 취지)
1. 외부 공급사 시트를 우리 재고(원자)로 가져온다.
2. **대여료(월렌트)는 공급사 시트에서 결정** → 시트에서 가격 원자를 수집해야 한다.
3. 저장 **전에** "기존 대비 신규 몇 / 상태변경 몇 / 내용수정 몇 / 부재(출고불가) 몇"을 **먼저 확인**하고 동기화.
4. 시트에 없거나 출고불가면 삭제하지 말고 **출고불가**.
5. 공급사 양식을 **원자 수집이 쉬운 표준**으로 정리(권장 배포).

## 2. 현재 코드 조사 (사실)
- 총 유입: **1,603대** (17 공급사, `data/sheet-ingress/hub-all-ingress.json`). 차종마스터 확신 high 1341 / med 134 / low 128(수입차 위주).
- 현재 ingress가 수집하는 원자: `car_number · vehicle_status(+status_label_raw) · maker · model · trim_name · ext_color · fuel_type` + `_snap_confidence`. **가격·연식·주행·배기량·우대·옵션 미수집.**
- 우리 가격 원자(`product.ts`): `p.price = Record<month, { rent, deposit, fee }>` (표준 개월 1·12·24·36·48·60), `normalizeWonPair`가 만원단위 정규화.
- 공급사 시트 양식 편차 큼:
  - **아이카(RP004, 1307대) = 골드 스탠다드.** 헤더 명시: `1개월·6개월·12개월·24개월·36개월·48개월·60개월`(개월별 대여료) · `단기보증·장기보증` · `Km·최초등록·배기량·트림·옵션·분납·21세·23세`.
  - **오토플러스(RP023) = 라벨 없는 4개 가격 열** + 등록일·주행이 헤더 없이 존재 → 개월 매핑 불가.
- `summarizeSheetDiff`(내가 이미 작성·sim 9/9 PASS): 신규/상태변경/내용수정/부재/무변경 집계 + 항목 상세. **가격은 아직 diff에 반영 안 됨**(가격 원자 자체가 미수집이라).

## 3. 영향 파일
- `lib/domain/sheet-import.ts` — 개월별 가격·부가필드 파서 추가 (표준 헤더 인식).
- `lib/domain/supplier-column-map.ts` (신규) — 공급사별 열 매핑 프로필(비표준 어댑터).
- `lib/domain/sheet-diff.ts` — 가격 변동을 diff 상세에 포함(기존 content에 잡히나 "대여료 변동" 라벨).
- `components/SheetSync.tsx` — diff 배너(가격변동 포함) + 표준 템플릿 다운로드 버튼. **(Cursor)**
- `scripts/sim-sheet-price.mts` (신규) — 가격 파서 검증.

## 4. 대안·트레이드오프
- **A. 표준 헤더 파서 + 공급사 어댑터(권장).** 표준(아이카식) 헤더는 자동 파싱, 비표준은 공급사별 열 프로필. 장점: 표준 공급사 즉시 동작, 비표준도 커버. 단점: 어댑터 유지비.
- **B. 전부 표준 강제.** 모든 공급사에 표준 양식 요구. 장점: 코드 단순. 단점: 현실적으로 즉시 전환 불가(오토플러스 등 기존 운영).
- **C. AI로 열 자동추론.** 과함·비결정적. 기각.
- → **A 채택** (표준 우선 + 예외 어댑터).

## 5. 구현 순서 (역할 표시)
1. **[Claude] 개월별 가격 파서** — 표준 헤더(`N개월` 열들 + 단기/장기보증)에서 `price:{month:{rent,deposit}}` 생성. "-"·빈값 스킵, `normalizeWonPair` 적용. + 부가필드(연식=최초등록, 주행=Km, 배기량, 트림, 옵션, 우대=분납/21·23세). 데이터 정합 = 내 도메인.
2. **[Claude] 공급사 어댑터 스키마** — `supplier-column-map.ts`: `providerCode → { headerRow, gid, cols: {rent_by_month, deposit_short, deposit_long, km, year, ...} }`. 표준 미매칭 공급사만 등록(오토플러스 4열 개월 확정 필요 → 결정사항).
3. **[Claude] sim-sheet-price** — 표준(아이카)·비표준(오토플러스) 각 1건 → 기대 price 원자 검증.
4. **[Cursor] SheetSync UI** — `summarizeSheetDiff` 배너(신규/상태/내용/부재/무변경, 가격변동 강조) + "표준 템플릿 다운로드" + 각 카운트 클릭 상세. (별도 커서 오더로 전달)
5. **[Codex] 전수검증** — 요구 대비 diff·가격 매핑 정확성, 회귀(sim 전체), 원가 필드가 private 노드로 가는지(products_private) 확인.

## 6. 테스트 계획
- `npx tsx scripts/sim-sheet-price.mts` (표준·비표준 각 기대 price)
- `npx tsx scripts/sim-sheet-diff.mts` (기존 9/9 유지)
- `npx tsc --noEmit` · `npm run check:fonts`
- 실데이터 dry-run: 아이카·오토플러스 시트 → 가격 포함 원자 카운트가 hub-all-ingress와 정합.

## 7. 완료 조건
- 표준(아이카) 시트에서 **개월별 대여료·보증금·연식·주행·배기·우대**가 원자로 수집됨.
- 비표준(오토플러스)도 어댑터로 가격 수집(또는 표준전환 결정).
- SheetSync에서 저장 전 diff(가격변동 포함) 확인 → 승인 후 commit.
- 원가성 필드(소비자가격 등)는 `products_private` 규칙 준수.

## 8. 가정 · 사용자 결정 필요
- **보증금 매핑:** 단기보증 → 단기 개월(1·6), 장기보증 → 장기(12+)? 아니면 전 기간 공통 2단계? **(결정 필요)**
- **오토플러스 무라벨 4개 가격 열의 개월** = ? (예: 12/24/36/48) **(결정 필요 — 공급사 확인)**
- **소비자가격·차량가액** = 원가 → `products_private`로만? (기존 정책과 정합)
- 표준 템플릿을 공급사에 배포·전환 요청할지(운영 결정).

## 9. 롤백
- 가격 파서는 **추가만**(기존 identity 매핑 불변) → 문제 시 파서 호출부만 제거. diff·commit 로직은 안 건드림. 규칙 게시 없음(코드만).

---
*역할: Claude=설계(이 문서)+가격 파서 데이터코어 / Cursor=SheetSync UI 노가다 / Codex=전수검증. 검증 기준=위 §1 원래 요구사항.*

---

# 차종마스터 최종 운영완료 게이트 — 자동승격률이 아닌 안전 커버리지 (2026-08-16)

## 사용자 원요구와 완료 정의

- 목표는 국내에서 실제 유통되는 인기·렌트·구독 차량을 프리패스 영구 차종코드로 안정적으로 식별하는 것이다. 모든 역사 행을 `확정`으로 바꾸거나 제조사가 공개하지 않은 제원을 채우는 것이 목표가 아니다.
- 완료 판정은 `현행·최근 10년 핵심 차량의 안전한 검색/수동 선택 가능`, `공식 근거가 완결된 행만 자동배정`, `모호하거나 의미가 잘못된 과거 키는 신규 배정 차단`, `영구키 삭제·재사용·의미 변경 0건`으로 한다.
- 현재 5,293행 중 자동 3,207행과 수동 138행은 배정 후보이고, 차단 1,948행은 단순 미처리 백로그가 아니다. 기존 의미가 틀렸거나 신규 계보로 대체된 키는 감사 이력으로 영구 보존해야 하므로 차단 유지 자체가 정상 완료 상태다.

## Tesla 분류 결정

- 영구키 축은 `모델/차체 → 공식 세대·변경 경계 → 파워트레인·구동 → 좌석 → 판매 트림`이다. Model 3 Highland, New Model Y, Model Y L 롱휠베이스 6인승, Model S/X Palladium 및 공식 2025+ 업데이트는 이 축으로 구분한다.
- Ryzen/Intel Atom은 같은 연식·트림 안에서도 생산시점에 따라 달라질 수 있는 차량별 인포테인먼트 하드웨어다. 영구키·세대명·검색 별칭에 넣지 않고 차량 원자의 별도 하드웨어 속성으로만 다룬다.
- Tesla가 국내 공식 자료에서 총 배터리 용량을 공개하지 않은 행은 `공식 미공개·공란 유지`가 명시된 경우에만 정책 예외를 허용한다. 해외 추정치나 usable/gross 환산으로 채우지 않는다.

## 남은 138 수동행 처리 오더

1. **[Cursor] 보고서 생성만:** 수동 138행을 영구키·제조사·모델·실패 사유별 CSV/JSON으로 내보내고, 각 행을 `공식자료 추가 시 자동승격 가능`, `차량 원자와 사람 확인 후 수동배정`, `신규 계보 발급 필요`, `차단 전환 후보`로 분류한다. 원천 시트와 영구키 의미 필드는 수정하지 않는다.
2. **[Cursor] 현행 상품 커버리지 대조:** 상품마스터의 현재 렌트·구독 차량번호별로 자동 또는 수동 배정 가능한 후보가 존재하는지 대조한다. 행 개수가 아니라 `실제 상품 중 안전 후보 없음`, `후보 2개 이상 모호`, `차단키 참조`를 각각 0건으로 만드는 것이 우선이다.
3. **[Codex] 독립 검증·제한 수정:** 공식 국내 제조사 자료로 생산기간·차체·트림·구동·좌석이 확정되는 행만 승격한다. 포터 특장 변속기, 베뉴 과급 여부, 수입 전기차 배터리 총용량처럼 공식 자료에 없는 값은 추정하지 않는다. 필요한 경우 자동승격 대신 수동 선택 라벨·근거메모의 명확성만 보강한다.
4. **[Claude/사람 게이트] 신규 영구키:** 기존 키의 의미 변경으로 해결할 수 없고 실제 국내 상품이 매칭 불가한 경우에만 새 계보를 승인한다. 기존 키는 삭제·재사용하지 않고 기간 종료 또는 차단한다.

## GO / NO-GO

- **GO:** 영구키 계약 감사 0건, Tesla 세대 계약 통과, 자동 후보 유일성 보장, 현행 상품의 무후보·다중후보·차단키 참조 0건, 타입·폰트·관련 sim 통과. 이 조건이면 수동 138행과 감사용 차단 1,948행이 남아 있어도 차종마스터는 운영 완료로 판정한다.
- **조건부 GO:** 제조사 비공개 제원 때문에 수동행이 남지만 실제 상품은 사람 확인을 거쳐 유일하게 배정 가능하고, UI/API가 이를 자동확정하지 않는 경우다.
- **NO-GO:** 공개되지 않은 생산종료·배터리 kWh·변속기·터보 여부를 추정 입력, 해외 사양을 국내 사양으로 단정, Ryzen/Atom으로 Tesla 영구키 분할, 기존 영구키 의미 변경·재사용, 차단행 자동배정, 실제 상품의 무후보 또는 다중 자동후보 존재.

## 최종 산출물

- Cursor는 반복 대조 보고서와 필요한 비위험 보조 스크립트만 구현하고 `IMPLEMENTATION_LOG.md`에 결과를 남긴다.
- Codex는 원요구 기준으로 전체 sim·타입·폰트와 실제 상품 커버리지를 재검증하고, 최종 수치와 잔여 외부근거 대기 목록을 `VERIFICATION.md`에 기록한다.
- 원천 시트 또는 영구키 변경이 발생한 경우에만 재생성하며, 변경 전후 기존 5,293개 키의 삭제·재사용·순번·의미 변경이 모두 0건이어야 한다.

---

# 실제 상품 587대 차종 커버리지 종결 게이트 — 신차·유통 중고차 무공백 (2026-08-16)

## 1. 사용자 원요구와 기준선

- 사용자 요구는 차종마스터 행 수를 늘리는 일이 아니라, **실제 상품마스터의 신차부터 판매 가능한 중고차까지 잘못 붙거나 못 고르는 차량이 없게 하는 것**이다.
- 기준선은 라이브 원천 재조회 기록상 상품 587대, `확정 378 / 검수필요 9 / 미매칭 200`이다. 코드가 있던 387대는 당시 로컬 차종마스터 행과 정확히 조인됐다. 따라서 이번 종결 대상은 우선 209대이며, 이미 확정된 378대도 회귀 전수검증한다.
- 차종마스터 5,293행의 `automatic 3,207 / manual 138 / blocked 1,948`은 마스터 정책 상태다. 상품 커버리지 수치와 섞어 “차단 1,948개를 모두 고쳐야 한다”거나 “자동 3,207개이므로 상품도 전부 안전하다”고 판정하지 않는다.

## 2. 사실상 단일 매칭 흐름

- 상품 정본 입력은 `ERP4 차종마스터 원천대장/상품마스터`이고 서버 진입점은 `lib/server/product-master-sheet.ts`, 엄격한 50열 파싱·코드 조인은 `lib/domain/product-master-import.ts`다.
- 차종 원천은 `public/data/vehicle-trim-master.json`과 영구키 레지스트리이며, 상품마스터의 확정 코드는 공급사 원문보다 우선한다. 이후 공급사 재동기화가 확정 식별자를 덮지 못하는 계약은 유지한다.
- 자유문장 재스냅은 후보 발굴 보조일 뿐 정답원이 아니다. 기존 `vehicle-master-match`의 점수 하나만으로 미매칭 200대를 자동 확정하지 않는다.

## 3. 차량별 판정 규격

각 차량번호는 아래 셋 중 정확히 하나여야 한다.

1. `AUTO_UNIQUE`: 상품의 제조사·모델/세대·연료/배기 또는 모터·구동·인승·트림·최초등록일 신호가 하나의 `automatic` 영구키와 모순 없이 일치한다. 자동 반영 가능하다.
2. `MANUAL_UNIQUE`: 자동 확정 근거는 부족하지만, 공급사 원문과 차량 원자를 함께 보면 운영자가 선택할 수 있는 비차단 후보가 하나다. 사람 승인 전 판매 노출·자동 반영은 금지한다.
3. `EVIDENCE_BLOCKED`: 후보 0, 비차단 후보 2개 이상, 입력 신호끼리 충돌, 또는 blocked 키만 남는다. 추정 보정하지 않고 필요한 원자·공식 근거·신규 계보 요청을 명시한다.

`blocked` 행은 검색 설명·감사 이력에는 보이되 배정 후보 집합에는 절대 들어가지 않는다. `manual` 행도 자동 후보에는 들어가지 않는다.

## 4. 후보 생성과 유일성 규칙

- 1차 필터는 제조사와 공식 모델/세대다. 제조사가 다르면 후보 0이며 별칭 점수로 뒤집지 않는다.
- 최초등록일은 `production_start <= 등록월 <= production_end`인 후보만 남긴다. 종료일 공란은 “현재 생산”으로 단정하지 않고, 다른 공식 세대와 기간이 겹치면 수동/차단한다.
- 연료, EV/수소/MHEV 구분, 배기량 허용오차, 구동, 인승, 차체는 서로 모순 시 감점이 아니라 후보 탈락 신호다. 공급사 공란은 불일치로 보지 않는다.
- 트림 문자열은 공식 별칭으로만 정규화한다. 비슷한 단어, 옵션 패키지, Ryzen/Atom 같은 차량별 하드웨어를 트림·세대 축으로 승격하지 않는다.
- 후보가 하나여도 그 행이 `manual`이면 `AUTO_UNIQUE`가 될 수 없다. 자동 확정은 유일성뿐 아니라 행의 자동배정 정책 통과가 모두 필요하다.
- 기존 차종코드가 있는 387대는 코드가 존재하는지만 보지 않고, 현재 상품 원자와 의미가 충돌하지 않는지 역검증한다. 충돌하면 자동 교체하지 않고 `CODE_CONFLICT`로 차단한다.

## 5. Cursor 구현 오더 — 대량 대조·반복 작업

1. 읽기 전용 `scripts/audit-product-vehicle-trim-coverage.mts`를 만든다. 상품마스터 라이브 표와 로컬 차종마스터를 읽고 차량번호별로 기존 코드, 후보키 목록, 판정, 불일치 축, 필요한 다음 조치를 JSON/CSV로 출력한다. 기본 실행은 시트·레지스트리·ERP를 수정하지 않는다.
2. 보고서에는 최소 `전체 / AUTO_UNIQUE / MANUAL_UNIQUE / EVIDENCE_BLOCKED / NO_CANDIDATE / MULTI_CANDIDATE / BLOCKED_KEY_REFERENCE / CODE_CONFLICT` 수와 공급사·제조사·모델별 묶음을 포함한다. 합계는 항상 상품 고유 차량번호 수와 같아야 한다.
3. 기존 209대 우선 백로그를 `원자 부족`, `공식 별칭 부족`, `마스터 계보 누락`, `기간 경계 부족`, `트림만 불명`, `입력 자체 충돌`로 기계 분류한다. 분류만 하고 신규키나 공식 제원을 생성하지 않는다.
4. 사람에게 보여 줄 검수 묶음은 원문 차명, 최초등록, 연료, 배기량, 구동, 인승, 트림, 현재 코드와 최대 5개 후보의 차이 축을 나란히 제공한다. 점수만 보여 주지 않는다.
5. 실행·결과·계획 이탈은 `IMPLEMENTATION_LOG.md`에 기록한다. 원천 시트 쓰기, 영구키 레지스트리 수정, ERP 반영은 별도 승인 전 금지한다.

## 6. Codex 검증·제한 수정 오더

1. 라이브 587대(재조회 시 총수가 달라지면 새 총수)를 독립 재조회하고 차량번호 중복·행 누락·50열 규격부터 검증한다.
2. `AUTO_UNIQUE` 전건에 대해 역검증한다. 제조사·모델/세대·기간·연료·구동·인승·트림 중 알려진 신호와 하나라도 충돌하면 자동판정을 실패시킨다.
3. 무후보가 실제 국내 유통 계보 누락인 경우에만 제조사 국내 공식 자료로 후보안을 만든다. 신규키 발급은 Claude/사람 게이트 후 별도 추가하며, 기존 5,293키 의미는 변경하지 않는다.
4. 다중후보는 별칭을 넓혀 억지로 하나로 만들지 않는다. 상품 원천에서 결정 가능한 원자를 보강하거나 `MANUAL_UNIQUE` 검수로 닫는다. 공식 자료에도 없는 값은 공란·차단 유지한다.
5. 코드가 있는 기존 387대와 새로 닫힌 차량 모두 차종코드↔표시명↔행 의미 exact join, blocked 키 배정 0, 영구키 계약 변화 0을 검증하고 `VERIFICATION.md`에 차량번호 기준 수치를 기록한다.

## 7. Claude/사람 위험 게이트

- **GO:** 국내 공식 근거로 독립 계보가 확인되고 기존 키로 표현할 수 없으며, 실제 상품 한 대 이상이 그 계보를 필요로 한다. 새 키는 추가만 하고 근거 URL·생산 시작/종료 경계·차체·파워트레인·구동·인승·트림을 가능한 범위에서 명시한다.
- **조건부 GO:** 계보는 확실하지만 제조사가 세부 제원을 비공개한 경우 `manual` 신규 후보로만 추가한다. 운영자는 차량 원자와 서류를 보고 배정하며 자동확정하지 않는다.
- **NO-GO:** 기존 키 의미 수정/재사용, 해외 사양의 국내 단정, 등록연식만으로 세대 단정, 생산 종료일·배터리 kWh·특장 변속기 추정, blocked 키 복구를 통한 편법 매칭, 점수 최고 후보의 무조건 자동선택.

## 8. 완료 조건과 배포 판정

- 목표 수치는 단순 `미매칭` 문구 0이 아니라 다음 모두다.
  - 판매·구독 대상으로 쓰는 모든 상품에 `AUTO_UNIQUE` 또는 사람 승인 완료된 `MANUAL_UNIQUE`가 존재
  - `NO_CANDIDATE = 0`, `MULTI_CANDIDATE = 0`, `BLOCKED_KEY_REFERENCE = 0`, `CODE_CONFLICT = 0`
  - 자동 후보의 제조사·세대·기간·연료·구동·인승 모순 0
  - 기존 영구키 삭제·재사용·순번·의미 변경 0
- 공식 근거 또는 차량 원자가 없어 `EVIDENCE_BLOCKED`가 남으면 데이터 안전성은 PASS일 수 있어도 사용자 요구인 “실제 쓸 상품 무공백”은 **NO-GO**다. 해당 상품은 판매 노출에서 제외하고 차량번호·필요 근거를 잔여 목록으로 명시한다.
- 필수 게이트: 커버리지 감사 스크립트, `audit-vehicle-trim-key-contract`, 상품마스터 import/sheet sim, 관련 Tesla·상용차 계약 sim, `npx tsc --noEmit`, `npm run check:fonts`. Rules·v3·정산엔진·운영 DB write는 이번 범위가 아니다.

---

# 상품 차종 3축 검토 마무리 — 잔여 102대 · 마스터 보강 (2026-08-18, Cursor 오더)

## 확정 사항(사장님 2026-08-18)

- 검토 범위는 **모델 · 세부모델 · 세부트림 3축**뿐이다. 연료·배기량·구동·인승은 코드를 고를 때 근거로만 쓰고 식별 축으로 삼지 않는다.
- 결정 정본은 `data/product-vehicle-review-decisions.json` 한 파일이다(로더 `lib/domain/product-vehicle-review-decisions.ts`).
  백로그 감사(`audit-product-vehicle-resolution-backlog.mts`)와 판매시트 발행기(`publish-origin-tab.mts` → `product-vehicle-normalization.ts`)가 이 파일을 읽는다.
- 코드는 `decision=CODE` 일 때만 `plan-product-vehicle-review-decisions.mts` → `apply-product-master-vehicle-coverage.mts --report=… --apply` 로 박는다(CAS·스냅샷·재조회). 다른 길로 상품마스터를 쓰지 않는다.
- 차종마스터 원장·registry·artifact 는 이 오더에서 **수정 금지**. 마스터 보강은 후보 목록만 만들고 Claude/사람 게이트에 올린다.

## 오늘까지 된 것(Claude Code)

- 176 백로그 중 74 검토완료 — CODE 9 · TRIPLE 53(사람 23 + [자동합의] 30) · PARTIAL 7 · HOLD 5. 상품마스터 코드 반영 12대(결정 9 + 감사기 SAFE 3).
- 「차종마스터_규격채택」 게시(2,106키), 판매시트 「상품리스트」를 차량번호 정본(코드→채택이름 / 3축 결정)으로 재발행(397대 중 338대 정본).
- 잔여 **102대**: `npx tsx scripts/audit-product-vehicle-resolution-backlog.mts` 의 `unreviewed` — CLUE_EXTRACTION_RECHECK 39 · PRICE_OPTION_LOOKUP_REQUIRED 39 · SOURCE_CONFLICT 13 · CANDIDATE_AXIS_LOOKUP_REQUIRED 11.
  (여기에는 `확정 코드 직접근거 재확인` 51 · `확정 코드 명시축 불일치` 7 — 이미 코드가 있으나 공급사 원문이 그 코드를 직접 뒷받침하지 못하는 행 — 이 섞여 있다.)

## [Cursor] 오더 1 — 잔여 102대 3축 판정 (노가다)

입력: `tmp/product-master-vehicle-coverage.json`(먼저 `npx tsx scripts/audit-product-master-vehicle-coverage.mts` 로 새로 뽑는다) + `tmp/product-master-vehicle-resolution-backlog.json` 의 `unreviewed` 행 + `public/data/vehicle-trim-master.json` + 「차종마스터_규격채택」 이름.

행마다 아래 순서로 판단해 `data/product-vehicle-review-decisions.json` 의 `decisions` 에 **덧붙인다**(기존 74건 수정 금지, 차량번호 중복 금지). 각 결정에는 `supplier_text`, `basis`(근거 한 문장, 무엇을 보고 골랐는지) 를 반드시 적는다.

1. 후보(`candidate_keys`)가 모두 같은 3축 → `TRIPLE` + `candidate_keys` (`[자동합의]` 접두). 이미 [자동합의] 30건이 이 규칙으로 들어가 있으니 같은 형식.
2. 후보 3축이 갈리는데 공급사 원문(차명·옵션·차량가)으로 **세부트림이 하나로 정해지면** → `TRIPLE`(코드 유일하면 `CODE`). 차량가는 공식 가격표와 대조했을 때만 근거로 쓴다(추정 금지).
3. 세부모델까지만 정해지면 → `PARTIAL`(trim 빈칸). 모델도 못 정하거나 원문끼리 충돌(세대·배기량·연식) → `HOLD`.
4. `확정 코드 직접근거 재확인 / 명시축 불일치` 58행: 현재 코드의 3축이 공급사 원문과 **같은 차**를 가리키면 `CODE`(trim_row_key=현재 코드, basis 에 「현재 코드 유지」)로 기록해 검토완료로 닫는다. 다른 차를 가리키면(예: 109호3716 E클래스 6세대·2024-09 등록인데 현재 코드가 W213) 올바른 automatic 키가 있으면 `CODE`(교체), 없으면 `TRIPLE`+`master_action`.
   ⚠ 이 58행의 코드 교체는 writer 가 CAS(현재코드·검증상태·원문지문)로 막으니 별도 절차 없이 같은 계획기로 흘러간다.
5. 절대 하지 않는 것 — 별칭을 넓혀 억지 단일화, blocked 키를 CODE 로 지정, 원문에 없는 축을 추정해 트림 결정.

게이트: `npx tsx scripts/plan-product-vehicle-review-decisions.mts` 가 결정 파일 검증을 통과(코드 실재·automatic·3축 채움) → dry-run → `--apply` 는 **사장님 또는 Claude 확인 후**. `npx tsc --noEmit` PASS. 끝나면 `audit-product-vehicle-resolution-backlog` 의 `unreviewed` 를 `IMPLEMENTATION_LOG.md` 에 적는다(목표 0, 남으면 HOLD 사유별 수).

## [Cursor] 오더 2 — 마스터 보강 후보표 (원장 수정 없이)

결정 파일의 `master_action` 별로 표를 만든다 → `tmp/vehicle-master-backfill-candidates.json` + `IMPLEMENTATION_LOG.md` 요약.

- `UNBLOCK`(현재 11): `candidate_key` 의 blocked 행이 실차와 같은 뜻인지, 그 행의 `근거메모`에 의미충돌이 적혀 있지 않은지 확인하고, 국내 공식 가격표/카탈로그 URL 을 찾아 붙인다(생산기간 포함). 못 찾으면 「근거 없음」으로 남긴다.
- `ADD_ROW`(현재 9): 제조사·모델·세부모델·세부트림·연료·배기량·구동·인승·생산기간·공식근거 URL 을 채운 신규 행 초안. 예: SM7 1세대 2.3 LE, 쿠퍼 컨트리맨 F60 클래식, 올 뉴 렉스턴 Y450 더 블랙, 더 뉴 말리부 1.35 E-Turbo LT, A6 C7 40 TFSI 프리미엄 밀라노, 폴스타 2 초기형(2022~2024-09) Long range Single motor, C-클래스 W205 C220d 4MATIC 아방가르드, 더 뉴 쏘렌토 MQ4 가솔린 2.5T 7인승 프레스티지.
- `PERIOD_FIX`(2): 디 올 뉴 셀토스 SP3 생산시작(마스터 2026-07 vs 실차 등록 2026-04) — 국내 출시월 공식 근거.
- `ALIAS`(3): `public/data/master-aliases.json` 에 `kind: trim, reviewed: true` 규칙 초안(S350d→S350 BlueTEC W222 4MATIC 3.0 한정 · x라인 스페셜에디션→20i xLine F48 · Iconic→아이코닉 아르카나).
- 규격검토 오기 2건도 표에 넣는다: 「디 올 뉴 코나 SX2」 가솔린 그룹 생산시작 2026-04(실제 2023-01) · 「더 뉴 QM6 HZG」 LPe 그룹 누락(2019-06~).

이 표를 보고 신규 키 발급·승격은 Claude/사람 게이트에서 한다(`VEHICLE_MASTER_KEY_CONTRACT.md`).

## [Cursor] 오더 3 — 조회 탭 갱신

- `scripts/publish-product-vehicle-match-view-v2.mts` 가 결정 파일을 읽어 「상품 차종매칭」 탭에 `3축 결정(사람검토)` 열을 추가하고, 결정된 행은 `검토필요`가 아니라 `3축확정/트림미확정/원천확인` 으로 표시하게 한다. 운영 확정(459+)과 참고 계층 후보를 섞지 않는 기존 분리는 유지.
- 서식은 `lib/domain/vehicle-master-sheet-format` 표준(9pt · 22px)을 쓴다.

## Codex 검증

- 결정 파일 전건: 코드 실재·automatic·3축 채움·중복 0 / 판매시트 dump 전후 **돈 칸 diff 0** / 상품마스터 CAS 재조회 일치 / 영구키 계약 감사 0.

---

# 상품시트 ↔ ERP 연동 — 상품마스터 허브 일일갱신 · 정합 감사 · 표시 통일 (2026-08-18, Cursor 오더)

## 0. 지금 실측(2026-08-18) — 왜 갈리는가

```
공급사 시트(20곳, live) ──publish-origin-tab(매일 GH Actions)──▶ 판매시트 「상품리스트」 397대   ← 영업자가 본다
공급사 시트(20곳) ──2026-08-15 1회 적재(Codex)──▶ 상품마스터 587대 ──sheet-daily-sync(Vercel cron 02:00 KST)──▶ ERP v4 products
                                                  ▲ 상태·대여료·보증금을 다시 읽어 넣는 일일 갱신기가 **없다**
```

- ERP 정본 입력은 `상품마스터`(`lib/server/product-master-sheet.ts` → `lib/domain/product-master-import.ts` → `runDailySheetSync`)이고 실시간 상태연동(`sheet-live-status`)도 같은 탭을 읽는다.
- 그런데 상품마스터의 live 칸(차량상태·정책코드·기간별 대여료/보증금·변형 블록)은 8/15 값에 멈춰 있다. 판매시트는 공급사 시트를 매일 직접 읽는다.
  → **영업자가 보는 상태·돈과 ERP의 상태·돈이 날마다 벌어진다.** 차명도 판매시트는 규격채택 이름, ERP는 artifact 이름·미매칭 원문이다.
- 두 개의 «정제층» 문서가 있다: 「프리패스 차량정제」(build-refine-sheet, 8/15)와 「상품마스터」(Codex, ERP 소비 중). **셋째를 만들지 않는다.** ERP가 이미 먹는 상품마스터를 허브로 쓴다.

## 1. 목표

- 판매시트와 ERP가 같은 차량번호에 대해 **같은 상태·같은 돈·같은 3축 차명**을 보인다.
- 정본 규칙은 그대로: live 칸은 공급사를 따라가고(`supplier-template-sheet.columnOwner`), 차종 정체성(`PRODUCT_MASTER_AI_LOCKED_COLUMNS`)은 공급사가 못 덮는다.

## 2. [Cursor] 오더 A — 상품마스터 live 칸 일일 갱신기 `scripts/sync-product-master-live.mts`

- 입력: 공급사 시트 20곳(`readSupplierSheet` — 발행기와 **같은 읽기 함수**·같은 문패 주소·같은 @제외 규칙) → 차량번호별 상태·정책코드·기간별 대여료/보증금·3만km/인수형 블록.
  원본→열 매핑은 `docs/SUPPLIER_DATA_MANUAL.md`·원천대장 「공급사 열 매핑」탭이 정본(`build-standard-product-master-rows.mts`가 쓰는 파서 재사용, 새 파서 금지).
- 대상 칸만 쓴다: `차량상태`, `정책코드`, 10기간 `N개월 대여료/보증금`, `PRODUCT_MASTER_VARIANT_PRICE_COLUMNS`, `최종갱신`, `원천`.
  **절대 안 쓰는 칸**: `PRODUCT_MASTER_AI_LOCKED_COLUMNS` + `차종마스터 적용값`·`검증상태`·`검수사유`·`관리상태`·`차종코드`·`사진링크`·`입고일자`.
- 새 차량번호: 상품마스터 끝에 **미매칭 행 추가**(공급사 입력 차명·원문보존 채움, 차종코드 빈칸, 관리상태 검수필요) → 기존 커버리지 감사·3축 검토 큐로 흘러간다.
- 원본에서 사라진 차량번호: 삭제하지 않고 `차량상태=출고불가`·`원천`에 「원본부재 YYYY-MM-DD」. (PRODUCT_MASTER.md 「AI 최초 매칭과 이후 변경 감지」 그대로)
- 가격 원자는 숫자로 비교한다(`93,000`↔`93000` 동일). 달라진 칸만 쓴다. `-`·`0` 대신 빈칸 규칙 유지. 대여료/보증금 한쪽만 있는 기간은 두 칸을 함께 비우지 말고 **쓰지 않고 진단만**(기존 16기간 규칙).
- 안전장치: 기본 dry-run · `--apply` · 실행 전 스냅샷 · 차량번호별 CAS(`최종갱신`) · 한 공급사 20% 넘게 줄면 그 공급사만 중단(발행기 가드와 같은 수치) · `공급사 데이터 매뉴얼`에 `자동반영 금지/반영 차단` 공급사는 진단만(기존 `applyProductMasterManualGate` 재사용).
- 출력: 공급사별 「신규 N · 상태변경 N · 대여료변경 N · 부재 N · 차단 N」과 dump(`--dump=`) — 발행기 dump와 차량번호로 견줄 수 있게 같은 열 이름.
- 자동화: `.github/workflows/sheet-sync.yml`에 **③ 상품리스트 발행 바로 앞** 단계로 넣는다(같은 시각의 공급사 값이 판매시트와 상품마스터에 동시에 들어가야 둘이 안 갈린다). ERP 반영은 기존 Vercel cron이 02:00 KST 에 상품마스터를 읽으므로 추가 호출 불필요.

## 3. [Cursor] 오더 B — 판매시트 ↔ ERP 정합 감사기 `scripts/audit-sales-sheet-vs-erp.mts` (읽기 전용)

- 판매시트 「상품리스트」 최신 탭(prefix 매칭, `lib/domain/sales-inventory-sheet.ts` 파서 재사용) vs ERP v4 products(`scripts/lib/db-snapshot.mts`) vs 상품마스터, 차량번호로 3방향 대조.
- 보고 축: ① 집합(판매시트에만/ERP에만/둘 다) ② 차량상태 ③ 기간별 대여료·보증금 숫자 원자 ④ 3축 차명(모델·세부모델·세부트림) ⑤ 정책코드.
- 대수는 「우리 시트 N · 아닌 시트 N · 총 N」 형식. 차이는 공급사별로 묶고 차량번호는 tmp JSON에만(콘솔엔 집계).
- 어긋난 돈 칸이 1개라도 있으면 exit 1 → 워크플로 ④ 「돈 대조」 다음 단계로 넣어 빨간 불.
- 기존 `audit-sales-sheet-sync.mts`(레거시 상품리스트→ERP 계획 검수)는 지우지 말고 헤더 주석에 「레거시, B로 대체」만 적는다.

## 4. [Cursor] 오더 C — ERP 표시를 판매시트와 같은 이름으로

- `lib/domain/product-master-import.ts` `trimIdentity`: 코드가 있으면 `maker/model/sub_model/trim_name`을 「차종마스터_규격채택」 채택 이름으로(`lib/domain/product-vehicle-normalization.ts` `normalizedNameForKey` 재사용). 채택 탭 읽기는 `lib/server/product-master-sheet.ts` 옆에 같은 방식(서비스계정·위임 사용자)으로 한 번만.
- 코드 없는 차: `data/product-vehicle-review-decisions.json` 의 TRIPLE/PARTIAL 3축을 `_review_identity`(신규 필드)로 실어 상품찾기 표시에 쓰되 `_product_master_identity_authoritative`는 false 유지(자동 확정 아님). HOLD 는 지금처럼 원문.
- 화면: 상품찾기·상세·계약 차량선택이 같은 표시 함수를 쓰는지 확인하고 한 곳(`lib/domain/product.ts` 차명 표시)으로 모은다. B2B 조밀 원칙, 폰트 토큰(`npm run check:fonts`).
- 회귀: `sim-product-master-import` 에 「코드→채택이름」·「결정 3축 표시」·「artifact 이름 fallback」 3케이스 추가.

## 5. 결정 필요(사장님) — D. 판매시트 입력을 상품마스터로 돌리나

- 지금은 판매시트가 공급사 시트를 직접 읽는다(8/12 사고 뒤 「옮기는 단계를 뺀다」). A가 돌면 상품마스터도 매일 같은 값이 되므로 발행기 입력을 상품마스터 한 문서로 바꿀 수 있다(429 쿼터·별칭표 유지 부담이 사라짐 — 설계 문서 §4-B).
- 권고: **A·B가 2주 정합(돈 diff 0)을 보인 뒤** 두 경로를 나란히 돌려 `--dump` 대조 → 값 사라진 칸 0 · 돈 어긋난 칸 0 이면 전환. 그 전엔 바꾸지 않는다.

## 6. 게이트·금지

- `npx tsc --noEmit` · `sim-product-master-import` · `sim-sheet-daily-sync` · `sim-supplier-sheet-read` PASS · `npm run check:manual`.
- A dry-run 산출을 Codex가 공급사 3곳 이상 원본과 손대조(상태·기간별 돈) 뒤에만 `--apply`. 첫 `--apply`는 사장님/Claude 확인.
- 금지: 상품마스터 잠금 칸 쓰기 · ERP/RTDB 직접 쓰기(ERP 반영은 기존 daily sync 경로만) · 공급사 원본 시트 쓰기 · 새 파서/새 정제 문서 · 차종 재매칭.

## 7. Codex 검증

- A: 공급사 3곳 원본 ↔ 상품마스터 ↔ ERP 3방향 차량번호·상태·돈 원자 diff, 음성대조(값 하나 바꿔 감사기가 잡는지).
- B: 판매시트 최신 탭 ↔ ERP 돈 diff 0 · 집합 차이 사유(출고불가 이력·@제외 탭) 설명 가능.
- C: 상품찾기 표시 차명이 판매시트 3축과 100% 일치(코드 있는 차), 결정 3축 표시가 자동확정으로 새지 않음.

# 정제시트 4곳 이후 정리 — Cursor 오더 (2026-08-18 오후, Claude)

배경: 사장님 「아이카·오토플러스·아이언·이안카 정제시트 만들어서 실시간 연동」 · 「상품마스터로 올 때는 어찌됐든 정제시트 통해서」 · 「우리가 쓰는 시트는 다 동일한 정제시트」. 오늘 Claude 가 정제시트 4곳·미러(`sync-mirror-all`)·정책 미러·문패 전환·워크플로(mirror-sync.yml 30분)를 넣었다. 남은 것은 아래.

## [Cursor] 오더 E — 상품마스터 탭 머리행 ↔ 코드 규격 복원 (오더 A 선결)
- 실측: `sync-product-master-live` 가 「상품마스터 A:AX 헤더 불일치」로 즉사. 시트 「상품마스터」(gid 1357902468) 머리행 = 「운영 확인 | 차량번호 | 공급사 | 공급사 제공 차량정보 | 확인 가능한 차종 범위 | 차종코드 상태 | 엄격 판정 …」(옛 상품 차종매칭 모양), 코드 `PRODUCT_MASTER_COLUMNS` = 「차량번호 | 공급사명 | 공급사 입력 차명 | 차종마스터 적용값 | …」 50열. ERP daily sync(`lib/server/product-master-sheet.ts`)도 같은 탭을 읽으므로 둘 다 멈춰 있다.
- 할 일: 어느 쪽이 정본인지 확정(「상품마스터_구버전」 gid 679088240 과 대조) → 탭 머리행을 코드 규격으로 되돌리거나 코드 규격을 탭에 맞추되 **한 곳만** 정본. 그 뒤 오더 A dry-run(문패 21곳 = 정제시트 경유)을 Codex 손대조 후 --apply.
- 금지: 차종코드·잠금칸 쓰기, ERP 직접 쓰기.

## [Cursor] 오더 F — `create-supplier-sheet --blank` 표준 드리프트
- 지금은 옛 **세로 정책 탭**(행=항목)·정제칸 없이 만든다. 오늘 아이언은 `transpose-policy-tab` + `add-supplier-ai-columns` 로 손봤다.
- 고칠 것: 정책 탭을 `policy-sheet-layout.policySheetHeader()` 가로 규격 + (프리패스 기본) 줄로, 재고 탭은 `TEMPLATE_COLUMNS`(28) + `AI_TAIL_COLUMNS`(12) = 40열로 처음부터. `audit-supplier-schema` 기준(웰릭스 실시트)과 같아야 한다.

## [Cursor] 오더 G — ERP 아이언 홈페이지 직접 반영 UI 정리
- `/api/inventory/ironrentcar/{preview,apply,rollback}` 는 홈페이지 → ERP 를 직접 쓴다. 이제 홈페이지 → 정제시트(`sync-mirror-sheet --source=iron`) → 상품마스터 → ERP 가 정본 길이다(사장님 규칙). 오더 E/A 가 돌기 시작하면 이 UI 는 «검증 전용(읽기)»으로 내리거나 제거. `isWebInventoryPartner`(sheet-sync-all.ts) 도 같이 본다 — RP006 이 시트 파트너로 잡히게.

## 판단 대기(사장님)
- 판매시트 오플 탭: 지금 「오플구독·오플프로모션」 = 원본 탭 통째 복사(08-13 지시). 정제시트가 생겼으니 「오플」 한 탭(상품리스트 규격 + 오플 대여료 블록)으로 바꿀지.
- 실시간 미러의 호스트: `mirror-sync.yml`(30분)·`sheet-sync.yml` 은 **main 에 있어야** 돈다(GOOGLE_SA_JSON 시크릿은 있음). 브랜치 push/merge 는 사장님 지시로만.
- 자체시트 나머지(손오공·리더스·스타·렌트존·우리캐피탈·SA)를 같은 미러 표(`mirror-sources`)에 넣고 문패를 정제시트로 넘길지.

## [설계] 오더 H — 영업 수주 화면 1차(Gemini 「DriveDirect PRO」 샘플 반영 · 라이트 유지, 다크는 참고만)

사장님 2026-08-18 「ui 샘플 주면 반영해 볼 수 있나」 → 「다크는 참고용으로 보고」. 샘플의 **정보구조**만 가져오고 색·라운드·두께·문구는 우리 토큰(C·FS·FW·R)·CI 그대로.

| 샘플 | 우리 ERP | 1차 |
|---|---|---|
| 상품 라인업 칩(전체·프리패스·손오공 인수형·하이브리드·제네시스) + 재고 카운터 | 사이드 「상품구분」 chips(신차렌트·중고렌트·중고구독·신차구독)만, 인수형은 축 없음 | ★`FinderLineupBar` — 툴바 아래 한 줄: 전체·상품구분 4종·**인수형(만기 인수)** 칩 + 대수. ptype 축 재사용(`ACQUISITION_PTYPE` 가상값 → 저장·프리셋·배지 공짜) |
| 손오공 인수형 구독 상품 | `price[m_인수형]` 은 있으나 `priceList` 가 표준가로 접어 **ERP 화면에 안 보임** — 판매시트 「손오공인수형구독」 탭과 어긋남 | ★`acquisitionPriceList` + `ProductPriceTable` 「인수형(만기 인수)」 표 — /m·/q 공용 |
| 손님 모바일 제안서 미리보기(폰 프레임) + 링크 | /q 손님 견적서 있음, /m 「손님 전달」 링크 복사만 | ★/m 「손님 화면」 버튼(웹) → 폰 프레임 iframe(/q?a=귀속) + 링크 복사 |
| 보기 3종·필터 줄·검색·정렬 | 이미 있음(card/list/excel·QuickFilters·사이드) | 그대로 |
| 다크 글래스·24px 라운드·800/900·이모지·DriveDirect 문구 | 규격 밖 | 안 씀 |
| AG 마진 슬라이더(손님가에 얹음)·카톡 알림톡·제안 내역·대시보드 | 없음(모델·계약 결정 필요) | 2차 — 사장님 결정 뒤 |

## [Cursor] 오더 I — 상품찾기 필터 줄 정리 (사장님 2026-08-19 · 화면 수정은 Cursor)

사장님 말 그대로: 「라인업이라는 필터 필요 없고 · 우측 「세부 필터」 버튼도 없애고 · **모델 색상 기간 대여료 보증금 주행거리 연식 연료 우대조건 심사조건** 이게 퀵필터로 드롭다운으로 있으면 된다 · 필터에 초기화 버튼 · 필터 잡혔는지 표시」.

- 지금 상태(배포됨 08-19 00:50): 툴바 아래 `FinderLineupBar`(라인업 칩 + 우측 「세부 필터」 토글) 한 줄, `FinderQuickFilters` 는 토글 열 때만.
- 바꿀 것:
  1. `features/finder/FinderLineupBar.tsx` 와 `app/finder/page.tsx` 의 `quickOpen`/`.fp-finder-filters` 래퍼·`.fp-lineup-bar` CSS(globals.css) **제거**. 라인업 줄·세부 필터 버튼 둘 다 없앤다.
  2. `FinderQuickFilters` 를 **툴바 아래 기본 노출 한 줄**로(웹). 카테고리 = 모델·색상·기간·대여료·보증금·주행거리·**연료(추가: present.fuel · value.fuel)**·연식·우대조건·심사조건 — 드롭다운 그대로.
  3. 같은 줄 오른쪽 끝에 **「초기화」**(활성 필터 있을 때만 solid/표시, 없으면 ghost·비활성) — 페이지의 `reset()` 호출(엑셀 헤더 필터·정렬까지 지움).
  4. **필터 잡힘 표시** — 카테고리 버튼 자체가 active(solid)+개수 배지는 이미 있음. 줄 왼쪽에 「N개 조건」 요약 배지 하나 더(0이면 숨김) 정도면 충분. 사이드(툴바 필터 아이콘) 배지와 숫자가 같아야 한다(sidebarAc).
  5. `.fp-finder-main` grid rows 는 `bar / auto / 1fr` 유지(quick 줄이 2번째).
- 건드리지 말 것: 상품구분 축의 「인수형(만기 인수)」 가상값(product-filters ACQUISITION_PTYPE — 사이드 상품구분 칩엔 계속 나온다) · ProductPriceTable 인수형 표 · CustomerPreviewModal(손님 화면) · priceList 인수형 제외 · 첫 화면 redirect(/login).
- 검증: tsc 0 · `npm run check:ui`·`check:tokens` 0 · 로컬 모드(NEXT_PUBLIC_DATA_BACKEND=local, Firebase env 비움, `NEXT_DIST_DIR=.next-dev-qa` 로 4004 와 분리)로 캡처 · 배포는 `npx vercel --prod --yes --archive=tgz`(파일 15,000 넘어 archive 필수).

---

# 계약진행 = 목록 + 진행상황 화면 — 계약서관리와 축 분리 (2026-08-19, 사장님 결정 · 반영 완료)

## 결정(사장님 2026-08-19)
- 계약진행과 계약서관리는 **다른 화면**이다. «내 계약이 어디까지 왔나»를 보는 곳과 «계약서를 만들어 손님에게 날리는 곳»을 분리한다.
- **계약서관리**(`/esign`, `NAV_LABEL.esign`) → 관리자 메뉴 맨 위(파트너사관리 위). 관리자만.
- **계약진행**(`/contract`) = 「목록이랑 그 계약이 어디까지 진행중인지 볼 수 있는 페이지」. 별도 신규 제작이 아니라 **커밋본(HEAD) `/contract` 를 그대로 되살렸다** — 목록(검색·정렬·계약월·업무단계 필터) | 계약 진행상황(5단계 `ContractPanel`, `/chat` 과 같은 SSOT) | 첨부 서류 | 정산상태.
- 반영: `app/contract/page.tsx`(HEAD 복원 · 작업트리의 발송센터 래퍼는 `tmp/qa/contract-worktree-sendcenter.tsx` 에 보관) · `lib/tabbar.tsx`(NAV_LABEL.esign='계약서관리' · appTabsFor · isTabRoute /esign=admin) · `components/TopBar.tsx` SIMPLE_GROUPS · `components/AppTabBar.tsx`(soon 탭 렌더 — 지금은 안 쓰지만 인프라 유지) · `scripts/sim-primary-navigation.mts`.

## 왜 나누나(실측)
- 작업트리의 `/contract`는 `EsignSendCenter workspace="contract"` — 목록이 `excel`/`direct` 소스만(`components/EsignSendCenter.tsx` sendRows) → **계약문의에서 온 ERP 계약이 계약진행에 안 보였다.** 5단계는 `/chat` 방 안에서만 보였다.
- 필터도 발송상태 4종뿐 — 「서류 대기」「입금 확인」이 화면에 없었다. 상대(공급사 vs 손님)와 상태 어휘가 다른 두 목록을 한 화면에 합치면 한쪽 어휘가 뭉개진다.

## 남은 것(결정·후속)
1. **엑셀/직접 등록 계약서(`contract_source` excel·direct)의 표기** — 이 건들은 `contract_status='계약요청'` 으로 저장돼(`lib/domain/deal.ts` createDirectContract) 5단계 체크가 없으니 계약진행 목록에서 「출고문의 진행」으로 보인다(커밋본과 같은 동작). 발송상태(발송대기/서명중/확인필요/완료)로 보이게 할지, 계약진행 목록에서 빼고 계약서관리에서만 볼지 결정 필요. SSOT 는 `contractStage`(`lib/domain/contract.ts`) 라 목록·문의·필터가 같이 움직인다 — 페이지 로컬로 땜질하지 말 것.
2. 계약진행 상세에서 «계약서 보내기» 로 `/esign` 으로 넘어가는 버튼 — 지금은 `/chat` 패널의 「계약서관리에서 확정」만 있다. 넣을지 결정.
3. `components/ContractSendWorkspace.tsx` · `EsignSendCenter` 의 `workspace` 분기 — 이제 `/contract` 가 안 쓴다(erp5 는 `erp5Mode`). 정리 여부는 Cursor 작업분이라 손대지 않았다.
4. `/esign` 페이지 게이트(`isEsignUiAllowed` admin+agent)는 그대로 — 영업자가 URL 로 치면 들어간다. 메뉴만 관리자. 막을지 결정.

## [완료] 오더 J — 계약서관리(전자계약) 화면 재편 · 4칸 배치 (사장님 2026-08-19 · Claude 직접 구현)

사장님 08-19: 「화면이 어색하고 직관적이지 못함」 → 「1에 목록 · 2·3에 계약서 작성내용 · 4에 발송링크 만들고 PDF 확인」. 사용자 「커서 안 만지고 있는데」 → Claude 가 직접 구현.

- **정본: `docs/ESIGN_SEND_CENTER_REDESIGN_2026-08-19.md`** — 실측 원인 10건 · 단계 SSOT 5개(작성·발송 전·고객 작성 중·검토 대기·완료) · 플래그 분리 · 용어표 · «4칸» 골격 · 단계별 카드 노출표 · §7 구현 상태.
- 바뀐 파일: `lib/domain/esign-center.ts`(esignCenterStage/Flags · 옛 버킷 제거) · `components/FreepassEsignPanes.tsx`(useFreepassEsign 훅 + 칸 2·3 StagePane + 칸 4 DocumentPane) · `components/EsignSendCenter.tsx`(4칸 · 초안 카드 1~4 가로폭 전체 · 필터 칩 · 요약 한 벌 · BLOCK 이면 버튼 비활성) · `components/list-rows.tsx`(단계 뱃지+플래그) · `app/esign/preview/[contractCode]/page.tsx`(back · preview=1) · `app/sign/[token]/page.tsx`(preview 모드) · `app/api/freepass-esign/public/[token]/route.ts`(peek 무쓰기 · progress 가 openedAt 채움) · `scripts/check-ui-contract.mts`(/contract 단언 HEAD 원복) · `scripts/sim-freepass-esign.mts`·`sim-esign-document-boundary.mts` 갱신 · **`components/ContractSendWorkspace.tsx` 삭제**(위 「남은 것 3」 해소).
- 사장님 추가(같은 날): 「회사·차량·대여조건 고르면 끝 — 바로 계약서 만들기, 정책 등은 펼쳐 보는 것」 → 4번 카드 없앰, 카드 3 아래 「계약서 만들기」 한 줄, 요약·정책값·추가조건은 details.
- 사장님 추가 2: 「전자계약 보내려면 파트너관리 가서 정보를 다 입력하라고 · 선택한 정책이 어떤 조건인지 4번에서 계약내용 확인으로 쭉 펼쳐서」 → 칸 4 = 초안·미발행이면 「계약내용 확인」(요약·공급사 정보·정책 조건 전부 펼침, 빈 값 「미입력」) / 발행 후엔 발행 당시 동결값 펼침 · 발송 전 확인에 「파트너사관리에서 {공급사} 정보 입력」 버튼.
- 사장님 추가 3: 「선택하면 그 부분이 촥 위로 올라와야지, 밑으로만 표가 내려가네」 → 다음 카드가 열릴 때 그 카드를 패널 맨 위로 `scrollIntoView`(차량·대여조건·계약서 만들기 줄).
- 사장님 추가 4: 「보증금 분납은 정책=가능 여부, 계약서 작성 때 선택되어야」 → `depositInstallmentOptions(policy, 보증금)`(불가→일시납 / N회까지→일시납·2~N회 / 0원→무보증) 카드 3 칩 · 미선택이면 BLOCK 「보증금 납부」 · contract_draft.deposit_installment 가 A4 `deposit_installment`·고객화면 「보증금 분납」 줄로 굳음(옛 자유 텍스트 칸 제거).
- 검증: tsc 0 · esign sim 전부 ✓ · check:tokens ✓ · check:ui 는 `AppTabBar` raw button 1건(메뉴 세션 몫)만 남음 · 로컬 캡처 데스크톱·모바일.
- 남은 것: 로컬 `.env.local` 서비스계정 키가 다른 프로젝트(gen-lang-client-…)라 ③~⑤(검토·승인·PDF) 실동작은 운영 키로 확인 · 위 「남은 것 1·2·4」는 여전히 결정 대기.

## [진행] 오더 K — 공급사 정책 시트 v2 (파트·순서·신설 8·드롭다운) — 손오공 1곳 반영 (2026-08-19)

사장님: 「전자계약서 보면서 정책 최종 정리 · 파트별로 색 구분하고 하나씩 입력해 나가는 순서 · 손오공 한 곳 먼저」. 정본 `docs/POLICY_ITEMS_FINAL_2026-08-19.md` §8.

- 코드: `policy-sheet-layout.ts`(PolicyPart 9 · PART_COLOR · 열 차례=답하는 순서 · 신설 8: 결제방식·납부조건·월 납부일·보증금 반환기한·무보험면책금·시동제어 기준일·회수·해지 기준일·보증금 미납 시동제어 · PREFILL 표준값) · `policy-value-spec.ts`(신설 8 규칙 · `money_or_rate`(정액/정률/개월분 겸용, 「7만원 또는 10%」는 검토) · `days` · 대물 영업용 목록) · `supplier-template-sheet.ts`(신설 8 ↔ ERP 키) · `policy-guide.ts`(파트 라벨) · transpose/normalize 스크립트 색=파트.
- 반영: `transpose-policy-tab --apply --sheet=1WIFn…` → 손오공 정책 탭 54열(정책 2개) · 드롭다운 47칸 · 되읽기 ✓ · 백업 `tmp/policy-backup-0810_손오공…-2026-08-191146.json`. 매뉴얼 문서 재생성(`SUPPLIER_POLICY_SHEET_MANUAL.md` 52항목·9파트).
- 같은 날 사장님 추가 결정 반영(전부 손오공 시트에 재적용, 48열): 「추가주행 방식」 폐지(값 표기가 방식) · 추가주행 금액/연령 하향 요금/추가운전 요금 = 「정액 3·5·7·10·15·20만원 또는 대여료의 3·5·7·10·15·20%」 표준 목록(`MONEY_OR_RATE_LIST`) · 「추가운전 인원」 신설(옛 합성 「1인까지 · 1인당 월 5만원」을 인원/요금 두 칸으로 가름, ERP allowance_count 가 「가능」을 0으로 읽던 버그 해소) · 월 납부일 = 5일 단위 인도일 기준(기본)/인도일 기준/고정 1·5·10·15·20·25·말일 · 탁송비 = 전액지원/일부지원/고객부담 · 「가입 보험사」·「자차 처리 제외」·「지정 정비점」·「보증금 미납 시동제어」 폐지(표준값·게이트 제외·`loadFreepassEsignBundle`이 `applyPolicyDefaults`로 빈칸 방지) · 대차 정책→「대차 제공」·회수·해지 기준일→「차량회수 기준일」(RENAMES) · 승계수수료 = 불가/50~500만원. `readPolicyTab`은 옛↔새 이름 별칭으로 둘 다 읽는다.
- 드롭다운 «칩» 표시는 Sheets API(DataValidationRule)에 필드가 없어 못 건다 — 화살표 드롭다운까지. 칩은 시트 UI에서 규칙별 수동.
- **정책 시트에서 「전용계좌」 폐지**(계좌는 회사정보·통장사본) · 「추가운전」 가부 폐지(인원 칸 불가) → 손오공 47열. 판매시트 전용계좌는 파트너 레코드 bank_* 에서(publish-origin-tab). **탭 정리**(사장님 「렌트재고·구독재고·운영정책·공지사항·회사정보만, AI 것은 숨겨」): `publish-supplier-tabs.mts` — 「정책」→「운영정책」 개명(코드는 `POLICY_TAB_ALIASES`로 두 이름 다 읽음: transpose/normalize/publish-origin-tab/guide/hub/report/audit/handover/prefill/add-rows), 「회사정보」 탭 신설(`company-info-sheet.ts` — 사업자등록증·통장사본 첨부 + 임대인·계좌 칸), 나머지 숨김. 손오공 반영 완료. publish-origin-tab dry-run 손오공 15대 정상.
- **전체 21곳 반영 완료(08-19 12:51)**: `transpose-policy-tab --apply`(v2 48열·운영정책 개명·드롭다운 45·백업 21건·되읽기 ✓) → `publish-supplier-tabs --apply --all`(회사정보 탭 19줄 신설·공지사항 없으면 신설·AI 탭 숨김·차례 재고→운영정책→공지사항→회사정보) → `normalize-policy-values --apply`(27칸 정규화). 회사정보 = 입력만(첨부 없음, 법인등록번호 추가, 자동차대여사업 등록번호 제외 → 게이트에서도 제외). ⚠ 재고 탭 이름(「재고」/「렌트재고」)은 손대지 않음 — 숨김은 AI 탭(`SUPPLIER_HIDDEN_TABS`)만.
- **프리패스 기본 정책 = 사장님이 손오공 시트 (프리패스 기본) 행에 넣은 값(08-19)** → `POLICY_PREFILL`이 정본(45항목), 매뉴얼에 「프리패스 기본 정책」 표로 찍음, `policy-defaults`(ERP 표준)도 정렬(대물 1억원·자손 1억원·승계 가능·면허 1년 이상·약정 연 30,000km·상향 대여료의 10%·자손 면책 30만원·정비 불포함·대차 불가). 반영 스크립트는 탭 전체 검증·메모를 먼저 지우고 입힘(전용계좌에 탁송비 목록 뜨던 유령 규칙 해소). 손오공 목록 밖 값 0(탁송비 협의→일부지원 3칸·납부조건 오타→선불). 정액/정률 목록 최종: 자차 최대면책 100~1천만원 · 자차수리비율 20/30/50 · 추가운전 인원 불가/1~5인/제한없음 등.
- **08-19 오후 — 사장님 추가 3건 반영(21곳 전부 58열)**: 운영정책 맨 앞 「심사조건」(무심사/소득확인/신용조회) · ⑨ 영업 뒤쪽 「불가조건 1~4」(한 칸 하나, 사장님 「저 쪽 뒤에 1 2 3 4로」 · ERP 는 하나로 이음) · 맨 뒤 ⑩ 제출서류 **체크박스** 6(본인서명사실확인서·가족관계증명서·주민등록등초본·운전경력증명서·소득자료(계좌)·소득자료(기관)) + 기타서류. 체크박스 BOOLEAN 이 빈칸을 FALSE 로 채우는 함정 → 정책 줄+10줄만 걸고 읽기는 FALSE=빈칸(`policyRowLive`). 매뉴얼 재생성.
- **ERP 원자 확보(08-19)**: 정책관리 선택지 = 시트 규격(`entities.sheetOpts`) · 겸용값 읽기 `policy-money-rate.ts`(가산·계약서·게이트) · 신설 원자(불가조건·sales_notes·파트너 회사정보 5) · 시트→ERP `audit-policy-sheet-vs-erp.mts`(--apply 빈칸만 / --overwrite). 정본 §8-3. **--apply 는 운영 RTDB 쓰기라 사용자가 직접 실행**(대조 결과: 빈칸 12 = 특이사항 → sales_notes).
- **정책관리 메뉴 제거 · 파트너사관리 4패널 · 인라인 정책 편집기(08-19)** — 목록·기본정보·운영정책(공급사별 정책 등록·수정·삭제 = 패널 안에서 아래로 열리는 `PartnerPolicyEditor`, 시트와 같은 파트·차례·드롭다운)·수수료정책, 패널 규격 통일, 등록 행 규격=계약서관리; /policy 는 계약서관리 왕복 링크용으로만 남음(IMPLEMENTATION_LOG 08-19 참고). 다음: 운영정책 패널 「시트에서 불러오기」(서버 API로 그 공급사 운영정책 탭 읽어 채우기 — 지금은 `audit-policy-sheet-vs-erp --apply`).
- 남은 것: 사용자 `audit-policy-sheet-vs-erp --apply` 실행 · 다름 21건 결정(법인운전자범위 문구·탁송비 협의→일부지원) 후 `--overwrite` · 파트너 못 찾는 5곳 이름 맞추기 · 결정 4건(자차 면책 연령 3단 · 입금계좌 정본 · 대물 표준값 1억원 확정 · 개명 2단계) · 공급사에게 시트 채워 달라 요청(21곳 전부 빈칸 있음).
