# 픽업구독 원천·옵션 SSOT 운영 매뉴얼

사용자 확정: 2026-09-15 — **픽업구독 옵션은 티카에서 확인한다.**
적용 범위: 공급사 RP012 중 TCAR_EXTERNAL / 픽업구독. SON_NO_KONG / 오공구독과 구분한다.
사용자 재확인(2026-09-15): **손오공은 공급사, 오공구독은 반납받아 보유 중인 물량, 픽업구독은 사오는 물량이다.** 기존 ‘손오공구독’ 표기는 오공구독의 과거 시트·코드 명칭으로만 해석한다. 데이터 수집 사이트와 재고의 사업상 구분을 혼동하지 않는다. 기존 탭명 변경이나 차량 재분류가 이번 문서 수정으로 실행된 것은 아니다.

## 1. 어디서 가져오는가

**원천 확인 기준과 현재 자동화 상태는 다르다. 현재 자동수집은 paidOptList 중심이며 memo 추가옵션 저장·발행은 미구현이다. Firestore·시트 값만으로 티카 전체 옵션 확인 완료라고 판단하지 않는다.**

| 데이터 | 확인할 원천 | 경로·주의 |
|---|---|---|
| 픽업 재고 대상 | 손오공 API | https://sokrc.com/api/product/homepage/list 의 carSource=LOW_TCAR. 응답 항목 carSource=TCAR_EXTERNAL 확인 |
| 계약조건·기간별 요금 | 손오공 상품 상세 | /product/homepage/view/{id}, estimates의 해당 신용·인수/반납 조건. 티카 판매가격을 구독요금으로 쓰지 않는다 |
| 티카 상세 링크 | 손오공 에이전트 상세 | /product/view/{id}의 carSourceUrl. 링크만으로 동일 차량 확정 금지 |
| 옵션 원문 | **해당 차량의 티카 상세** | https://tcar.lotterentacar.net/cr/search/view?carId={실제ID}&saleTySale=true |

### 저장·표시 결과물 (원천과 구분)

- Firestore: freepasserp5 / (default) / products. provider_company_code=RP012와 픽업구독 분류를 함께 확인한다.
- F01·F86: 원천을 확인해 반영하는 표시 결과물이다. 기존값 자체를 티카 원문으로 승격하지 않는다.

재고·요금은 손오공에서, 옵션 확인은 티카에서 한다. 티카 전체 매물 목록을 픽업 계약 가능 재고로 간주하지 않는다. RTDB는 폐기됐으며 fallback으로 사용하지 않는다.

## 2. 티카에서 옵션을 확인하는 방법

1. 현재 차량번호를 확보하고 연결된 티카 상세를 연다.
2. 화면 차량번호와 숨은 jsonData의 **formData.carInfo.plateNumber / carId**가 대상과 일치하는지 확인한다.
   - checkInfo 내부 검사 당시 번호판이나 HTML에서 처음 발견한 plateNumber를 쓰지 않는다.
   - 링크가 없거나 다른 차량이면 현재 번호판 검색의 정확한 단일 결과만 채택한다. 없거나 중복이면 HOLD.
3. 아래 세 정보를 각각 확인한다.

| 원문 위치 | 의미 | 처리 |
|---|---|---|
| jsonData.paidOptList | 구조화된 유료 선택옵션 목록 | 원문 배열과 출처 보존. 표시에서 반복 금액만 제거 |
| jsonData.formData.carInfo.memo, 화면 차량설명 | 판매자가 작성한 추가옵션 설명 | ‘추가옵션’ 항목을 직접 확인. 판매자 설명 출처로 분리하며 구조화 목록으로 가장하지 않는다 |
| jsonData.formData.carOptList, 화면 옵션 전체보기 | 해당 차량 장착옵션 목록 | 기본장비와 추가장비가 섞일 수 있다. 전체를 유료 선택옵션으로 넣지 않는다 |

**paidOptList=[]는 해당 필드가 비었다는 뜻이다. 선택옵션 없음 또는 누락 없음의 증거가 아니다.**
반드시 차량설명의 추가옵션을 대조한다. 설명에도 근거가 없으면 ‘추가옵션 근거 미확인’으로 둔다.
‘추가옵션’ 표제 아래 기본장비·트림명이 섞여 있으면 자동 채택하지 않는다.
판매자 설명은 판매자 주장임을 보존하며 제조사 출고사양 검증 완료로 표현하지 않는다.
두 출처가 충돌하면 한쪽을 임의로 덮지 말고 충돌로 기록한다.

## 3. 실제 구현 위치와 남은 차이

- 수집 클라이언트: sonokong/lib/sonokong.mjs — list, view, viewAgent, lotteSpec, findTcarSaleByPlate.
- 수집·로컬 원문: sonokong/scripts/손오공.mjs → sonokong/lib/wonja/손오공차량.json.
- 번호판/옵션 정규화: sonokong/lib/option-normalizer.mjs.
- Firestore 유입: scripts/ingest-supplier-to-firestore.mts.
- 옵션 한정 동기화 도구: scripts/sync-sonokong-options-only.mts.
- 표시 분류: lib/domain/sales-atom-row.ts, lib/domain/sales-block.ts.

2026-09-15 조사 시 코드의 티카 선택옵션 자동수집은 paidOptList 중심이다.
**memo 추가옵션을 출처별로 저장·발행하는 자동 경로는 이 매뉴얼 작성으로 구현되거나 배포된 것이 아니다.**
SON_NO_KONG 전용 carOptionNote fallback을 픽업구독에 확대하지 않는다.
검증 원문→Firestore 옵션·근거→판매시트 표시를 대조하되 실제 실행 경로는 실행별로 확인한다.

## 4. 표시 대상과 검수

- [F01 프리패스 상품리스트](https://docs.google.com/spreadsheets/d/1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs/edit), 픽업구독 sheetId=978740603.
  - 조사 당시 탭 픽업구독 09.15 09:40, 차량번호 C열 / 옵션(원문) AB열.
- [F86 하허호 상품시트](https://docs.google.com/spreadsheets/d/1hQtshpWKL4L0zSR3H3UQ36atICtHv9Ka7dQh7d7K5Vg/edit#gid=1505044382), 손오공 sheetId=1505044382.
  - 조사 당시 차량번호 C열 / 옵션(원문) P열. 손오공 전체 혼합 탭이므로 픽업 차량만 식별한다.

탭 이름·열·재고 수는 고정값이 아니다. 실행 직전에 메타데이터와 헤더를 다시 읽는다.
현재 차량번호·원천URL·원문 위치·조회시각·원문 스냅샷/해시·판정·변경 전후를 남긴다.
수정 후 원천/Firestore/시트를 다시 대조하고 차량번호·서식·범위 밖 셀 보존을 확인한다.
원천 완전성 검수와 저장값 일치 검수를 구분한다. 값 일치만으로 전체 옵션 누락 없음 판정 금지.

## 5. 알려진 누락과 재발 방지 사례

장착옵션은 유료/추가옵션의 근거가 아니며, 빈칸 자체로 누락을 확정하지 않는다. 아래7대는 장착목록 때문이 아니라 판매자 추가옵션 설명이 별도로 존재해 발견한 누락이다.

2026-09-15 재조회: F01 픽업238대, 옵션값184대, 빈칸54대.
빈칸 중46대는 현재 티카 상세가 일치하고 paidOptList가 비었으나 장착옵션18~63개가 있었다.
그중7대는 판매자 설명에 KRELL 사운드·AWD·선루프·주차보조 등 추가옵션이 명시돼 있었다.
나머지8대는 현재 상세 매칭 미해결이다. 이 수치는 당시 스냅샷이며 현재 재고 수가 아니다.

[조사·반영 이력](SONOKONG-OPTION-SSOT-20260915.md)을 함께 읽는다.
이력은 손오공 전체를 포함하지만 이 매뉴얼은 픽업구독만 적용한다. 이력의 SON_NO_KONG 규칙을 가져오지 않는다.
이 매뉴얼은 출처와 검수 기준 확정이며 위7대의 DB/시트 복구 완료를 의미하지 않는다.
