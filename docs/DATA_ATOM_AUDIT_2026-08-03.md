# 데이터 원자·계보 감사 — 2026-08-03

## 결론

현재 데이터는 화면을 띄우는 데는 충분하지만, 출시 가능한 단일 규격으로는 아직 정리되지 않았다. 가장 큰 문제는 필드 부족 자체보다 다음 네 가지다.

1. 같은 원자가 여러 이름으로 저장된다.
2. 서로 다른 원자를 한 필드나 표시 문자열로 합친다.
3. 수집한 개인정보·업무정보가 실제 기능에서 소비되지 않는다.
4. 레코드 출처는 일부 남지만, 개별 필드의 출처·수정 주체·수정 시각은 추적하기 어렵다.

이번 감사는 운영 RTDB의 **필드명과 존재 건수만** 읽고 값은 출력하지 않았다. 정적 소비처 탐색은 휴리스틱이므로, `직접 참조 0`은 강한 미사용 근거지만 참조가 있다는 사실만으로 해당 엔티티의 실제 소비를 보장하지는 않는다. private 노드는 운영 역할에 따라 조회 결과가 달라질 수 있어 금액·수수료의 0건 판정에는 사용하지 않았다.

## 원자 분류 규칙

| 분류 | 의미 | 저장 원칙 |
|---|---|---|
| 식별 원자 | 차량번호, 상품키, 계약번호, 파트너코드 | 한 엔티티에서 하나의 canonical 이름만 사용 |
| 사실 원자 | 제조사, 모델, 연식, 사업자번호 | 값 하나가 의미 하나만 가져야 함 |
| 스냅샷 | 계약 당시 차량명·가격·정책 | 원본 링크와 별도로 거래 시점 값을 고정 |
| 파생 원자 | `vehicle_name`, 표시용 가격, 진행률 | 저장보다 canonical 원자에서 계산을 우선 |
| 출처 원자 | 시트, OCR, 수기, 시스템, 마지막 수정자 | 레코드뿐 아니라 중요 필드 단위로 추적 |
| 민감 원자 | 생년월일, 면허, 계좌, 이메일 | 목적·권한·보존기한과 함께 private 저장 |
| 상태 원자 | 차량상태, 계약단계, 읽음상태 | 상태값과 함께 변경 주체·시각·사유 보존 |

## 출시 전 차단 판단이 필요한 항목

### P0-1. 메시지 `sender_email` — 수집되지만 쓰이지 않는 개인정보

- 운영 메시지 2,010건 중 1,598건에 존재했다.
- 현재 `sendText`·`sendFile`은 `sender_uid`, `sender_code`, `sender_role`, `sender_name`만 기록한다.
- 앱·도메인 코드에 `sender_email` 소비처가 없다.
- 신규 수집은 이미 사실상 중단됐지만 과거값의 접근권한·보존기한·삭제정책은 확정되지 않았다.

판정: 신규 필드로 승격하지 않는다. 과거값은 즉시 자동 삭제하지 말고 법적 보존 목적과 운영 조회 필요성을 확인한 뒤 비식별화 또는 삭제 마이그레이션을 별도 승인한다.

### P0-2. 상품 `account_number` — 소유 엔티티가 잘못된 민감 원자

- 운영 상품 408건 중 349건에 존재했다.
- 일반 상품 화면과 계약 흐름에서는 사용하지 않고, 중복 상품 dry-run이 파트너 계좌와 불일치를 확인할 때만 읽는다.
- 파트너에는 이미 `bank_account`, `rent_bank_account` 계열이 존재한다.
- 상품 public 레코드에 계좌가 남는 구조는 최소수집·최소노출 원칙에 맞지 않는다.

판정: 상품 원자로 유지하지 않는다. 파트너 private의 canonical 정산계좌를 결정한 후 비교용으로만 읽고, 값 이동·삭제는 계좌 소유권 확인과 사람/Claude 게이트 뒤에 수행한다.

### P0-3. 사업자번호·회사명 — 역할마다 다른 이름과 의미

현재 공존하는 이름:

- 회원: `business_no`, `company_name`
- 파트너: `business_number`, `name / partner_name / company_name`
- 고객: 선언은 `business_no / business_name`, 운영값은 `business_number / company_name`
- 계약: `customer_business_number / customer_company_name`

회원의 사업자번호는 가입 시 파트너 매칭 근거이고, 파트너 사업자번호는 권한 귀속의 기준이다. 이름만 맞추는 일괄 rename은 인증을 깨뜨릴 수 있다.

판정: 개념 SSOT는 `business_registration_number`, `legal_name`, `display_name`으로 정의하되 기존 저장 필드는 읽기 alias로 유지한다. 쓰기 경로는 역할별 adapter 한 곳에서만 canonical로 변환한다. 인증·권한 영향 때문에 사용자 승인 없이 마이그레이션하지 않는다.

### P0-4. 계약·고객 개인정보 — 수집 목적은 있으나 실제 업무 소비가 끊김

- 계약 40건 중 `customer_birth` 32, `customer_is_business` 31, `customer_business_number` 2, `doc_license` 13건이 존재하지만 직접 소비처가 없다.
- 고객 40건 중 `birth`와 `is_business` 40건, `business_name` 1건이 존재하지만 고객 업무 화면 소비가 확인되지 않았다.
- 개인정보처리방침은 계약 진행을 위해 생년월일·면허·주소·서류 이미지를 수집한다고 명시한다.
- 따라서 단순 삭제 대상이 아니라 **계약서 생성/심사/인도 중 어디서 필요한지 연결이 끊긴 상태**다.

판정: 각 원자에 `수집목적`, `필요 단계`, `노출 역할`, `보존 시작/만료`, `파기 방법`을 지정하기 전 추가 수집을 늘리지 않는다. 실제 계약서·심사에 필요하지 않은 항목은 입력폼에서도 제거한다.

### P0-5. 감사로그 두 구조 공존과 민감값 잔존 가능성

- 운영 감사로그 17,029건에서 구형 `collection / record_key / fields / values / ts`와 신형 `entity / target_key / changes / before / after / at`가 공존한다.
- 화면은 구형 로그를 읽을 때만 신형 표시 형태로 변환하며, 저장 구조 자체는 통일되지 않는다.
- 신형 저장은 일부 PII를 마스킹하지만 `business_no` 등 alias와 중첩 객체의 민감값을 완전하게 분류하지 못한다.

판정: 새 로그는 신형 envelope 하나만 쓰고, 변경값은 원문 전체 JSON 대신 허용된 diff만 저장해야 한다. 과거 로그 변환·삭제는 감사 보존정책 확정 후 별도 수행한다.

## 합쳐야 하는 원자

| 현재 분산 | canonical 제안 | 처리 방식 |
|---|---|---|
| `photo`, `photos`, `image_url`, `image_urls`, `images`, `doc_images` | `media[]` 또는 `photos[]` | 입력 adapter에서 배열로 정규화, UI는 canonical만 소비 |
| `name`, `partner_name`, `company_name` | `legal_name` + `display_name` | 법인명과 표시명을 먼저 분리한 뒤 alias 제거 |
| `business_no`, `business_number`, `biz_no` | `business_registration_number` | 숫자 정규화 함수와 검증을 공통화 |
| 방의 `vehicle_number`, `car_number` | `car_number_snapshot` | 방 생성 시 차량 snapshot으로 고정 |
| 계약 `doc_attachments`, `customer_docs`, `attachments` | `attachments[]` | 현재 읽기 정규화를 저장 canonical에도 적용 |
| 정책의 `*_legacy` 결합 보험값 | `limit` + `deductible` | legacy는 읽기 fallback만 유지 |
| 정산 `rent_month`, `rent_month_snapshot` | `rent_month_snapshot` | 정산 생성 시 거래 snapshot 하나로 고정 |

## 쪼개야 하는 원자

| 현재 결합/혼동 | 필요한 원자 | 이유 |
|---|---|---|
| `vehicle_name` | maker, model, sub_model, variant, trim_name, trim_extra + 파생 display | 제조사 누락·목록 불일치의 직접 원인. 문자열은 검색·정렬·수정 SSOT가 될 수 없음 |
| `delivery_region / delivery_address` 혼용 | delivery_region, postal_code, address_line1, address_detail, contact_name, contact_phone | 권역과 실제 인도지는 다른 개인정보·업무 원자 |
| `provider_name` | provider_company_code + provider_name_snapshot | 현재 조직 링크와 당시 표시명을 구분 |
| 구형 방 `read_by / unread` | 역할별 unread count + last_read_at | 영업·공급·관리자 3역할에서 단일 읽음값은 의미가 없음 |
| 계약 단계값만 저장 | step value + changed_at + changed_by + reason | 현재 `_by` 일부만 산발적으로 존재해 책임 추적이 불완전 |
| `status_label` | canonical status + reason_code + display label | 표시 문구가 업무상태 SSOT가 되면 시트·수기 변경이 충돌 |
| 파트너 `contact` | contact_name, phone, email, position | 연락 담당자와 연락수단을 분리해야 검색·권한·마스킹 가능 |

## 선언과 운영 저장이 어긋난 항목

### 상품

- 408건, 선언 46개 중 33개만 운영값 존재.
- `photos / image_urls / doc_images`는 비어 있고 정규화된 `photo`는 405건에 존재한다.
- `annual_mileage`가 상품 288건에도 있으나 스키마에서는 정책 원자다. 현재 UI는 정책값 우선, 상품값 fallback을 사용한다.
- `provider_name`, `vin`, `image_urls`, `photos`, `doc_images`, `event_tags` 등은 선언됐지만 운영값이 없다.
- `source_schema`, `source_sheet_id`, `sheet_meta`, `raw_model_*`, `match_confidence`, `match_flags` 등 중요한 유입·매칭 원자는 저장되지만 스키마에 없다.

### 계약

- 40건, 선언 72개 중 56개 운영값 존재.
- 실제 첨부 표준인 `attachments`가 선언에 없고 레거시 `doc_attachments`가 공존한다.
- `delivery_address`, `deposit_payment_type`, `ext_color_snapshot`은 실제 로직이 읽지만 선언에 없다.
- 단계 처리자의 `_by` 필드가 다수 저장되지만 `_at`과 함께 정형화되지 않았다.
- 런타임 단계 SSOT에는 `agent_final_paid`가 있으나 별도 `STEP_CHECK_KEYS` 복제 목록은 이를 누락해 중복 SSOT 드리프트가 있다.

### 방·메시지

- 방 204건은 선언 23개 전부 값을 가지지만, 실제 목록이 쓰는 `car_number`, `vehicle_name`, `agent_name`, `room_code`, `last_sender_uid` 등이 선언 밖이다.
- 메시지 기존 데이터 대부분은 `channel`이 없고, 신규 메시지만 `간단 / 정식`을 기록한다. 계약문의는 channel 없는 legacy를 포함해 모두 보며 간단문의 화면은 `간단`만 본다.
- 파일 전송은 `storage_path`, `file_size`, `file_type`을 저장하지만 스키마에 없다.

### 회원·파트너·고객

- 회원 155건에는 `email` 150, `phone` 149, `business_no` 97, `matched_partner_code` 63건 등이 있으나 회원 엔티티 선언은 11개뿐이다.
- 파트너 35건에는 대표자·주소·전화·은행·담당자 원자가 다수 존재하지만 회원관리 화면의 파트너 편집은 이름·유형·사업자번호·연락처와 시트설정 일부만 다룬다.
- 고객 엔티티는 운영 데이터가 있으나 앱의 명시적 CRUD 업무 흐름이 확인되지 않고 계약 snapshot이 사실상 고객정보를 대신한다.

### 정산

- 건별 정산 15건에는 `deposit_amount`, `rent_month`, `settle_month`, 차량/모델 snapshot이 저장되지만 선언 밖이다.
- 관리자 월정산은 실제 계산 SSOT인 `ADMIN_SETTLE_BLOCKS`가 별도로 있고, `ENTITIES.admin_settlement`는 VAT·수수료율·계약기간 등 실제 필드 상당수를 누락한다.
- 이는 같은 엔티티에 스키마 SSOT가 둘인 상태다.

### 견적·리포트·OCR

- 견적은 스키마 23개가 있으나 운영 레코드와 완성된 생성 흐름이 없다. `credit_display`, `insurance_summary`, `valid_until`, `view_url`, `sent_channel`, `sent_at`은 직접 소비처도 없다.
- 차량등록증 OCR Python은 `year`, `engine_cc`, `usage`를 반환하지만 ENTITIES의 `ocrFrom`은 `car_year_month`, `displacement`, `usage_type`을 기대한다.
- 감사 시점에는 클라이언트가 OCR 응답 키를 폼에 직접 복사해 예상 밖 키도 들어갈 수 있었다. 1차 차단에서 `mapOcrToEntity`를 실제 경계로 연결하고 OCR 대상 선언 필드만 허용하도록 수정했다.
- 배포 환경에서는 OCR API가 501을 반환하므로 출시 기능으로 볼 수 없다.

## 추가해야 할 원자

다음은 화면을 채우기 위한 필드가 아니라, 데이터가 안전하게 움직이기 위해 필요한 원자다.

1. **필드 계보**: 중요 필드별 `source_type`, `source_id`, `source_column`, `imported_at`, `last_modified_by`, `last_modified_at`.
2. **수기 우선권**: 현재 `_sheet_manual_fields` 배열 대신 필드별 소유자(`sheet/manual/engine`)와 충돌 상태.
3. **데이터 품질**: `schema_version`, `validation_status`, `validation_issues`, `validated_at`.
4. **계약 단계 이력**: 단계별 `value / changed_by / changed_at / reason` 이벤트.
5. **개인정보 생명주기**: `purpose`, `consent_version`, `collected_at`, `retention_until`, `erased_at`.
6. **알림 배달 원장**: `event_id`, `recipient_uid`, `channel`, `template_version`, `sent_at`, `delivery_status`, `retry_count`, `provider_message_id`. 현재 `fcm_tokens`은 있으나 업무 알림의 발송·실패·재시도 원장은 확인되지 않았다.
7. **조직 이름 분리**: `legal_name`, `display_name`, `representative_name`; 계좌·담당 연락처는 private 하위 구조.
8. **구조화된 인도정보**: 권역과 실제 주소·담당자 정보를 분리하고 역할별 마스킹.

## 수집 경로별 판정

| 경로 | 현재 처리 | 문제 | 목표 |
|---|---|---|---|
| Google Sheet | 공급사 설정 → adapter → header/profile 매핑 → product 정규화 → v4 soft-merge | 레코드 출처는 있으나 필드별 출처와 원본 열이 불명확 | field lineage + 소유권 + 충돌 상태 |
| 재고 수기편집 | 폼 → `_sheet_manual_fields` → v4 overlay | 배열만으로 변경시각·변경자·원래 출처를 알기 어려움 | 필드별 override 메타 |
| OCR | 파일 → Python → 임의 키를 폼에 직접 병합 | 스키마 매핑이 실제 반환키와 불일치 | allowlist + canonical mapper |
| 가입 | 회원 입력 → users → 사업자번호로 partner 재매칭 | 이름이 다르고 권한 근거와 사용자 입력이 섞임 | 사용자 주장값과 관리자 확정값 분리 |
| 계약 생성 | product/policy/user 현재값 → contract snapshot | 일부 snapshot·인도·첨부 필드가 선언 밖 | snapshot schema/version 고정 |
| 정산 생성 | contract snapshot → settlement → private 분리 | 공개/비공개, 현재값/snapshot 이름 혼재 | 정산 envelope와 private schema 고정 |
| 채팅 | room + message, v3 nested와 v4 flat 병합 | legacy channel 없음, sender_email 잔존 | 신규 canonical만 쓰고 legacy 읽기 adapter |

## 실행 순서

1. P0 개인정보·계좌·감사로그의 **목적/권한/보존 결정**을 사람/Claude가 승인한다.
2. canonical 이름과 alias 읽기표를 `CLAUDE.md` 데이터 SSOT에 고정한다.
3. 모든 신규 쓰기를 canonical adapter로 통과시키고 legacy alias 쓰기를 차단한다.
4. UI는 canonical만 읽고, legacy 정규화는 RTDB adapter 경계에서만 수행한다.
5. 값 이동·삭제 없는 read-only dry-run으로 건수·충돌·권한 영향을 출력한다.
6. 계약·정산·인증 관련 마이그레이션은 실데이터 게이트 후 v4 overlay에만 적용한다.
7. 마지막에 legacy alias의 쓰기 중단 → 읽기 제거 → 데이터 정리 순으로 진행한다.

## 이번 작업에서 한 변경

- `scripts/audit-data-atoms.mts`를 추가했다.
- 정적 선언/소비처 감사와 운영 RTDB 필드 존재 건수 감사를 지원한다.
- 운영 감사는 값을 출력하지 않으며 v3 nested 메시지와 v4 flat 메시지를 구분한다.
- adapter 실제 규격에 맞게 휴면 `quote`, `report` 노드명을 수정했다.
- RTDB 응답 지연 시 20초에 실패하도록 해 검증 프로세스가 무기한 멈추지 않게 했다.
- OCR 입력은 엔티티에서 `ocrFrom`으로 선언한 원자만 폼에 들어가도록 allowlist를 적용했다. 현재 canonical key와 과거 source alias를 입력 경계에서 함께 정규화한다.
- 레거시 상품 `account_number`는 소유권 확정 전 삭제·파트너 자동이관하지 않고, public 재저장을 막기 위해 `products_private`에 임시 격리한다. 영업자·고객 데이터에서는 제거된다.
- 신규 감사로그는 `sender_email`, `business_no`, 고객 생년월일·사업자번호, 계좌·첨부·서명 URL과 중첩 객체의 민감값까지 `***`로 마스킹한다.
- 기존 감사로그 정리 스크립트도 같은 민감 필드 목록과 중첩 마스킹을 사용하도록 맞췄다. 실제 `--apply`는 실행하지 않았다.

## 브라우저 검수 상태

Chrome에서 `https://freepasserp4.vercel.app/` 운영 탭 존재는 확인했지만 탭 제어권 연결이 두 차례 응답하지 않아 DOM·스크린샷 대조는 완료하지 못했다. 따라서 이 문서의 화면 소비 판정은 코드 경로와 운영 필드 통계 근거이며, 브라우저에서 직접 확인했다고 간주하지 않는다.

## 사업자등록번호 alias 읽기 통일 2차

- 저장 필드명이나 운영 데이터를 바꾸지 않고, 역할별 기존 정본을 우선하는 공통 읽기 경계 `lib/domain/business-identity.ts`를 추가했다.
- 우선순위는 partner=`business_number`, user/customer=`business_no`, contract=`customer_business_number`이며, 정본이 비었을 때만 과거 alias를 fallback으로 읽는다.
- 로그인 사업자 매칭, 가입 승인 신원 파생, 회원 중복 확인·상세 표시, 계약서 공급사 사업자번호 주입이 같은 reader를 사용한다.
- 여러 alias가 포맷 차이가 아닌 서로 다른 숫자값을 가지면 `conflict=true`로 판별한다. 현재는 기존 정본을 우선해 읽을 뿐 자동 수정·로그인 차단·데이터 이관을 하지 않는다.
- `scripts/audit-business-identity.mts`는 v3+v4를 읽기 전용으로 병합해 정본 누락 fallback, alias 충돌, 10자리 형식 오류 건수만 출력하고 값과 레코드 식별자는 출력하지 않는다.
- 이 검증 환경에는 Firebase 관리자 자격증명이 없어 운영 건수 집계는 미실행이다. 자격증명을 갖춘 배포 전 게이트에서 감사기를 실행해 충돌 0 또는 개별 판정 완료를 확인해야 한다.
