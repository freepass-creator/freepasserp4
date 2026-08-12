# 렌터카 계약 원자 — 숫자형 / 가부형 (계약서 칸 전수)

작성: Claude, 2026-08-08 · 사장님 지시(2026-08-08)
**기준: 두 템플릿의 합집합 174칸** — `rental-contract.html`(141) ∪ `contract-individual.html`(140)
(`auto_debit_date_inline` 복제 필드는 2026-08-10 제거하고 `auto_debit_date` 한 칸을 참조하도록 정리)
전제 문서: `CONTRACT_ATOMS.md` · `esign-field-map.ts` · `esign-contract-kind.ts`

> **「렌터카 계약은 거의 동일하다. 숫자화해야 하는 값이 있고, 가부로 결정할 게 있다.
> 그것만 뽑아내면 다 연결된다.」**
>
> **「기존 계약서를 이걸로 대체해야 하니까 빠진 게 없어야 한다.」**

라벨·값 예시는 템플릿에서 그대로 뽑았다(`scripts/dump-contract-labels.mts`). **지어내지 않는다.**
`FIELD_MAP` 은 `rental` 하나만 보고 만들어져 **개인용 계약서 칸 34개가 빠져 있었다.** 이 문서가 합집합 기준이다.

**표기** — `계약`·`재고`·`정책`·`파트너`·`입력`·`본인확인`·`고정`·`파생` = 출처 · **`없음`** = 채울 경로 없음
※ **연대보증 관련 8칸은 별도 과제**로 빼둔다(문서 말미 §H).

---

## A. 숫자형 — 수치로 확정되는 것

### A-1. 돈

| 칸 | 계약서 라벨 | 값 예시 | 출처 |
|---|---|---|---|
| `rent_amount` | 월 대여료 | `0` | 계약 — 약정에서 동결 |
| `deposit_amount` | 보증금 | `0` | 계약 |
| **`contract_deposit`** | **계약금** | `0` | **없음** — 보증금과 별개다 |
| `deposit_total` | 총 보증금 | `0 원` | 파생 |
| `deposit_round_1`~`_5` | 보증금 1~5회차 | `-` | **없음** — 분납일 때 |
| `buyback_price` | 인수 가격 | `-` | **없음** |
| `vehicle_price` | 차량 가격 | `-` | 재고 — **실측 전부 비어 있음** |
| `over_mileage_rate` | 초과 주행 요율 | `km당 000원` | 정책 — **1,000km 공제 후 적용**(약관 제12조) |
| `deductible_liability_person` | 사고 시 면책금(대인) | `30만원` | **연령 파생** |
| `deductible_liability_property` | 〃 (대물) | `30만원` | **연령 파생** |
| `self_damage_deductible_min` / `_max` | 자차 면책금 | `50만` / `100만` | **연령 파생** |
| `coverage_liability_person` | 대인 보상 한도 | `무한` | 정책 |
| `coverage_liability_property` | 대물 보상 한도 | `1억원` | 정책 |
| `coverage_self_injury` | 자손 보상 한도 | `1억원` | 정책 |
| `coverage_uninsured` | 무보험 보상 한도 | `2억원` | 정책 |
| `self_damage_coverage` | 자차 보상 | `차량가` | 정책 |
| `impound_fee` | 물품 보관료 | `1일 0원` | **없음** |
| `claim_basis` | 정산 청구기준 | `잔여 대여료 상당액` | 고정 |

### A-2. 기간·날짜

| 칸 | 라벨 | 값 예시 | 출처 |
|---|---|---|---|
| `rent_month` | 대여 기간 | `00 개월` | 계약 |
| `rent_month_label` | 대여 기간(표기) | `48개월` | 파생 |
| `contract_date` | 계약 체결일 | `2026. 00. 00.` | 계약 |
| `contract_start` / `contract_end` | 계약 시작일 / 종료일 | `2026. 00. 00.` | **인도일 확정 후 파생** — A-5 |
| `auto_debit_date` / `_inline` | 자동이체일 | `매월 25일` | **없음** — 손님 선택, 출고일 기점 고정 |
| `cms_start_month` | 출금 시작월 | `-` | 파생(인도일) |
| `cms_retry_date1` / `_date2` | 미납 시 재출금일 | `____` | **없음** |
| `invoice_cycle` | 세금계산서 발행 주기 | `월 1회` | 고정 |
| `payment_cycle` | 결제 주기 | `월 1회` | 고정 |
| `deposit_return_term` | 보증금 반환기한 | `반납·정산 후 00일 이내` | 고정 |
| `deposit_return_policy` | 보증금 반환 | `반납 후 1주일 이내` | 고정 |
| `impound_keep_term` | 물품 보관기간 | `반환 통지 후 00일` | 고정 |
| `handover_datetime` | 인수 일시 | `-` | **없음** — **계약기간 기산점** |
| `return_datetime` | 반납 일시 | `-` | **없음** |

### A-3. 거리·횟수·비율

| 칸 | 라벨 | 값 예시 | 출처 |
|---|---|---|---|
| `annual_mileage` | 연간 약정주행 | `20,000 km` | 정책 |
| `odometer_delivery` | 출고 시 주행거리 | `0 km` | 재고 → **출고 시 확정** |
| `odometer_return` | 반납 주행거리 | `-` | **없음** |
| `emergency_dispatch_limit` | 긴급출동 | `연 5회` | 정책 |
| `self_damage_deductible_rate` | 자차 자기부담률 | `20` (%) | 정책 |
| `early_termination_rate` | 중도해지 요율 | `30` (%) | 정책 |
| `early_termination_rate_y1` / `_y2` | **차량인도일**로부터 1년 미만 / 이상 | `30` / `20` (%) | `PENALTY_RATES` |
| `late_fee_rate` | 지연손해금률 | `연 00%` | 고정 — 회사마다 다름 |
| `smartkey_count` | 스마트키 | `1` 개 | **없음** |
| `spare_key_count` | 스페어키(보조키) | `1` | **없음** |
| `subkey_count` | 서브키 | `0` | **없음** |
| `vehicle_count` | 대여 차량 총 대수 | `1` | **없음** — 다차량 |
| `row_no` | 차량 연번 | `1` | **없음** |
| `model_year` | 연식 | `2024년식` | 계약/재고 |
| `driver_age` | 운전자 연령 | `만 26세 이상` | 정책 — **면책금이 여기서 파생** |

**면책금 3단** (계약서: 「운전자 연령 선택 시 자동입력」)

```
만 26세 이상  대인 30만 / 대물 30만 / 자차 20%, 50만~100만
(2단)         대인 50만 / 대물 50만 / 자차 20%, 70만~120만
(3단)         대인 60만 / 대물 60만 / 자차 20%, 80만~130만
※ 면허 취득 1년 이하는 면책금 추가(`extra_deductibles`)
```
→ 정책에 `deductible_by_age` 가 없다. 지금은 단일값이라 **연령이 바뀌어도 면책금이 안 바뀐다.**

### A-4. 계약 시점에 «아직 없는» 값 — 인도가 확정한다

계약서에 날짜가 아니라 **기산 방식**이 적힌다.

```
계약서 :  대여기간 48개월 (차량 인도일로부터)
인수증 :  인수 일시 2026년 8월 20일 14:30
파생   :  계약시작일 · 계약종료일 · 출금 시작월 · 중도해지 요율 구간(1년 기준)
```

중도해지 요율까지 「**차량인도일**로부터 1년 미만/이상」이라 인도일에 매달려 있다.
→ **차량 인수증은 부속이 아니라 계약을 완성하는 문서다.**

신차는 한 겹 더 있다 — 계약서 주석:
> 「**신차(출고 전)는 차량번호·차대번호가 미정**이며, 출고·등록 후 확정되면 임차인에게 서면(문자 포함)으로 통지」

---

## B. 가부형 — 예/아니오 또는 택1

### B-1. 계약의 축

| 칸 | 라벨 | 값 예시 | 갈리는 것 |
|---|---|---|---|
| `product_label` | 상품 유형 | `렌트 선택형` | 문서명·만기 처리 |
| `doc_title` | 문서 제목 | `자동차 렌탈 계약서` | 구독/렌탈 |
| `contract_type_label` | 임차인 구분 | `개인` | 개인/개인사업자/법인 |
| `tax_issue_type` | 발행 구분 | `개인 (주민번호)` | 계산서·식별번호 |
| `insurance_condition` | 보험 조건 | `보험료 포함 (월 대여료에 포함)` | **보험 묶음 전체** |
| `buyback_option` | 만기 인수옵션 | `만기 협의` | 인수형/반납형 |

### B-2. 제공 여부 — 「있음 / 없음」 한 단어

| 칸 | 라벨 | 값 예시 |
|---|---|---|
| `gps_installed` | 부가 장비 GPS | `장착` |
| `hipass_included` | 하이패스 | `제공` |
| `blackbox_included` | 블랙박스 | `제공` |
| `maintenance_product` | 정비 상품 | `정비 제외` |
| `designated_garage` | 지정 정비점 | `임대인 지정 또는 사전 합의된 정비점` |
| `maintenance_replacement` | 대차 서비스 | — |
| `replacement_car_policy` | 대차 정책 | `미가입 시 미제공` |
| `invoice_type` | 지출증빙 | `세금계산서` |

### B-3. 선택 결과 — 이 손님이 무엇을 골랐나

| 칸 | 라벨 | 값 예시 | 누가 |
|---|---|---|---|
| `deposit_installment` | 보증금 분납 스케줄 | `일시납` | 관리자 — **「가능」이 아니라 확정** |
| `contract_deposit_method` | 계약금 납부 | `계약 체결 시 즉시` | **없음** |
| `driver_scope` | 운전 가능 범위 | `계약자 본인 · 추가 운전자` | **약정 단계** — 금액을 바꾼다 |
| **`residence_type`** | **거주 형태** | `자가 / 전세 / 월세` | **없음** — 저신용·무심사에서 의미 있는 값 |

### B-4. 인수증 동봉 물품 (체크박스)

| 칸 | 라벨 |
|---|---|
| `has_navigation` | 네비게이션 |
| `has_blackbox` | 블랙박스 |
| `has_safety_sign` | 안전표지판 |

---

## C. 식별·텍스트

| 묶음 | 칸 |
|---|---|
| 계약자 | `customer_name` · `customer_phone` · `customer_address` · `customer_birth` · `customer_email` · `emergency_contact`(`관계 · 010-…`) |
| **본인확인** | `customer_id`·`customer_rrn`(주민등록번호) · `driver_license_no`·`driver_license`(운전면허번호) · `driver_or_biz_no` |
| 개인사업자 | `tax_biz_name` · `tax_biz_no` · `tax_ceo` · `tax_biz_address` · `tax_biz_type_item` · `tax_email` |
| 차량 | `vehicle_name` · `vehicle_model` · `maker` · `model` · `sub_model` · `trim` · `car_number` · `vin` · `color_exterior` · `color_interior` · `vehicle_color` · `fuel` · `options` · `vehicle_remark` |
| 임대인 | `company_name` · `company_ceo` · `company_ceo_title` · `company_biz_no` · `company_phone` · `company_address` · `company_logo` · `company_ci` · `company_ci_src` |
| 입금 | `payment_bank` · `payment_account_no` · `payment_account_holder` |
| CMS | `cms_bank` · `cms_account_no` · `cms_agency` · **`cms_depositor` · `cms_depositor_birth` · `cms_depositor_phone` · `cms_depositor_relation`** |
| 계약 식별 | `contract_code` · `contract_place` · `doc_kicker` · `terms_title` · `product_label` |
| 보험사 | `insurer_name` · `insurer_phone` |
| 추가운전자 1~3 | `drv1~3_name` · `_rrn` · `_relation` · `_license` · `_phone` (**1번만 등록됨, 2·3번은 경로 없음**) |
| 인수·반납 | `handover_location` · `handover_agent_name` · `fuel_gauge_delivery`/`_return` · `damage_delivery`/`_return` · `other_items` |
| 라벨 | `label_name` · `label_id` · `label_driver` · `label_emergency` · **`label_residence`** |
| 비고 | `contract_remark` · `confirmation_memo` · `special_terms` · `extra_deductibles` · `self_damage_exclusions` |

> **주민등록번호·면허번호 — 지금 아무도 안 받는다.**
> `CONTRACT_ATOMS.md` §11-B 는 「착한거래 본인확인이 받는다」고 하는데,
> 착한거래 OCR(`app/api/ocr/id/route.js`)은 **면허번호·주민번호 뒷자리를 일부러 추출하지 않는다.**

---

## D. 인수증 — 인수 시 / 반납 시 대조표

계약서 부속서류 1. **인수 시 값이 반납 판정의 기준점**이라 한 표에 두 열로 있다.

| 항목 | 인수 시 | 반납 시 |
|---|---|---|
| 일시 | `handover_datetime` | `return_datetime` |
| 주행거리 | `odometer_delivery` | `odometer_return` |
| 연료 게이지 | `fuel_gauge_delivery` | `fuel_gauge_return` |
| 외관 파손·스크래치 | `damage_delivery` | `damage_return` |
| 동봉 물품 | `has_navigation` · `has_blackbox` · `has_safety_sign` · 키 3종 | — |
| 인도 장소 · 인도자 | `handover_location` · `handover_agent_name` | — |

> 「본인은 위 차량을 **위 상태로 인수**하였으며, **반납 시 위 상태를 기준으로 점검**함에 동의합니다」

외관은 **차량 4면 도형에 파손·스크래치를 표기**한다 → 전자화하면 **사진 + 부위 표기**가 된다.

---

## E. 부속서류 — 계약서에 명시된 6종

```
① 개인정보 수집·이용 및 제3자 제공 동의서
② 개인신용정보 수집·이용·제공·조회 동의서
③ 위치정보 수집·이용 동의서          ← payload 에 없다. GPS 장착이면 필수
④ 자동이체(CMS) 출금 신청서
⑤ 차량 인수증 (부속서류 1)
⑥ 연대보증 확약서 (해당 시)          ← §H
```

지금 `consentAtoms` 는 **3건뿐**(신용정보 · CMS 이용 · CMS 제3자). **③ 위치정보 동의가 빠졌다.**
저신용·무심사 구조에서 GPS가 담보 역할을 하고 시동제어·회수까지 가는데, 위치정보 동의가 없으면
**그 행위 자체가 다툼거리가 된다.**

---

## F. 계약서 말미 — 주의사항

본문을 단답으로 만들면 「대차서비스 : 없음」은 남지만 «그래서 어떻게 되는지»가 사라진다.
그 자리를 말미의 주의사항이 받는다. **손님이 몰라서 사고 나는 것만** 추린다.

| 주의사항 | 약관 |
|---|---|
| 등록되지 않은 사람이 운전 중 사고 → **보험 전액 미적용, 계약자 부담** | 제5조 |
| 사고 시 **경찰 신고 또는 현장 출동이 없으면** 보험 처리 불가 | 제9조 |
| 중과실 12대 사고는 **수리비 20% 추가 부담** | 제9조 |
| 1년 내 과실 50% 이상 사고 **3회 누적 시 계약 해지** | 제9조 |
| 대여료 **3일 연체 시 시동제어 · 10일 연체 시 자동 해지 및 회수** | 제11조 |
| 약정 주행거리 초과 시 **1,000km 공제 후 km당 부담금** | 제12조 |
| **대차 지원 없음** — 사고·정비 중 이동수단은 본인 부담 | 제7조 |
| 만기 반납이 아닌 경우 **탁송료 본인 부담** | 제6조 |
| 과태료·통행료 미납 시 **보증금에서 차감 · 시동제어** | 제18조 |
| 연락처·주소 변경 미통지로 **연락 두절 시 시동제어·해지** | 제12조 |
| 만기 **30일 전까지 연장 신청이 없으면 미연장으로 간주** | 제2조 |
| **GPS 불법 탈거 시 민·형사 고발** | 제10조 |

**규칙** — 약관 문구를 그대로 옮기지 않는다 · 각 항목에 조항 번호를 단다 ·
조항 번호는 **회사마다 다르므로 payload 가 실어 보낸다**(JPK `제1조` / 손오공 `[제1조]`) ·
**확인 체크는 전체에 하나**(12개를 각각 체크시키면 아무도 안 읽는다).

```jsonc
"cautions": [
  { "text": "등록되지 않은 사람이 운전 중 사고가 나면 보험이 전액 적용되지 않고 계약자가 부담합니다.",
    "article": "제5조" }
]
```

---

## G. 우선순위 — 계약서에 명시돼 있다

```
특약사항  >  계약서 개별 조건  >  약관
```

- `special_terms` 라벨: 「**약관·계약조건에 우선** 특약 사항」
- 약관 본문: 「본 약관과 **계약서 기재가 상충하는 경우 계약서의 개별 조건을 우선**한다」

→ 같은 내용을 두 곳에 쓰면 어느 쪽이 이기는지 매번 따져야 한다. **중복을 없애야 하는 근거다.**

```
계약서 본문  숫자형 → 숫자로        「3일」 「10일」 「km당 000원」
             가부형 → 한 단어로      「대차 서비스 : 미가입 시 미제공」
             식별형 → 그대로
계약서 말미  주의사항 → 서술형 요약 + 조항번호 · 확인 체크 하나
약관         전문 서술 → 조건·예외·절차
```

---

## H. 연대보증 — 별도 과제 (이번 범위 밖)

칸은 계약서에 이미 있다. 채울 경로가 없다.

| 칸 | 라벨 | 값 예시 |
|---|---|---|
| `guarantor_name` | 성명 | `-` |
| `guarantor_rrn` | 주민등록번호 | `-` |
| `guarantor_relation` | 관계 | `-` |
| `guarantor_phone` | 연락처 | `-` |
| `guarantor_occupation` | 직업 | `자영업` |
| `guarantor_address` | 주소 | `-` |
| `guarantor_scope` | **보증 범위** | `전액 연대` |
| `guarantee_limit` | **보증 한도(최고액)** | `-` |
| `guarantee_period` | 보증 기간 | `계약 기간 만료일까지` |

보증인은 **서명자가 다르므로 별도 서명 세션**이 필요하다. 약관 제20조가 이 값들을 참조한다.

---

## I. 감사 결과 — 종이 계약서를 대체할 때 비는 칸

`scripts/audit-contract-fields.mts` (2026-08-08 실측)

```
계약서 칸 합집합        174
채울 경로 있음          108
못 채우는 칸             66
   ① FIELD_MAP 미등록    34   ← 개인용 계약서 칸이 통째로 누락돼 있었다
   ② 등록됐지만 경로 미정  32
```

**우선순위 (저신용·무심사 + GPS 담보 구조 기준)**

| 순위 | 무엇 | 왜 |
|---|---|---|
| 1 | **위치정보 수집·이용 동의**(E-③) | GPS로 시동제어·회수를 하는데 동의가 없다 |
| 2 | **인수증 6칸** — 일시·장소·담당자·주행거리·연료·손상 | **계약기간·중도해지 요율 구간의 기산점** |
| 3 | **본인확인 2칸** — 주민등록번호·면허번호 | 양쪽이 서로 상대가 받을 것으로 보고 있다 |
| 4 | **CMS 예금주 4칸 + 재출금일 2칸** | 계약자≠예금주일 때 출금이 안 된다 |
| 5 | **계약금**(`contract_deposit`) + 납부 방식 | 보증금과 별개 항목인데 원자가 없다 |
| 6 | 반납 4칸 · 키 3칸 · 동봉물품 3칸 | 반납 정산의 기준 |
| 7 | 거주 형태 · 다차량 3칸 · 개인사업자 3칸 | |
| — | 연대보증 9칸 | §H 별도 과제 |
