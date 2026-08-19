# ERP5 내부코드 규격

## 원칙

- Firebase Auth `uid`는 인증·RTDB 사용자 저장키로 유지하며 절대 재발급하지 않는다.
- 업무 엔티티는 의미를 담지 않은 `접두사_10자 토큰`을 영구 ID로 쓴다.
- 계약번호처럼 사람이 읽는 번호는 내부 ID와 별도 필드로 저장한다.
- 기존 `RP030`, `TMP-*`, `ST_*`, `CH_*`, `CS_*` 코드는 삭제하거나 즉시 치환하지 않고 별칭으로 조회한다.
- 신규 생성분부터 표준코드를 발급한다. 기존 데이터 일괄 변경은 별도 dry-run·실데이터 검증·사람 승인 후 시행한다.

## 접두사

| 영역 | 접두사 | 대표 필드 |
|---|---:|---|
| 조직·사용자 | `org_`, `usr_` | `org_id`, `user_code` |
| 공급사·정책·차량·채널 | `sup_`, `pol_`, `veh_`, `chn_` | 각 `*_code` |
| 고객·문의·채팅 | `cus_`, `inq_`, `rom_`, `msg_` | 각 `*_code` |
| 견적·계약·전자서명 | `quo_`, `con_`, `esg_`, `tpl_` | 각 `*_code` 또는 `esign_id` |
| 정산·수납 | `stl_`, `pay_` | `settlement_code`, `payment_code` |
| 문서·첨부 | `doc_`, `att_` | `document_code`, `attachment_code` |
| 운영 | `rpt_`, `aud_`, `run_` | 제보·감사·동기화 실행 ID |

## 현재 적용 범위

- 회원 신규 발급: Firebase `uid`와 별개로 `usr_` 발급
- 회원·공급사·정책 수동 신규 등록: 각각 `usr_`, `sup_`, `pol_`
- 채팅: 신규 방 `rom_`, 문의건 `inq_`, 메시지 `msg_`; 동일 차량×사용자는 결정키로 중복 생성 방지
- 계약: `con_`과 별도 `contract_number`(`FP-C-YYYYMMDD-*`)
- 전자서명 발행: 내부 `esg_`; 고객 공개 링크의 `fps_` 보안 토큰은 변경하지 않음
- 정산: 신규 `con_` 계약은 `canonical_code=stl_`를 발급하되 현재 Rules 호환용 저장키·`settlement_code=ST_{계약코드}`를 유지한다. Rules 실데이터 게이트 후 저장키 전환
- 제보·감사·동기화 실행: `rpt_`, `aud_`, `run_`
- 조회: 표준코드, 저장키, `legacy_*`, `legacy_codes`, `code_aliases`를 모두 허용

## 이행 순서

1. 신규 발급기를 표준화한다.
2. 운영 데이터는 읽기 전용 감사로 `canonical / legacy / missing`을 분류한다.
3. 기존 레코드에 신규코드와 기존코드 별칭을 병기하는 migration plan을 생성한다.
4. 계약·정산·차량 참조 정합성과 Firebase Rules를 실데이터로 검증한다.
5. 사람 또는 Claude 위험영역 게이트 승인 후 v4 overlay에만 반영한다.

`database.rules.json`, v3 운영 노드, Firebase Auth UID는 이 코드 전환 작업에서 변경하지 않는다.
