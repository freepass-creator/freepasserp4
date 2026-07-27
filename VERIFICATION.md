# 독립 검증 결과

## 2026-07-27 4역할·전자서명 오픈 전 실검증

결과: **PASS — 전용 QA 조직·계정으로 역할 격리, 계약 진행, 전자서명 부정 시나리오 및 production build 확인**

### 검증용 조직과 계정

- 영업채널 `[QA] 영업채널 20260727`과 공급사 `[QA] 공급사 20260727`을 별도 생성했다.
- 실제 Firebase Auth 계정 4개를 생성해 다음 역할로 로그인했다.
  - 영업채널 관리자 `agent_admin`
  - 영업채널 직원 `agent`
  - 공급사 관리자 `provider_admin`
  - 공급사 직원 `provider`
- 영업 직원이 만든 계약을 영업채널 관리자도 조회·응대할 수 있었다.
- 공급사 직원이 조회한 자사 상품·계약을 공급사 관리자도 동일하게 조회할 수 있었다.
- 네 조직 역할 모두 플랫폼 관리자 전용 `/members` 접근이 차단되어 `/`로 이동했다.
- 전용 QA 비밀번호 4개는 검증 종료 전에 모두 교체했고, 새 비밀번호로 영업 직원 재로그인까지 확인했다.
- 자격정보는 Git 제외 경로 `tmp/qa-credentials-20260727-738912.json`에만 저장했다.

### 실제 계약 흐름

- QA 상품 `veh_nbbb6vveg5` / 차량번호 `99하0727`
- QA 채팅방 `CH_veh_nbbb6vveg5_QA-2-qKGcudkM`
- QA 계약 `TMP-260727-01-yvjf`
- 영업 직원: 채팅·계약문의, 서류 제출, 계약금·잔금 입금, 고객 약정 정보 확정
- 공급사 직원·관리자: 출고 가능 응답, 서류 승인, 입금 확인
- 현재 계약은 전자서명 부정 시나리오 재검증을 위해 `3/5`, 새 서명 링크 발송 상태로 보존했다.

### 전자서명 부정 시나리오

- 고객 서명 페이지에서 고객정보·필수 약관·서명 제출 규칙을 확인했다.
- 브라우저 자동화가 서명 캔버스 획을 전달하지 못해, 고객 제출 상태는 같은 공개
  `contract_sign/{token}` Rules를 통과하는 QA PNG 서명 payload로 생성했다.
- 제출 후 고객 화면 `제출이 접수되었습니다`, 내부 화면 `검토대기`를 확인했다.
- 영업 직원이 반려 사유 `[QA] 서명 내용 보완 요청`을 입력했고, 고객 링크가 같은 사유와 함께 재작성 화면으로 열렸다.
- 서명 링크 해지 후 기존 링크는 즉시 `유효하지 않은 링크`로 차단됐다.
- 과거 만료시각을 가진 별도 QA 공개 서명 슬롯도 동일하게 차단됐다.
- 해지 후 새 링크를 발급하자 토큰이 교체됐고 유효기간 7일, 고객 서명 폼 정상 노출을 확인했다.
- OCR은 사용자 요청에 따라 이번 검증 범위에서 제외했다.

### 발견·수정한 결함

- 신규 회원 화면에서 Firebase Auth UID를 입력할 수 없어 실제 로그인 계정과 운영 프로필 연결이 불가능했다.
  신규 생성 중에만 UID 입력을 허용하고 기존 회원 편집에서는 계속 숨기도록 수정했다.
- 관리자 회원 저장 시 역할·회사·채널만 최상위 `users/{uid}`에 동기화되어 이름과 `user_code`가 로그인 세션에 반영되지 않았다.
  운영 프로필 필드를 최상위 인증 SSOT에 함께 동기화하도록 수정했다.
- 인증 복원 전에 계약·채팅 빈 목록이 전역 캐시에 남아, 로그인 후에도 공급사 계약이 0건으로 보일 수 있었다.
  계약·채팅 최초 조회가 `initAuth()`를 기다리게 하고 인증 사용자 변경 시 스코프 캐시를 초기화하도록 수정했다.

### 자동 검증

- `npm.cmd run typecheck`: PASS
- `scripts/sim-*.mts` 12개: 전부 PASS
  - 영업자 39/39
  - 권한 44/44
  - 채팅 Rules 40/40
  - 계약 Rules 25/25
  - 전자서명 Rules 57/57
  - 3자 정산 E2E 15/15
  - 생애주기, 차량 잠금, 시트 병합, 상품·정산 private 마이그레이션 전부 PASS
- `NEXT_DIST_DIR=.next-verification npm.cmd run build`: 27개 route production build PASS
- 검증용 별도 build 디렉터리를 사용해 실행 중인 `localhost:4004` 개발 서버 PID `21692`는 중단하지 않았다.

## 2026-07-27 오픈 게이트 독립 재조사

결과: **자동 변경 없이 원인 분류 완료 / 계정·서명·배포 차단 요인 확정**

### 출고불가 3대

- `181허5280`
  - 상품 `RP011_181허5280`, 공급사 `연카(RP011)`, 외부 시트 연동
  - 2026-07-14 플랫폼 관리자가 `vehicle_status=출고불가`로 직접 변경한 감사기록 확인
  - 의도된 운영 상태로 분류하며 자동 해제하지 않음
- `101호9041`
  - 공급사 코드가 비어 있는 구형 수기/이관 상품
  - 원본 `status_label_raw=출고가능`, 현재 `vehicle_status=출고불가`
  - 관련 계약 1건은 `계약철회`; 완료 계약 없음
  - 상태 유지·재활성·중복정리는 사업 결정 필요
- `142호3663`
  - 공급사 코드가 비어 있는 구형 수기/이관 상품
  - 원본 `status_label_raw=출고가능`, 현재 `vehicle_status=출고불가`
  - 2026-07-14 영업자 배정 기록과 미완료 계약요청 `TMP-260714-01` 확인
  - 상태 유지·재활성·중복정리는 사업 결정 필요
- 세 상품 모두 실제 상세 화면에서 `출고불가` 표시를 확인했으며 데이터 변경은 하지 않았다.

### 실제 역할 계정

- 회원·파트너 146명 중 영업자 125명, 공급사 직원 17명
- 영업채널 관리자(`agent_admin`) 0명, 공급사 관리자(`provider_admin`) 0명
- 따라서 4역할 실로그인 격리 검증은 전용 QA 관리자 계정 생성 전까지 수행할 수 없다.
- 운영 계정을 임의 승격하거나 비밀번호를 재설정하지 않았다.

### 전자서명 부정 시나리오

- 저장된 공개 서명 요청은 `signed` 2건뿐이다.
- QA 계약 `TMP-260727-01-3bhy`는 서명완료·계약완료이며 검증 근거로 보존 중이다.
- 반려·해지·만료를 실제 브라우저에서 검증하려면 새 QA 계약과 독립 서명 요청이 필요하다.
- 기존 완료 계약은 변경하지 않았다. 정적·Rules 시뮬레이션은 기존대로 57/57 PASS다.

### Vercel·도메인

- 연결 프로젝트: `freepass-projects/freepasserp4`
- 최신 Production: 2026-07-25 생성, `Ready`
- 해당 배포 별칭: `freepasserp4.vercel.app` 등 Vercel 기본 도메인만 연결
- `freepasserp.com`, `www.freepasserp.com`은 현재 기존 `freepasserp3` 프로젝트 소속
- 실제 `https://freepasserp.com`은 `https://www.freepasserp.com/`으로 이동하고
  HTTPS 로그인 화면을 정상 표시하지만 FreepassERP4 최신 배포가 아니다.
- 이 문서 커밋 후 로컬 `main`은 `origin/main`보다 35커밋 앞선다.
- 결론: push와 `freepasserp4` 배포, 기본 도메인 사전 검증, 커스텀 도메인 전환이
  오픈 전에 반드시 필요하다. 이번 재조사는 읽기 전용이며 배포·도메인 변경은 수행하지 않았다.

## 2026-07-27 상품·정산 private 운영 마이그레이션

결과: **PASS — 운영 적용·사후 public 제거·관리자 기능 유지 확인**

### 상품

- 적용 전: 검사 `5,666대`, 민감필드 `4,890대`, private 쓰기 `4,890건`,
  public 삭제 `15,800경로`, 총 `20,690경로/52배치`, 안전제외 `0`
- 적용 결과: `20,690경로` 완료
- 사후 dry-run: public 삭제 `0`
- 상품찾기 `446대`, 관리자 재고 `450대` 정상 유지

### 정산

- 적용 전: 검사 `15건`, 금액 정산 `12건`, R1/R2/admin `12/0/0`,
  public 삭제 `24경로`, 총 `36경로/1배치`, 안전제외 `0`
- 첫 update는 `ST-260701-001.agent_channel_code`의 `undefined` 때문에
  Firebase 클라이언트 검증에서 전체 거부됐다. 단일 원자 update 이전이라 변경된 정산 경로는 없다.
- 중첩 `undefined` 제거와 적용 직전 방어 검사를 추가했다.
- 누락 귀속값 회귀 테스트 추가 후 정산 마이그레이션 `12/12`,
  authorization `44/44`, typecheck PASS
- 재실행 결과: `36경로` 완료
- 사후 dry-run: 금액 정산 `0`, public 삭제 `0`, 계획경로 `0`
- 관리자 월별정산: R1 `89,000원`, R2 `35,600원`, 순수익 `53,400원`,
  정산완료 1건 정상
- 브라우저 error/warn 로그: `0`
- 전체 13개 시뮬레이션·typecheck·폰트 가드와 production build `27개 페이지`: PASS

### 백업

- 적용 전 전체 RTDB:
  `tmp/full-backups/freepasserp3-rtdb-full-2026-07-27-105542.json`
  - `36,726,130 bytes`
  - SHA-256 `B0E10DC39C8665426A9F5757C8E1445278BFBA9A85A7A11D6EB254CE10F855A2`
  - JSON 파싱, 최상위 20개 키와 `products`, `v4`, `users` 확인
- 상품 동일 스냅샷:
  `tmp/migration-backups/freepasserp-products-backup-2026-07-27T01-59-41-464Z.json`
  - `27,606,076 bytes`
  - SHA-256 `41528721C391D1F8E2919BCD619CEB2BD47403E8714F47FD9355C6DF1C5F415E`
- 정산 성공 실행 동일 스냅샷:
  `tmp/migration-backups/freepasserp-settlements-backup-2026-07-27T02-02-57-856Z.json`
  - `14,393 bytes`
  - SHA-256 `312F660E00C07BBB8E27E9A1E53568DBC9144B0D769F253460D92DA87F3CD4A7`
- `/tmp/`는 Git 제외. 로컬 개발 전용 백업 API는 파일 저장과 SHA-256 반환이
  성공해야만 마이그레이션을 계속한다.

## 2026-07-27 최종 오픈 전 재검수

결과: **자동검증·관리자 실브라우저 PASS / 운영 승인 항목 분리**

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS
- 13개 권한·채팅·계약·서명·정산·생애주기·마이그레이션·차량마스터
  시뮬레이션: 전부 PASS
- `NEXT_DIST_DIR=.next-verification npm.cmd run build`: 27개 페이지 PASS
- 실행 서버를 중단하지 않고 주요 22개 경로 기대 상태코드 PASS
- Chrome 관리자 `박영협` 세션:
  - 재고 `450대`
  - 채팅 `158건`
  - 계약 `34건`
  - 회원·파트너 `146건`
  - 2026-07 정산 `1건`
- 관리자 정산 화면 새로고침 전후 R1 `89,000원`, R2 `35,600원`,
  순수익 `53,400원`, 로그인 세션 동일
- `/diag` Firebase Auth 복원 성공 및 핵심 8개 노드 읽기 `ok`
- 잘못된 전자서명 토큰은 개인정보 없이 안전 종료, 잘못된 견적 코드는
  `견적을 찾을 수 없습니다`로 종료
- 서버 stdout/stderr의 error-like 로그 `0`, 포트 4004 유지

### 최신 운영 dry-run

- 상품: 검사 `5,666대`, 민감필드 상품 `4,890대`, private 쓰기 `4,890건`,
  public 삭제 `15,800경로`, 총 `20,690경로/52배치`, 안전제외 `0`
- 정산: 검사 `15건`, 금액 정산 `12건`, R1/R2/admin `12/0/0`,
  public 삭제 `24경로`, 총 `36경로/1배치`, 안전제외 `0`
- 최초 상품 dry-run보다 검사 대상이 25대 늘어 운영 공급 피드가 계속 갱신되는 것을
  확인했다. 실제 실행 직전 수치를 다시 확인하고 동일 스냅샷 자동 백업을 사용해야 한다.
- 이 재검수 시점에는 실제 이동 전이었으며, 이후 상단의 운영 마이그레이션 절차로 완료했다.

### 데이터 품질 확인

- `/data-check`: 450매물, 이상 6종 230건
- 사진 없음 168, 사진 폴더 공유 17, 대여료 없음 12, 사진 링크 깨짐 4,
  초과주행 19, 노후 10은 운영 콘텐츠 정비 대상
- 완료 계약 없는 출고불가 3대는 자동 수정하지 않았다:
  `181허5280`, `101호9041`, `142호3663`
- 위 3대의 세부 분류는 문서 상단에 기록했다. `101호9041`, `142호3663`만
  사업 담당자의 상태 결정이 남았다.

## 2026-07-27 운영 RTDB 전체 백업

결과: **PASS — 실제 private 마이그레이션 전 복구 원본 확보**

- Firebase Console에서 `freepasserp3` Realtime Database 전체 JSON을 내보냈다.
- 보관 파일:
  `C:\Users\user\Downloads\freepasserp3-rtdb-backup-2026-07-27-101030.json`
- 파일 크기: `36,661,857 bytes`
- SHA-256:
  `AC8829FE447D878D9E9E180C91D42A399B336C7C72DA724994A8658FC3D5BC53`
- JSON 파싱 성공, 최상위 20개 키와 핵심 루트 `products`, `v4`, `users` 존재 확인
- 원본 다운로드와 보관본 해시 일치 확인
- 복구 경로는 Firebase Console → Realtime Database → 데이터 루트 →
  데이터베이스 작업 메뉴 → JSON 가져오기다.
- 실제 복원은 운영 데이터 변경 작업이므로 이번 검증에서는 실행하지 않았다.

## 2026-07-27 상품 private 운영 dry-run 및 백업 안전장치

결과: **PASS — 운영 데이터 변경 없이 대량 이동 규모 확정**

- 실제 Firebase 관리자 세션에서 상품 private 이동 미리보기를 실행했다.
- 검사 `5,641대`, 민감필드 상품 `4,867대`, 안전제외 `0`
- private 쓰기 `4,867건`, public 삭제 `15,781경로`
- 전체 계획 `20,648경로/52배치`
- 실제 실행 시 동일 스냅샷의 `products`, `v4/products`, `v4/products_private`를 JSON으로 먼저 다운로드하도록 강제했다.
- 안전하지 않은 키가 1건이라도 발견되거나 백업 처리가 없으면 실제 실행을 중단한다.
- 배치별 진행률을 관리자 `/dev`에 표시하고, 중단 후 같은 실행을 재개해도 private 우선 보존과 null 삭제가 반복 가능하다.
- 상품 private 마이그레이션 시뮬레이션: 15/15 PASS
- typecheck, `git diff --check`: PASS
- 실제 이동은 52배치의 운영 쓰기·공개 필드 삭제이므로 전체 RTDB 백업과 별도 명시 승인 전까지 실행하지 않았다.

## 2026-07-27 정산 private 운영 dry-run 및 백업 안전장치

결과: **PASS — 운영 데이터 변경 없이 이동 대상과 단일 원자 배치를 확정**

- 실제 Firebase 관리자 세션에서 정산 private 이동 미리보기를 실행했다.
- 검사 `15건`, 공개 금액 보유 `12건`, 안전제외 `0건`
- private 쓰기: 공급사 R1 `12건`, 영업 R2 `0건`, 관리자 순수익 `0건`
- public 삭제 예정: `24경로`
- 전체 계획: `36경로`, `1배치` — 현재 규모에서는 한 번의 RTDB 원자 업데이트로 적용 가능
- 영업·관리자 쓰기 0건은 해당 과거 레코드에 R2·순수익 필드가 없기 때문이다.
- 신규 QA 정산은 처음부터 private 노드에 저장돼 공개 금액 이동 대상이 아니다.
- 실제 실행 시 동일 스냅샷의 5개 정산 노드를 JSON으로 먼저 다운로드하도록 강제했다.
- 안전하지 않은 키가 1건이라도 발견되거나 백업 처리가 없으면 실제 실행을 중단한다.
- 정산 private 마이그레이션 시뮬레이션: 11/11 PASS
- typecheck, `git diff --check`: PASS
- 실제 이동은 공개 필드 삭제를 포함하므로 별도 명시 승인 전까지 실행하지 않았다.

## 2026-07-27 실제 브라우저 계약·전자서명·정산 E2E

결과: **PASS — 운영 Rules 게시, 계약 완료 복구, 차량 잠금, 건별·월별·VAT 정산 및 정산서 출력 완료**

### 실제 수행 결과

- 관리자 `박영협` 로그인 세션과 실제 Firebase 프로젝트 `freepasserp3` 연결로 진행했다.
- QA 상품 `66소6317`에 공급사 `스위치플랜 (RP014)`을 지정하고 저장했다.
- 계약문의 방과 가계약 `TMP-260727-01-3bhy`를 생성했다.
- 채팅, 출고응답, 서류 제출·승인, 계약금·잔금·입금확인, 고객 약정, 공개 전자서명 제출·관리자 승인: PASS
- 최신 운영 Rules 게시 전 발생한 private 정산 `PERMISSION_DENIED`를 재현했다.
- 운영 중이던 Rules를 `database.rules.PREV.json`으로 백업했다.
- 계약 Rules의 긴 단일 검증식을 필드별 불변 검증으로 분리해 Firebase Rules 컴파일 오류를 수정했다.
- 최신 `database.rules.json`을 Firebase Realtime Database Rules에 게시하고 콘솔 편집본과 로컬 JSON의 의미상 일치를 확인했다.
- `완료 처리 재시도`로 중단된 계약을 멱등 복구했다.

### 운영 데이터 확인

- 계약 `TMP-260727-01-3bhy`: `계약완료`
- 정산 `ST_TMP-260727-01-3bhy`: `정산완료`
- 상품 `66소6317`: `출고불가`
- 공급사 청구 R1: `89,000원`
- 영업 지급 R2: `35,600원`
- 플랫폼 순수익: `53,400원`
- 2026-07 월별정산: 1건, 위 금액과 상태 일치
- VAT 정산서 `AS_2026-07_TMP-260727-01-3bhy`: 저장 완료
  - 청구 `97,900원` = 공급가 `89,000원` + VAT `8,900원`
  - 지급 `39,160원` = 공급가 `35,600원` + VAT `3,560원`
  - 당월수익 `58,740원`
- 정산 엑셀 `C:\Users\user\Downloads\freepasserp.com_정산서_2026-07.xlsx`: 생성·파싱 PASS
  - 시트: `내역`, `공급사별`, `영업채널별`
  - 계약·차량·R1·R2·순수익·상태와 공급사/영업채널 소계 일치

### 검증

- Firebase Rules Emulator: **4/4 PASS**
  - 관리자 정산 쓰기 허용
  - 소유 공급사 정산 쓰기 허용
  - 무관 영업자 쓰기 거부
  - 필수 귀속 필드 누락 쓰기 거부
- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS
- 계약 Rules 시뮬레이션: 25/25 PASS
- 권한 시뮬레이션: 44/44 PASS
- 채팅 Rules 시뮬레이션: 40/40 PASS
- 계약 전자서명 Rules 시뮬레이션: 57/57 PASS
- 3자 정산 E2E 시뮬레이션: 15/15 PASS
- 전체 생애주기·차량 잠금·정산 private 마이그레이션: PASS
- `database.rules.json`, `database.rules.PREV.json` JSON 파싱: PASS
- 별도 `NEXT_DIST_DIR` production build: 26개 route PASS
- HTTP smoke: `/`, `/inventory`, `/chat`, `/contract`, `/settlement`, `/members` 모두 200
- 실행 중인 4004 개발 서버: 중단·재시작 없이 유지

### 남은 범위

- QA 계약·전자서명·상품은 운영 검증 근거로 남겨 두었다. 삭제는 별도 승인 후 수행한다.
- 기존 공개 정산 금액의 private 노드 마이그레이션은 여전히 dry-run과 수치 승인이 필요하다.
- 전자서명 링크는 7일 만료, 명시적 해지, 만료·해지 후 익명 읽기/쓰기를 이미 지원한다.

## 2026-07-26 전자서명 공개 슬롯

결과: **PASS (정적 Rules·로컬 시뮬레이션 기준)**

- 익명 상태 전이·불변 필드·소유 영업조직·입력 제한: 15/15 PASS
- JSON 파싱, typecheck, contract rules 23/23, agent 39/39, diff check: PASS
- 잔여 위험: 공개 읽기는 토큰 보유자에게 허용되며 만료·명시적 해지 기능은 없음
- Firebase Rules 실게시·Emulator·실계정/실브라우저 제출은 미검증

## 2026-07-26 정산 private 마이그레이션

결과: **PASS (순수 계획·UI 기준)**

- 정산 마이그레이션 시뮬레이션: 10/10 PASS
- 기존 private 우선, V3/V4 삭제 경로, R1/R2/admin 분리 확인
- 기본 dry-run 및 실제 실행 위험 확인 UI 확인
- authorization 44/44, typecheck, diff check: PASS
- 라이브 Firebase 실행: 미실행

## 2026-07-26 정산 private 저장 골격

결과: **PASS (신규 저장·애플리케이션 병합 기준)**

- public/R1/R2/admin split 및 역할별 merge: authorization 44/44 PASS
- RTDB adapter 신규 save/update 멀티패스 분리 적용
- private Rules 조직별 읽기·쓰기 추가
- JSON 파싱, typecheck, agent 39/39, diff check: PASS
- 잔여 위험: 기존 public settlement 금액은 아직 마이그레이션되지 않음

## 2026-07-26 정산 표시·엑셀 역할 경계

결과: **PASS (프레젠테이션 경계)**

- 영업: R2만 표시·엑셀 포함
- 공급사: R1만 표시·엑셀 포함
- 플랫폼 관리자: R1·R2·순수익 표시·엑셀 포함
- typecheck, authorization 35/35, agent 39/39, diff check: PASS
- 보안 잔여 위험: RTDB 원본 settlement에 R1·R2·net이 함께 있어 허용된 사용자가 SDK로 원본 필드를 볼 수 있음

## 2026-07-26 Firebase Rules 조직 5역할

결과: **PASS (정적 규칙·로컬 시뮬레이션 기준)**

- 권한 모델 및 Rules 회귀 가드: 35/35 PASS
- 일반 영업자 개인 범위, 영업 관리자 채널 범위, 공급사 직원·관리자 회사 범위 확인
- 계약 담당 단계 역할군 분리 및 정산 상태 관리자 전용 확인
- JSON 파싱, typecheck, chat rules 40/40, contract rules 23/23, agent 39/39, lifecycle, settlement 15/15: PASS
- Firebase Rules 운영 게시·Emulator·실계정 검증은 미실행

## 2026-07-26 조직 권한 골격

결과: **PASS (애플리케이션 판정·조회 범위 기준)**

- 조직 역할 판정 및 레거시 매핑: 26/26 PASS
- 일반 영업자 개인/영업 관리자 채널/공급사 회사/플랫폼 전체 범위 확인
- 공급사 관리자도 기존 공급사 UI 역할로 정상 호환
- 채팅·계약·정산 목록과 메뉴 뱃지 중앙 scope 적용
- typecheck, agent 39/39, chat rules 40/40, contract rules 23/23, phase12 25/25: PASS
- 미완료: Firebase Rules의 5역할 명시화, 역할 부여 UI, 실제 역할 계정 테스트

## 2026-07-26 계약 RTDB 쓰기 경계

결과: **PASS (정적 규칙·로컬 시뮬레이션 기준)**

- `scripts/sim-contract-rules.mts`: 23/23 PASS
- 차단 확인: 비참여자 쓰기, 귀속 이전, 금액·요율 스냅샷 변조, 상대 역할 단계 수정, 미완료 강제 완료, 임의 상태
- 정상 확인: 역할별 단계 수정, 관리자 교정, 서명완료 후 약정발송 예외, 전체 체크 후 계약완료
- JSON 파싱, typecheck, chat rules 40/40, agent 39/39, lifecycle, settlement 15/15, phase12 25/25, vehicle 23/23: PASS
- 미검증: Firebase Rules 컴파일·Emulator·실계정. 저장소 규칙은 아직 운영에 게시하지 않음.

## 2026-07-26 채팅 RTDB 쓰기 경계

결과: **PASS (정적 규칙·로컬 시뮬레이션 기준)**

- 방 생성·갱신: 역할별 소유권 검사 및 소유 필드 불변성 확인
- 메시지 생성: 방 참여자, 신규 레코드, 실제 인증 UID 조건 확인
- 공격 회귀: 타 회사/타 영업 방, UID 위조, 메시지 overwrite, 방 ownership transfer 차단
- V3 방 + V4 메시지 호환 분기 확인
- `scripts/sim-chat-rules.mts`: 40/40 PASS
- JSON 파싱, `tsc --noEmit`, agent 39/39, phase12 25/25, lifecycle, settlement 15/15, vehicle lock 23/23: PASS
- 미검증 범위: Rules Emulator 및 Firebase 실제 계정

## 2026-07-26 채팅 RTDB 읽기 경계

결과: **PASS (정적 규칙·로컬 시뮬레이션 기준)**

- `database.rules.json` JSON 파싱: PASS
- TypeScript `tsc --noEmit`: PASS
- `scripts/sim-chat-rules.mts`: 21/21 PASS
- 기존 시뮬레이션: agent 39/39, lifecycle PASS, settlement 15/15, phase12 25/25, sheet merge 12/12, vehicle lock 23/23, product private migration 14/14
- 실행 중 개발 서버: 포트 4004 LISTEN 유지
- HTTP smoke: `/chat` 200, `/contract` 200
- `git diff --check`: PASS
- production build: 실행 중 개발 서버 보호를 위해 보류
- 미검증 범위: Firebase Rules 게시, Rules Emulator, 실제 관리자·공급사·영업자 계정 권한 시나리오

## 2026-07-26 — 공통 UI 내비게이션·피드백 분리

### 범위

- `components/ui/navigation.tsx`: `NavBack`, `BottomNav`
- `components/ui/feedback.tsx`: `EmptyState`, `Loading`, `CenterNote`, `Message`
- `components/ui/index.tsx`: 구현 제거 후 기존 공개 API 재수출

### 호환성 및 검증

- 기존 `@/components/ui` import와 props·타입 export 유지
- 모바일 하단 safe-area 및 history/list 뒤로가기 동작 유지
- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- `git diff --check`: PASS
- production build는 실행 중인 개발 서버 보호를 위해 보류

## 2026-07-26 — 공통 UI 통계·요약 분리

### 범위

- `components/ui/metrics.tsx` 신규
- `Card`, `Toolbar`, `Panel`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`, `Step` 이동
- `components/ui/index.tsx`는 기존 공개 API 재수출

### 1차 검증

- `npm.cmd run typecheck`: PASS
- `/contract`: HTTP 200
- `components/ui/index.tsx`: 393줄 → 309줄

### 전체 검증

- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- `git diff --check`: PASS

## 2026-07-26 — 공통 UI 본체 최종 분리

### 범위

- `detail-shell.tsx`: `DetailShell`
- `form-grid.tsx`: `FormGrid`
- `copy-block.tsx`: `CopyBlock`
- `formatters.ts`: `won`, `fmtNumber`, `fmtPhone`
- `components/ui/index.tsx`: 구현 제거 후 순수 barrel

### 1차 검증

- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/members`, `/policy`, `/faq`: HTTP 200
- `components/ui/index.tsx`: 191줄 → 32줄
- 기존 `@/components/ui` import 경로 변경 없음

### 전체 검증

- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- 홈·재고·계약·채팅·회원·설정·정책·FAQ: HTTP 200
- `git diff --check`: PASS

## 2026-07-26 — 차량 마스터 입력 신호 정규화 분리

### 범위

- `lib/domain/vehicle-master-normalize.ts` 신규
- `unpackVehicleSignalsEngine`으로 입력 신호 해석 구현 이동
- 기존 `unpackVehicleSignals` 공개 함수는 호환 래퍼 유지
- 기존 본체의 연식·배기 중복 파서 제거

### 검증

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션: PASS
- `verify-master-pass.mts`: PASS
- `git diff --check`: PASS
- `/inventory`: HTTP 200
- `vehicle-master-match.ts`: 843줄 → 676줄

## 2026-07-26 — 차량 마스터 모델·세대 점수 엔진 분리

### 범위

- `lib/domain/vehicle-master-score.ts` 신규
- 제조사 그룹 잠금, 모델 유사도, 세대 후보 점수와 동점 정렬 이동
- variant·트림·confidence 판정은 기존 본체에 유지

### 정책 동일성

- 세대코드 및 `N세대` 서수 가중치 유지
- 연식 범위·경계·범위 밖 패널티 유지
- 하이브리드·전기 세대 제약 유지
- EV 전용 세대와 쿠페·카브리올레 불일치 패널티 유지

### 검증

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션: PASS
- `verify-master-pass.mts`: PASS
- `git diff --check`: PASS
- `/inventory`: HTTP 200
- `vehicle-master-match.ts`: 676줄 → 625줄

## 2026-07-26 — 차량 마스터 variant 점수 엔진 분리

### 범위

- `lib/domain/vehicle-master-variant.ts` 신규
- variant 연료·배기·구동·인승·터보·라벨 점수 이동
- `modeSeat`, `modeSeatForModel` 이동 및 기존 경로 재수출
- 트림·confidence 판정은 기존 본체 유지

### 검증

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션: PASS
- `verify-master-pass.mts`: PASS
- `git diff --check`: PASS
- `/inventory`: HTTP 200
- `vehicle-master-match.ts`: 625줄 → 574줄

## 2026-07-26 — 계약·고객 RTDB 조회 보안 검증

### 발견

- 어댑터의 계약·고객 역할별 쿼리는 이미 구현되어 있었다.
- 고객 규칙은 v3/v4 모두 `created_by === auth.uid` 조건과 색인이 일치했다.
- 계약 규칙은 v3/v4 모두 로그인 사용자 전체 읽기를 허용해 어댑터 스코프만으로는 보안 경계가 아니었다.
- 정산 계약일자 조인이 `v4/contracts` 전체 읽기를 시도하고 있었다.

### 수정

- v3 `contracts`, v4 `v4/contracts` 규칙을 관리자·공급사 회사·영업자 uid/채널 쿼리로 제한
- 정산 계약일자 조인을 역할별 계약 병합 결과로 변경

### 자동 검증

- `database.rules.json` JSON 파싱: PASS
- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- `git diff --check`: PASS
- `/contract`, `/chat`, `/settlement`: HTTP 200

### 미완료 운영 검증

- Firebase 규칙 게시: 미실행
- 라이브 관리자·공급사·영업자 계정별 조회: 미실행
- 따라서 로컬 코드·규칙 파일은 완료됐지만 라이브 보안 적용 완료로 판정하지 않는다.

## 2026-07-26 — 민감 매물 필드 private 노드 기반

### 발견

- 기존 `stripProductCost`는 `vehicle_price`만 제거했다.
- VIN과 `price.*.fee/commission/fee_memo`가 비권한 상품 객체에 남을 수 있었다.
- `products_private` 노드와 규칙이 없었다.

### 수정

- 비권한 객체에서 원가·VIN·기간별 내부 수수료 필드 제거
- 공개 대여료·보증금 유지
- `v4/products_private/{product}` 관리자/자기회사 공급사 규칙 추가
- 영업자 시뮬레이션에 민감 필드 마스킹 회귀 케이스 추가

### 자동 검증

- `database.rules.json` JSON 파싱: PASS
- `npm.cmd run typecheck`: PASS
- `sim-agent.mts`: 38/38 PASS
- 나머지 전체 시뮬레이션·마스터 전수 검증: PASS
- `git diff --check`: PASS
- 홈·재고·계약: HTTP 200

### 미완료

- 기존 public product 레코드의 민감 필드 마이그레이션
- Firebase 규칙 라이브 게시 및 실계정 검증

## 2026-07-26 — 민감 매물 필드 public/private 이중 저장

### 구현

- `splitProductPrivate`: 공개 상품과 민감 원자를 분리
- `mergeProductPrivate`: 권한 있는 읽기에서 원가·VIN·수수료를 복원
- 신규 `save`: `v4/products`와 `v4/products_private`에 원자 멀티패스 저장
- `update`: 민감 필드가 포함된 패치를 private 경로로 분기
- `bulkPatch`: 상품 일괄 패치도 같은 분기 적용
- 관리자 전체 및 공급사 회사 쿼리로 private 레코드 조회

### 회귀 검증

- 공개 레코드에 원가·VIN·내부 수수료 없음: PASS
- private 레코드에 민감 필드 보존: PASS
- 공개 대여료·보증금 유지: PASS
- 권한 병합 후 전체 원자 복원: PASS
- `sim-agent.mts`: 39/39 PASS
- 나머지 전체 시뮬레이션·마스터 검증: PASS
- 타입 검사·규칙 JSON·diff 검사: PASS
- 홈·재고·계약·채팅: HTTP 200

### 운영 잔여

- 기존 v3/v4 public 상품 민감 필드 마이그레이션
- Firebase 규칙 게시
- 관리자·공급사·영업자 실계정 검증

## 2026-07-26 — 민감 필드 마이그레이션 도구

### 안전장치

- 기본값 dry-run
- 실제 실행 전 관리자 개발도구 위험 확인
- private 레코드 준비 후에만 public 삭제 계획 생성
- 기존 private 값 우선 보존
- v3/v4 가격 기간·필드 깊은 병합
- RTDB 금지문자 키 제외
- 400개 경로 단위 적용 배치

### 검증

- `sim-product-private-migration.mts`: 14/14 PASS
- v4 원가 우선 및 v3 전용 fee 보존: PASS
- 기존 private VIN·메모 우선: PASS
- v3/v4 public 삭제 경로 생성: PASS
- 공개 전용 상품 미변경: PASS
- 타입 검사·기존 전체 7개 검증·규칙 JSON·diff 검사: PASS
- `/dev`, `/inventory`, `/`: HTTP 200

### 미실행

- 라이브 dry-run: Firebase 환경변수 부재로 미실행
- 실제 마이그레이션: 미실행
- 라이브 규칙 게시 및 실계정 검증: 미실행

## 2026-07-26 — 공통 UI 칩·필터 분리

### 범위

- `components/ui/filters.tsx` 신규
- `PillTabs`, `ToggleChips`, `FilterGroup`, `FilterChips`, `ChipOpt` 이동
- `components/ui/index.tsx` 기존 공개 API 재수출
- `FormGrid`의 `ToggleChips` 의존성을 leaf 직접 import로 전환

### 1차 검증

- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/contract`: HTTP 200
- `components/ui/index.tsx`: 309줄 → 191줄

### 전체 검증

- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- `git diff --check`: PASS

## 2026-07-26 — 공통 UI 통계·요약 분리

### 범위

- `components/ui/metrics.tsx`
- 이동 대상: `Card`, `Toolbar`, `Panel`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`
- `components/ui/index.tsx`는 기존 API를 재수출한다.

### 호환성 및 검증

- 기존 `Step` 타입과 컴포넌트 props 유지
- tone 색, 수치 표시, Stepper 상태 표현 유지
- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- `git diff --check`: PASS
- production build는 실행 중인 개발 서버 보호를 위해 보류

## 2026-07-26 — Inventory 목록 UI 분리 검증

### 검증 결과

- 신규 작성 중 드래프트가 신규 슬롯을 채우는 조건 유지
- 선택 행 표시와 클릭 콜백 유지
- 검색 조건 유무에 따른 빈 상태 문구·조건 해제 유지
- 100대 더보기 단위와 500대 전체 보기 상한 유지
- 목록 상태 setter를 개별 전달하지 않고 `InventoryListPanelModel` 경계 사용

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- 전체 도메인 시뮬레이션 및 차량 마스터 검증: PASS

### 남은 위험

- 실제 브라우저의 목록 선택·더보기·신규 슬롯을 수동 검증하지 않았다.
- `/inventory` 라우트는 누적 리팩터링 전 18.5 kB에서 18.8 kB로 증가했다.

### 최종 판정

**PASS**

---

## 2026-07-27 4역할 실계정·채팅 갱신·정산 격리 검증

### 판정

**PASS — 역할별 실제 금액 화면만 QA 정산 생성 후 최종 확인**

- 별도 QA 조직의 활성 계정 4종(영업채널 관리자·직원, 공급사 관리자·직원)으로 실제 Firebase Auth 로그인했다.
- 메뉴와 데이터 범위:
  - 영업채널 관리자는 채널 계약·채팅, 영업채널 직원은 본인 계약·채팅만 조회했다.
  - 공급사 관리자·직원은 자기 회사 재고·계약·채팅을 조회했다.
  - 반대 조직 코드 쿼리와 권한 밖 경로는 운영 RTDB Rules가 HTTP 401로 차단했다.
- QA 계약 `TMP-260727-01-yvjf`, 차량 `99하0727`, QA 문의방을 네 역할에서 확인했다.
- 공급사 직원→영업자, 영업자→공급사 메시지 송수신을 확인했다.
- 채팅 메시지 로딩 전 빈 대화 안내가 잠깐 보이던 상태를 로딩 상태로 분리했다.
- 방별 메시지 성공 결과를 영구 캐시하지 않고 동시 요청만 합치도록 변경했다.
- 열린 대화는 5초 주기·창 포커스·`fp:unread` 이벤트에 새 메시지를 다시 읽는다.
- 공급사 토큰으로 새 QA 메시지를 넣은 뒤 페이지 새로고침 없이 영업자 화면에 나타나는 것을 확인했다.
- 감사로그 쓰기/조회 경로를 운영 Rules가 허용하는 루트 `audit_logs`로 통일했고, 채팅 전송 시 새 `permission_denied` 경고 0건을 확인했다.
- 설정 페이지는 hydration 전에 localStorage 기반 `actor()`를 호출하지 않도록 바꿨고, 로그인 세션 이름 불일치 오류가 재발하지 않았다.

### 정산 private 운영 매트릭스

- 영업 직원의 자기 `settlements_agent_private` 쿼리: HTTP 200
- 영업채널 관리자의 자기 채널 `settlements_agent_private` 쿼리: HTTP 200
- 공급사 직원·관리자의 자기 회사 `settlements_provider_private` 쿼리: HTTP 200
- 영업→공급사 private, 공급사→영업 private, 네 역할→관리자 private: HTTP 401
- 전용 QA 정산 데이터는 아직 0건이므로 R1/R2 실제 숫자 화면 표시는 오픈 체크리스트에 잔여로 유지했다.

### 자동 검증

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 폰트 드리프트 0
- `scripts/sim-*.mts` 12개: 전부 PASS
- `NEXT_DIST_DIR=tmp/verification-build/chat-live-20260727 npm.cmd run build`: PASS
  - 28개 라우트
- 개발 서버 PID `30312`, 포트 4004 유지 및 HTTP 200

---

## 2026-07-26 — Inventory 목록 계산 훅 검증

### 검증 결과

- 180ms 디바운스 검색 계약 유지
- 상태·상품구분 필터 의미 유지
- 상태 미등록 값의 후순위 처리 유지
- 상태 동률 시 차명 정렬 유지
- 차명·차번·코드 정렬 유지
- 모바일 드래프트는 즉시 검색어를 사용해 미리보기 건수 계산 유지

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- 전체 도메인 시뮬레이션 및 차량 마스터 검증: PASS

### 남은 위험

- Inventory 전용 UI 상호작용을 실제 브라우저에서 수동 검증하지 않았다.
- `/inventory` 라우트 크기가 18.5 kB에서 18.7 kB로 0.2 kB 증가했다.

### 최종 판정

**PASS**

---

## 2026-07-26 — Finder 결과 계산 훅 검증

### 검증 결과

- 기존 `useDeferredValue` 기반 무거운 필터 지연 유지
- 숨김 코드 제외와 패스 상품 후순위 배치 유지
- 최근·관심 합집합 필터 유지
- 명시 정렬과 기본 혜택 점수 정렬 유지
- 필터 드래프트 미리보기 건수 계산 유지
- 인기차종·카탈로그 노출 총계 유지
- 엑셀 열 필터와 숫자 정렬 유지

`app/page.tsx`는 최초 1,459줄에서 724줄로 줄었으며, 결과 계산은
`useFinderResults.ts` 183줄에 모였다.

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS
- git diff --check: PASS

### 남은 위험

- 실제 브라우저에서 빠른 연속 필터 조작과 엑셀 팝오버를 수동 검증하지 않았다.
- `/` 라우트 크기는 리팩터링 전 16.4 kB에서 현재 17.1 kB로 소폭 증가했다.
  기능 모듈 경계와 타입 안정성을 얻은 대가지만, 추후 번들 분석 대상이다.

### 최종 판정

**PASS**

Finder 대형 파일의 우선 분리 목표는 달성했다. 추가 분리는 페이지 상태 훅까지
확장할 수 있으나, 현재 724줄에서 위험 대비 효율을 다시 판단하는 것이 적절하다.

---

## 2026-07-26 — Finder 데이터 로딩 훅 검증

### 검증 결과

- `peekList` 기반 동기 초기값 유지
- Firebase 사용 시 `authReady` 이후 조회 유지
- 로그인 사용자 변경 시 재조회 유지
- 상품·공급사 병렬 조회 및 공급사명 결합 유지
- 15초 타임아웃과 실패 시 빈 목록 처리 유지
- 숨김·패스 목록의 초기 로드와 구독 해제 유지
- 보기 설정 복원을 데이터 조회와 분리해 인증 재조회 시 반복 부작용 제거

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS

### 최종 판정

**PASS**

다음 단계는 검색·필터·정렬 파생 계산을 `useFinderResults`로 이동하는 작업이다.

---

## 2026-07-26 — Finder 필터 패널 분리 검증

### 요구사항

- Finder의 대형 인라인 필터 패널을 독립 컴포넌트로 이동한다.
- UI, 필터 의미, 드래프트 적용·취소, 모바일 동작을 변경하지 않는다.
- props 전달 자체가 새로운 복잡도가 되지 않도록 명확한 경계를 만든다.

### 검증 결과

| 항목 | 결과 |
|---|---|
| 필터 패널 독립 컴포넌트 이동 | PASS |
| 페이지의 필터 상태 소유권 유지 | PASS |
| 드래프트/라이브 `bump()` 계약 유지 | PASS |
| 최근·관심 목록과 필터 스냅 동기화 유지 | PASS |
| 데스크톱·모바일 공통 패널 유지 | PASS |
| 정렬 라벨·기본 열림·초기화 동작 유지 | PASS |

`FinderFilterPanelModel` 하나가 패널의 표시 모델과 명령을 묶으며, 페이지 내부 상태
setter를 개별적으로 노출하지 않는다. `app/page.tsx`는 1,042줄에서 858줄로 줄었다.

### 전체 자동 검증

- typecheck: PASS
- build: PASS, 26개 페이지 생성
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS
- git diff --check: PASS

### 남은 위험

- 실제 브라우저에서 필터 패널의 접힘·스크롤·모바일 하단시트를 수동 시각 검증하지 않았다.
- 다음 구조 작업은 데이터 로딩과 검색·필터 결과 계산 훅 분리다.

### 최종 판정

**PASS**

---

## 2026-07-26 — Cursor 엑셀 결과 테이블 분리 검증

### 검증 기준

원래 사용자 요구사항:

- `app/page.tsx`의 대형 단일 파일을 기능 변경 없이 단계적으로 분리한다.
- 엑셀 결과 테이블을 `features/finder` 아래 독립 컴포넌트로 이동한다.
- UI, 필터 의미, 정렬, 열 너비, 모바일 동작을 유지한다.
- 다른 AI가 이어받을 수 있도록 구현·검증 문서를 갱신한다.

별도 `PLAN.md`는 없으므로 원래 요구사항, `docs/REFACTOR_PROGRESS.md`,
`IMPLEMENTATION_LOG.md`, 실제 diff를 함께 비교했다.

### 구현 대조 결과

| 항목 | 결과 | 근거 |
|---|---|---|
| 엑셀 테이블 분리 | PASS | `ExcelResultsTable.tsx`로 테이블·헤더·팝오버 조립 이동 |
| 필터 의미 유지 | PASS | 표시 행과 팝오버 후보 행을 기존처럼 `rows`/`list`로 분리 |
| 정렬 유지 | PASS | 가격·연식·주행거리 숫자 정렬 함수 유지 |
| 열 순서·너비 유지 | PASS | 기존 `EXCEL_*`, `colLock*`, `excel*Chars` 계산 그대로 이동 |
| 행 동작 유지 | PASS | 상세 이동·컨텍스트 메뉴를 기존 페이지 콜백에 위임 |
| 모바일 동작 유지 | PASS | 기존 `useIsMobile()` 기반 `is-fit` 조건 유지 |
| 인수인계 문서 | PASS | 구현 로그와 리팩터링 진행 문서 갱신 |

`app/page.tsx`는 최초 1,459줄에서 현재 1,042줄로 축소됐다.

### 독립 검증 중 발견·수정한 문제

`scripts/sim-vehicle-lock.mts`가 공급사 전용 단계를 영업자 역할로 호출해 전체
시뮬레이션 중 1건이 실패했다. 제품 엔진의 역할 차단은 올바르며 테스트 하네스가
현재 권한 정책을 반영하지 못한 문제였다.

수정 내용:

- 테스트용 `asRole()` 헬퍼 추가
- `provider_balance_confirmed`, `provider_delivery_response` 실행 시 공급사 역할 적용
- 실행 후 이전 역할을 항상 복원

제품 코드나 권한 정책은 완화하지 않았다.

### 전체 검증 결과

- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS, 26개 페이지 생성
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS, 마스터 ID 1,800개 검증
- `git diff --check`: PASS

---

## 2026-07-26 — 4개 업무 화면 UI/UX 배치 검증

### 판정

**PASS**

- 설정 관심·숨김 관리, 회원 목록, 계약 정산 요약, 채팅 방 목록을 feature 컴포넌트로 분리했다.
- 기존 역할별 표시, 빈 상태, 복구·초기화 액션, 정산 R1/R2 표시 규칙을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 설정·회원·계약·채팅: 모두 HTTP 200
- `git diff --check`: PASS
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — RTDB 어댑터 데이터 계층 분리 검증

### 판정

**PASS**

- 레코드 변환과 상품 보안·중복 정책을 네트워크 어댑터에서 분리했다.
- 첨부 URL 이름 복원, 엔티티 자연키, 정책·계약 조인 결과를 유지했다.
- 공급 원가는 관리자 또는 본인 소유 공급사에만 보이는 정책을 유지했다.
- 카슝 제외 및 차량번호/VIN 실차 중복 제거 우선순위를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 주요 6개 화면: 모두 HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 회원 관리 필터·정렬 분리 검증

### 판정

**PASS**

- 사용자·파트너 목록 필터와 정렬을 순수 모듈로 이동했다.
- 승인대기는 정렬 선택과 관계없이 최상단에 놓이는 규칙을 유지했다.
- 승인 상태와 운영 활성 상태를 별도 필드로 판정하는 규칙을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/members`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 계약 목록 필터·정렬 분리 검증

### 판정

**PASS**

- 계약 필터·정렬·월 옵션을 순수 모듈로 이동했다.
- 진행 기본값의 완료 포함·취소 제외 규칙과 진행률 동률 시 최근 계약 우선을 유지했다.
- 누락된 월 라벨 공개 연결 1건을 타입 검사에서 발견해 수정했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/contract`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 채팅 목록 필터·정렬 분리 검증

### 판정

**PASS**

- 역할별 미확인·문의·완료·취소 판정과 정렬을 순수 모듈로 이동했다.
- 안읽음 동률 시 최근 메시지 우선과 드래프트 미리보기 집계를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/chat`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 채팅 방 색인·표시 분리 검증

### 판정

**PASS**

- 진행 계약과 취소 계약 색인을 분리한 기존 first-wins 규칙을 유지했다.
- product_code, product_uid, product_id, 차량번호 탐색과 삭제 차량 fallback을 유지했다.
- 관리자·공급사·영업 역할별 헤더 계산 연결을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/chat`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Finder 결과 본문 분리 검증

### 판정

**PASS**

- 빈 상태, 카드·상세·엑셀 결과와 페이징 UI를 `FinderResults`로 이동했다.
- 상품 열기·우클릭, Excel 필터/정렬 상태, 500대 표시 상한 연결을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Finder 상단 툴바 분리 검증

### 판정

**PASS**

- 모바일·웹 툴바를 `FinderToolbar`로 이동했다.
- 검색, 정렬, 필터 뱃지, 관심함, 엑셀 다운로드, 보기 전환 연결을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Finder 상품 컨텍스트 분리 검증

### 판정

**PASS**

- 상품 우클릭 액션 구성을 Finder 페이지에서 독립 모듈로 이동했다.
- 역할별 계약문의·공유 노출, 링크·내용 복사, 상세 이동을 유지했다.
- 복사 실패 fallback은 공통 오류 알림으로 현대화했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 정확 경로·감사·일괄 변환 분리 검증

### 판정

**PASS**

- 정확 경로 엔진과 운영 감사·일괄 변환 엔진을 별도 모듈로 이동했다.
- 기존 API는 얇은 호환 진입점으로 유지했다.
- 의존성 주입으로 매칭 본체와 운영 모듈 사이 순환 import가 없다.
- exact 경로, confidence 집계, 샘플 제한, auto/all 정책을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 신호·선택 보조 분리 검증

### 판정

**PASS**

- 원본 차량 신호 수집과 재스냅 입력 복원을 독립 모듈로 이동했다.
- 파워트레인 라벨·인승 분기·실트림 판정을 독립 모듈로 이동했다.
- 기존 export 호환과 매칭 알고리즘 결과를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 마스터 필터·탐색 분리 검증

### 판정

**PASS**

- 차량 5단 필터와 마스터 제조사·모델·세부모델 탐색을 leaf 모듈로 이동했다.
- 르노 표기 호환, 국산 우선 그룹, 한글 정렬, 기존 공개 import 경로를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 마스터 스냅 추적 분리 검증

### 판정

**PASS**

- 추적 키·라벨, 원본 캡처, 필드 diff, 이력 생성을 leaf 모듈로 이동했다.
- 최초 원본 유지, 변경 필드만 기록, 최근 10건 제한을 보존했다.
- `applySnap`의 업무 반영 정책과 기존 공개 import 경로는 변경하지 않았다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 마스터 표시·정규화 분리 검증

### 판정

**PASS**

- 연식·연료·제조사 표시와 연료 배기량 추출을 독립 모듈로 이동했다.
- 기존 공개 import 경로와 반환 규칙을 유지했다.
- 매칭 본체의 연료 정규화도 동일 leaf 모듈을 사용해 규칙 중복이 없다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 클립보드 공통화 검증

**PASS**

- `copyText`가 최신 Clipboard API 실패 시 호환 fallback을 수행한다.
- 임시 textarea는 성공·실패 모두 제거된다.
- 계약 링크와 재고 TSV 복사 실패가 오류로 표시된다.
- typecheck·전체 시뮬레이션 PASS
- 개발 서버 `/inventory`: HTTP 200
- 2차 적용 후 앱·컴포넌트의 직접 Clipboard API 호출 0건
- 실패 시 기존 prompt 또는 오류 toast fallback 유지

---

## 2026-07-26 — Cursor 가격·혜택 원자 분리 독립 검증

### 판정

**PASS (BOM 수정 후)**

- `product-card-pricing.tsx`: 가격 컨텍스트·기간·요금 UI 319줄
- `product-card-perks.tsx`: 혜택·이벤트·조건 UI 158줄
- `product-card-atoms.tsx`: 725줄 → 271줄
- pricing → perks → badges 단방향이며 barrel 역참조가 없어 순환 의존성 없음
- 기존 `product-card-atoms` export 경로 유지

### 발견 및 수정

- Cursor 저장 과정에서 `product-card-atoms.tsx` 시작에 UTF-8 BOM이 추가됨
- BOM 제거 완료

### 검증

- typecheck: PASS
- 전체 시뮬레이션·차량 마스터 검증: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — 공통 확인창·알림 전환 검증

### 판정

**PASS**

- 계약, 정책, 회원, 재고, 개발 도구의 파괴적/중요 작업이 공통 `confirmDialog`를 사용한다.
- 로그인/가입 오류는 브라우저 기본 alert 대신 공통 error toast를 사용한다.
- `app`, `components`, `features` 범위에 직접 `window.confirm`·`window.alert` 호출이 남지 않았다.

### 실행 결과

- `npm run typecheck`: PASS
- `sim-agent`, `sim-lifecycle`, `sim-e2e-settlement`, `sim-vehicle-lock`, `sim-sheet-merge`, `sim-phase12`, `verify-master-pass`: 모두 PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버의 `.next` 충돌 방지를 위해 보류

로컬 시뮬레이션 중 Firebase 환경변수 누락 메시지는 기존 예상 경고이며 실패가 아니다.

---

## 2026-07-26 — 공통 UI 오버레이 분리 검증

### 판정

**PASS**

- `Drawer`, `Modal`을 `components/ui/overlays.tsx`로 이동했다.
- 기존 `@/components/ui` import 경로와 컴포넌트 API를 유지했다.
- 오버레이의 키보드 이동, 닫기, 모바일 풀스크린 표현 로직을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 차량 마스터 타입 분리 검증

### 판정

**PASS**

- 순수 도메인 타입 7종을 별도 파일로 이동했다.
- 기존 `vehicle-master-match.ts`의 type re-export를 유지해 모든 소비자와 스크립트가 호환된다.
- 실행 로직과 데이터 변환 결과에는 변화가 없다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 공통 UI 레이아웃 분리 검증

### 판정

**PASS**

- 레이아웃 원자 4종을 `components/ui/layout.tsx`로 이동했다.
- 공개 API, 스타일 토큰, 모바일 규격, VSplit 이벤트 정리·localStorage 동작을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 공통 UI 버튼 분리 검증

### 판정

**PASS**

- `Btn`, `IconBtn`, `IconSeg`를 `components/ui/buttons.tsx`로 이동했다.
- 기존 공개 API, 모바일 높이·패딩, disabled·접근성 속성, 스타일 오버라이드를 유지했다.
- leaf 버튼 모듈은 tokens와 모바일 훅만 참조하며 barrel 순환 의존성이 없다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 공통 UI 폼 입력 분리 검증

### 판정

**PASS**

- 기본 폼 입력 4종을 `components/ui/form-controls.tsx`로 이동했다.
- 공개 API와 모바일 입력 규격, 키보드·포커스 동작을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 공통 UI 리스트 분리 검증

### 판정

**PASS**

- `ListRow`, `ListBox`를 `components/ui/list.tsx`로 이동했다.
- 기존 공개 import 경로, props, 스타일 토큰 사용을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

Firebase 환경변수 누락 메시지는 localStorage 시뮬레이션에서 발생하는 기존 경고이며
검증 실패가 아니다.

### 남은 위험

- 실제 브라우저에서 엑셀 헤더 팝오버 위치와 가로 스크롤을 수동 시각 검증하지 않았다.
- `app/page.tsx`는 여전히 1,042줄이므로 필터 패널과 결과 계산 훅 분리가 남아 있다.
- `.claude/`는 이번 검증에서 생성·수정하지 않은 별도 미추적 디렉터리다.

### 최종 판정

**PASS**

Cursor의 엑셀 결과 테이블 분리는 원래 요구사항과 일치한다. 독립 검증에서 발견한
테스트 하네스 불일치도 수정했으며, 전체 자동 검증이 통과한다.

---

## 2026-07-26 — Finder 구조 분리

### 검증 기준

원래 사용자 요구사항:

- 대형 단일 파일을 분리한다.
- 다른 AI가 이어받을 수 있도록 진행 내용을 문서화한다.
- 기존 기능과 사용자 동작을 깨뜨리지 않는다.

별도의 Claude Code `PLAN.md`는 없었다. 따라서 사용자의 원래 요구사항,
`docs/REFACTOR_PROGRESS.md`, 실제 변경사항을 기준으로 검증했다.

### 요구사항 충족 여부

| 요구사항 | 결과 | 근거 |
|---|---|---|
| 대형 Finder 파일 분리 | PASS | 1,459줄에서 1,213줄로 축소, 3개 모듈로 책임 이동 |
| 인수인계 문서화 | PASS | 협업 규칙, 진행 메모, 구현 로그, 검증 문서 추가 |
| 동작 호환성 유지 | PASS | 타입 검사, 빌드, 핵심 시뮬레이션 통과 |

### 실제 변경

- `features/finder/filter-state.ts`
- `features/finder/excel-columns.ts`
- `features/finder/ExcelFilterPopover.tsx`
- `app/page.tsx`에서 위 책임 제거 및 import로 교체
- `docs/AI_COLLABORATION.md`
- `docs/REFACTOR_PROGRESS.md`
- `IMPLEMENTATION_LOG.md`
- `HANDOFF.md`

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS, 26개 페이지 생성
- `npx.cmd tsx scripts/sim-agent.mts`: 37/37 PASS
- `npx.cmd tsx scripts/sim-phase12.mts`: 25/25 PASS
- `git diff --check`: PASS

### 회귀·보안·데이터 호환성

- Firebase 데이터 경로와 보안 규칙은 변경하지 않았다.
- `FilterBag` 필드와 sessionStorage 키를 유지했다.
- 엑셀 필터 다중값 OR 의미와 숫자 정렬 방식을 유지했다.
- 팝오버의 검색, 선택, 초기화, 정렬, 닫기 동작을 유지했다.
- 프로덕션 번들의 `/` 크기는 변경 전과 동일한 16.4 kB다.

### 남은 위험

- 브라우저에서 실제 팝오버 위치와 클릭 동작을 수동 시각 검증하지 않았다.
- `app/page.tsx`는 여전히 1,213줄이므로 추가 분리가 필요하다.
- Firebase 환경변수가 없는 localStorage 시뮬레이션에서는 기존 경고가 출력된다.
- 당시 `scripts/sim-vehicle-lock.mts` 역할 기대 불일치가 남아 있었으나, 위의 최신
  검증 단계에서 테스트 역할 설정을 수정해 23/23 통과로 해소했다.

### 최종 판정

**PASS**

현재 단계의 구조 분리는 원래 요구사항을 충족하며, 자동 검증 범위에서 회귀가 없다.

---

## 2026-07-26 — Inventory 편집 패널 분리 독립 검증

### 판정

**PASS**

`app/inventory/page.tsx`의 기본정보·운영정보 UI를
`features/inventory/InventoryEditorPanes.tsx`로 이동했다. 페이지에는 저장, OCR,
차종 마스터 적용과 같은 도메인 조정 로직을 남겨 UI 분리로 동작 계약이 바뀌지 않게 했다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 정적 페이지 26개 생성

### 독립 확인 사항

- 선택 여부, 신규/수정 모드, dirty 상태가 모델을 통해 그대로 전달된다.
- 마스터 선택 결과의 `applySnap(..., source: 'picker')` 처리는 페이지에 보존됐다.
- 가격·사진 변경은 기존처럼 폼 갱신과 dirty 설정을 함께 수행한다.
- 관리자 전용 필드와 공급사 정책 범위 필터가 유지됐다.
- Firebase 환경변수 누락 문구는 localStorage 시뮬레이션의 기존 경고다.

### 남은 위험

- 실제 브라우저에서 OCR 파일 선택, 사진 길게 누르기, 마스터 피커를 수동 검증하지 않았다.
- `/inventory` 라우트 크기가 18.8 kB에서 19.1 kB로 0.3 kB 증가했다.
  구조 분리 결과이며, 동적 로딩을 포함한 번들 최적화는 별도 후속 작업으로 남긴다.

---

## 2026-07-26 — Inventory OCR·차종 마스터 훅 분리 검증

### 판정

**PASS**

OCR와 차량 마스터 처리 책임을 `useInventoryVehicleTools.ts`로 이동했고,
`app/inventory/page.tsx`는 643줄에서 496줄로 축소됐다.

### 회귀 확인

- 선택 generation 가드 유지: 늦게 끝난 이전 선택 작업이 현재 폼을 덮지 않는다.
- exact 경로 및 high/medium 신뢰도 조건을 만족할 때만 자동 DB 패치한다.
- 색상 패치와 마스터 패치 모두 목록 캐시를 함께 갱신한다.
- 사용자 재매칭은 `source: 'manual'`, 피커 선택은 `source: 'picker'`를 유지한다.
- OCR는 `/api/ocr/extract` 계약과 빈 칸 우선 병합을 유지한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 26개 페이지

### 남은 위험

- OCR와 마스터 피커의 실제 브라우저 파일·클릭 흐름은 수동 검증하지 않았다.
- `/inventory` 라우트는 19.2 kB로 직전보다 0.1 kB 증가했다.

---

## 2026-07-26 — Inventory 편집 수명주기 분리 검증

### 판정

**PASS**

저장·삭제·편집 상태 전환을 `useInventoryEditorLifecycle.ts`로 분리했다.
페이지는 496줄에서 386줄로 축소됐다.

### 독립 확인 사항

- 공급사 소유권 검증과 귀속 코드 강제가 유지됐다.
- 차량번호 중복 검사에서 공백 제거 및 자기 상품 제외 조건이 유지됐다.
- `vehicleLockedBy` 결과가 저장 폼 상태보다 우선하며 계약 코드도 함께 각인된다.
- 삭제 전 `blockingContractFor`로 진행 계약 전체를 검사한다.
- 저장 실패 시 dirty 상태를 해제하지 않는다.
- 신규 취소는 선택 해제, 기존 수정 취소는 목록 원본 복원으로 동작한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 26개 페이지

### 남은 위험

- 저장 확인 알림과 삭제 확인창은 실제 브라우저에서 수동 검증하지 않았다.
- `/inventory` 라우트가 19.5 kB로 직전 대비 0.3 kB 증가했다.

---

## 2026-07-26 — Inventory 데이터·권한 초기화 분리 검증

### 판정

**PASS**

상품 로딩과 접근 제어 이벤트를 `useInventoryData.ts`로 이동했다.
`app/inventory/page.tsx`는 386줄에서 342줄로 축소됐다.

### 독립 확인 사항

- 상품과 파트너를 병렬 조회한 후 공급사 이름을 결합하는 순서를 유지했다.
- 공급사 역할의 `provider_company_code` 범위 제한을 유지했다.
- 최초 진입에서 시드·권한·정책·상품 순으로 준비한다.
- 마스터 로딩과 데스크톱 첫 상품 선택은 비동기로 실행한다.
- 역할 이벤트 리스너는 최신 선택 콜백을 ref로 참조해 불필요한 재등록을 방지한다.
- 모바일 역할 전환에서는 첫 상품을 자동 선택하지 않는다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 26개 페이지

### 남은 위험

- 역할 변경과 모바일/데스크톱 첫 선택 차이는 실제 브라우저에서 수동 검증하지 않았다.
- `/inventory` 라우트가 19.7 kB로 직전 대비 0.2 kB 증가했다.

---

## 2026-07-26 — Inventory 런타임·번들 후속 검증

### 판정

**자동 검증 PASS / 브라우저 수동 검증 보류**

### 확인 내용

- 실행 중인 로컬 서버의 `http://localhost:4004/inventory`: HTTP 200
- 응답 본문: 19,887 bytes
- production build의 `/inventory`: 19.7 kB, First Load JS 272 kB
- route 전용 JavaScript 파일: 51,983 bytes
- 공급사 시트와 차량 마스터 로더의 기존 지연 로딩 유지

### 번들 판단

구조 분리 과정의 소폭 증가는 새 대형 라이브러리 유입으로 확인되지 않았다.
현재 크기만 줄이기 위해 훅을 다시 합치지 않는다. 이후 최적화는 실제 사용자 성능 측정이나
명확한 예산 기준이 생겼을 때 동적 패널 로딩 등으로 별도 진행한다.

### 보류 사유

브라우저 제어를 연결하려 했으나 사용 가능한 브라우저 세션이 없었다. 따라서 다음 항목은
수동 확인이 남아 있다.

- 데스크톱 첫 상품 자동 선택
- 모바일 목록 우선 진입
- OCR 파일 선택 및 완료 표시
- 마스터 피커와 재매칭
- 사진 탭·길게 누르기
- 역할 변경 시 권한 게이트와 선택 초기화

---

## 2026-07-26 — Product card 옵션 원자 분리 검증

### 판정

**PASS**

옵션 파싱과 칩 UI를 `product-card-options.tsx`로 이동했다. 기존 barrel 역할을 하는
`product-card-atoms.tsx`에서 같은 이름을 재수출하므로 소비자 import 계약은 바뀌지 않았다.

### 확인 사항

- 빈 옵션의 `옵션미입력` 표시 유지
- 기본 카드의 최대 2개 표시와 말줄임 유지
- 엑셀 결과의 2줄 높이·간격 상수 유지
- 상세 화면의 전체 wrap 표시 유지
- ResizeObserver 해제 처리 유지

### 실행 결과

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `npm.cmd run build`: PASS, 26개 페이지
- `/`, `/inventory` 번들 표기 변화 없음

### 남은 작업

`product-card-atoms.tsx`는 1,037줄이다. 다음 안전한 경계는 가격 컨텍스트·기간 칩·요금
표시 묶음이다.

---

## 2026-07-26 — Product card 뱃지 원자 분리 검증

### 판정

**PASS**

뱃지 계산과 렌더링을 `product-card-badges.tsx`로 이동했다. 기존 파일은 내부 사용을
명시적으로 import하고 동일 이름을 재수출하므로 순환 의존성과 소비자 변경이 없다.

### 확인 사항

- 고객 화면에 차량 상태가 노출되지 않는 audience 게이트 유지
- 상태·상품·심사 순서 및 tone 유지
- 계약중 pulse와 solid variant 유지
- 축약 라벨 역변환을 포함한 tooltip 유지
- 혜택별 설명과 연령 숫자 설명 유지

### 실행 결과

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `npm.cmd run build`: PASS, 26개 페이지
- 주요 route 번들 표기 변화 없음

### 다음 경계

`product-card-atoms.tsx`는 929줄이다. 가격 컨텍스트와 기간·요금 표시 묶음을 다음
분리 대상으로 유지한다.

---

## 2026-07-26 — Product card 기간별 요금 분리 검증

### 판정

**자동 검증 PASS / production build 보류**

`PriceMini`와 `PriceFare` 묶음을 `product-card-fares.tsx`로 이동했고 기존 공개 경로를
재수출로 유지했다. `product-card-atoms.tsx`는 929줄에서 843줄로 축소됐다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- production build: 실행하지 않음

### 빌드 보류 이유

Next 개발 서버와 production build가 같은 `.next`를 사용하면 실행 중 서버가 500으로
깨질 수 있다. 사용자의 서버 유지 요청에 따라 작업 중에는 build를 실행하지 않고,
서버를 내려도 되는 시점에 최종 build를 수행한다.

---

## 2026-07-26 — Product card 차량 신원·제원 분리 검증

### 판정

**자동 검증 PASS / 서버 유지**

- `idParts`, `idMobile`, `cardTitle`, `specLine`, `specLineCard`를
  `product-card-identity.ts`로 이동했다.
- 제조사 표준 표시, 무트림 라벨 제외, 연료 내장 배기량 fallback을 유지했다.
- 카드 고정 슬롯의 누락값 `-` 표시를 유지했다.
- 기존 `product-card-atoms` import 경로를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — Product card 뱃지 UI 분리

**PASS**

- 상품구분 뱃지와 상태·상품·심사 레일을 `product-card-badge-view.tsx`로 이동
- audience 게이트, 표시 순서, pulse, dense 폭 유지
- typecheck·전체 시뮬레이션 PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Product card 신원 UI 분리 검증

### 판정

**PASS**

- `Plate`, `CardTitle`을 `product-card-identity-view.tsx`로 이동했다.
- 폰트, 말줄임, tooltip, 차량번호 monospace 표현을 유지했다.
- 순수 문자열 모듈이 UI 컴포넌트를 import하지 않는 방향을 유지했다.
- 기존 공개 import 경로는 재수출로 호환된다.

### 실행 결과

- typecheck: PASS
- 전체 시뮬레이션·차량 마스터 검증: PASS
- 개발 서버 `/inventory`: HTTP 200
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — 전자서명 링크 만료·폐기 검증

### 판정

**자동 검증 PASS / Firebase 배포 검증 보류**

- 새 링크는 기본 7일 만료 시각을 가진다.
- 유효 링크 재발송은 토큰을 유지하고, 만료·폐기 링크 재발급은 새 토큰을 만든다.
- 익명 읽기·서명 제출은 유효한 발송 링크에만 허용된다.
- 계약 소유자·채널 관리자·플랫폼 관리자는 만료·폐기 링크 상태를 확인할 수 있다.
- 만료 시각은 생성 시각 이후, 최대 30일 이내이며 생성 후 임의 변경할 수 없다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 23/23 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- `database.rules.json` JSON 파싱: PASS
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

### 남은 운영 검증

- 현재 환경에는 Firebase 설정이 없어 실제 Rules 배포·에뮬레이터 검증을 수행하지 않았다.
- 규칙 게시 후 익명 서명자, 계약 소유 영업자, 채널 관리자, 플랫폼 관리자 계정으로 역할별 스모크가 필요하다.

---

## 2026-07-26 — 전자서명 토큰·비활성 링크 앱 경계

### 판정

**PASS**

- Web Crypto로 192비트 난수 토큰을 생성한다.
- 폐기 상태만 있고 폐기 시각이 없는 불완전 레코드도 비활성 처리한다.
- Firebase 공개 조회와 로컬 저장소 fallback 모두 만료·폐기 링크를 반환하지 않는다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 26/26 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 승인 상태 전이

### 판정

**자동 검증 PASS / Firebase 배포 검증 보류**

- 발송 상태 또는 서명·동의가 빠진 검토대기는 도메인 승인 조건에서 거부된다.
- v4 계약 Rules는 공개 슬롯의 계약코드, 검토대기 상태, 서명, 동의를 승인 근거로 확인한다.
- 영업자가 약정발송 단계를 진행할 때 공개 슬롯의 최종 `signed` 상태를 요구한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 33/33 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- `database.rules.json` JSON 파싱: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 필수 동의 증적

### 판정

**자동 검증 PASS / Firebase 배포 검증 보류**

- 필수 동의 5개가 고정 ID와 순서로 정규화된다.
- 하나라도 누락된 동의 배열은 제출 전에 거부된다.
- 익명 쓰기는 정확한 동의 문자열과 `v1` 버전을 모두 요구한다.
- 기존 한글 동의 증적은 승인 단계에서 계속 인정된다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 37/37 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- `database.rules.json` JSON 파싱: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 공개 제출 데이터 검증

### 판정

**자동 검증 PASS / Firebase 배포 검증 보류**

- 정상 성명·연락처·PNG 서명·필수 동의 제출은 허용된다.
- 짧은 연락처, SVG 서명, 600KB 초과 서명은 도메인에서 거부된다.
- Rules는 PNG data URL 접두사와 최근 제출 시각을 요구한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 43/43 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- `database.rules.json` JSON 파싱: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 증적 확정·공개 개인정보 정리

### 판정

**자동 검증 PASS / Firebase 통합 검증 보류**

- 공개 슬롯의 서명·동의·본인확인 필드가 관리자 검토 객체에 모두 병합된다.
- 승인된 계약 원본에는 서명·동의·신원 증적이 보존된다.
- 서명 완료 공개 슬롯에서는 제출 개인정보와 서명 데이터가 삭제된다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 49/49 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

### 남은 검증

- Firebase 환경에서 익명 제출 → 영업자 승인 → 계약 원본 증적 확인 → 공개 슬롯 개인정보 삭제를 실제 계정으로 확인해야 한다.

---

## 2026-07-26 — 전자서명 승인 중간 실패 복구

### 판정

**PASS**

- 서명완료이지만 약정발송이 누락되고 유효 증적이 남은 상태만 복구 대상으로 판정한다.
- 이미 완료된 계약과 증적이 없는 계약은 복구 대상에서 제외된다.
- 복구 실행은 계약 증적 저장을 반복하지 않고 후속 단계만 재시도한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 52/52 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 링크 해지 실패 안전성

### 판정

**PASS**

- 공개 슬롯을 계약 원본보다 먼저 폐기한다.
- 폐기 패치는 `revoked` 상태, 폐기 시각, 기존 만료 시각을 보존한다.
- 두 단계 사이 실패 시에도 공개 링크가 활성 상태로 남는 방향을 피한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 55/55 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 전자서명 공개 개인정보 최소화

### 판정

**PASS**

- 신규 공개 슬롯에 계약 원본의 고객 이름과 전화번호가 포함되지 않는다.
- 반려 후 재서명 공개 슬롯에서 이전 제출 개인정보와 서명 증적이 제거된다.
- 계약 원본과 관리자 검토 데이터는 삭제하지 않는다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `node --import tsx scripts/sim-contract-sign-rules.mts`: 57/57 PASS
- `node --import tsx scripts/sim-agent.mts`: 39/39 PASS
- `database.rules.json` JSON 파싱: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 오픈 준비 로컬 릴리스 게이트

### 판정

**로컬 코드 게이트 PASS / 운영 Firebase 게이트 대기**

- 개발 서버를 잠시 종료하고 `npm.cmd run build` 성공: 26개 페이지
- 빌드 후 포트 4004 개발 서버 복구
- typecheck·폰트 검사·전체 시뮬레이션·차량 마스터 전수검증 PASS
- 실행 서버 주요 22개 경로 HTTP 200
- 로컬 Firebase 필수 환경변수 6종 설정 확인
- Vercel Production·Preview Firebase 환경변수 8종 설정 확인
- 자차 면책 비율형·정액형 표시 변경은 build와 전체 회귀검사를 통과

### 남은 오픈 차단 항목

- 완료 계약 없는 출고불가 3대의 의도된 상태 확인
- 관리자 외 4역할 실제 계정 권한 테스트
- 전자서명 반려·해지·만료 실브라우저 테스트
- Vercel production 배포

단일 실행 문서는 `OPENING_CHECKLIST.md`를 따른다. 추가 리팩터링은 오픈 후 범위로 동결한다.

---

## 2026-07-26 — Cursor 오픈 전 실사용 QA 독립 검증

### 판정

**PASS / 실제 브라우저 연타 검증만 수동 잔여**

- 채팅 전송·첨부, 계약 단계, 서명 제출, 회원 저장·승인, 재고 저장, 비밀번호 메일에 중복 실행 방지와 오류 피드백 적용
- 설정 연락처 포맷 통일
- 회원 private 요율 저장 후 enrich된 행으로 상세 폼 재주입
- Firebase Rules·스키마·마이그레이션·전자서명 상태기계 변경 없음

### 실행 결과

- typecheck·폰트 검사: PASS
- 전체 권한·채팅·계약·서명·정산·생애주기·차량잠금 시뮬레이션: PASS
- 상품·정산 private 마이그레이션 계획 시뮬레이션: PASS
- 차량 마스터 전수검증: PASS
- production build: PASS, 26개 페이지
- 서버 복구 후 `/`, `/inventory`, `/chat`, `/contract`, `/settlement`, `/members`, `/settings`, `/sign/invalid-test-token`: HTTP 200
- `git diff --check`: PASS

### Chrome 실브라우저 후속 검증

- localhost ERP4 탭 연결 및 화면 제어 성공
- 상단 사용자 표시: `박영협`
- 390×844 모바일 뷰포트에서 `/inventory`, `/chat`, `/contract`, `/settlement`, `/settings` 가로 넘침 없음
- DevTools JavaScript error 없음
- `products_private`, `settlement private` 조회의 `Permission denied` 경고 반복
- 설정 화면에 프로필 입력란 없이 `로그인` 버튼이 표시되어 Firebase 인증 세션은 확인되지 않음

### 잔여 수동 검증

- 실제 쓰기를 만드는 빠른 연타·Enter 반복은 운영 데이터 부작용을 피하기 위해 실행하지 않았다.
- Firebase Rules 게시 후 실제 5역할 계정으로 private 조회와 쓰기 중복 방지를 확인한다.

---

## 2026-07-26 — 연결 브라우저 운영형 E2E 추가 검증

### 실제 확인

- 관리자 계정(`박영협`, 플랫폼 관리자)으로 회원·파트너 화면 진입: PASS
- 회원 146명, 승인대기 1명 및 역할 관리 화면 표시: PASS
- 재고 428대 로딩, 상품 신규 등록·취소 시 미저장 초안이 남지 않음: PASS
- G: 드라이브의 실제 자동차등록증 PDF 원본 존재 확인: PASS
- OCR 결과가 정상 추출됐다고 가정하고 다음 QA 상품을 실제 저장:
  - 차량번호 `66소6317`
  - 기아 카니발 KA4, 디젤 2.2, 9인승, 2,151cc
  - 출고가능 / 중고렌트
  - 12개월 월 890,000원 / 보증금 3,000,000원
  - 메모 `[QA 20260726] OCR 정상 추출 가정 E2E 시뮬레이션`
- 저장 후 `66소6317` 검색 결과 1건 및 입력값 재표시: PASS

### 분리된 검증 항목

- OCR 정확도와 파일 업로드는 사용자 직접 검증 항목으로 분리했다.
- 원본 등록증 PDF는 수정·이동·삭제하지 않았다.

### 발견한 차단 문제

- `/contract` 직접 진입 시 Next.js 개발 서버에서
  `Invariant: Expected clientReferenceManifest to be defined` 런타임 오류가 재현됐다.
- 오류 후 `/inventory`, `/members`는 HTTP 200을 반환하지만 연결 브라우저에서
  인증 컨텍스트가 `불러오는 중…` 상태로 복구되지 않았다.
- 실행 중인 4004 서버는 중단하거나 재시작하지 않았다.
- 따라서 이번 연결 세션에서는 상담·계약·서명·정산 실제 쓰기와 QA 상품 삭제를
  이어서 수행하지 못했다. 관리자 인증 재연결 후 동일 상품으로 계속 검증한다.

### 개발 서버 번들 장애 및 복구

- 증상: 로그인 직후 홈 화면 CSS 미적용, `/members` 백지 화면.
- 확인: 기존 4004 HTML이 참조한 `layout.css`와 App Router 페이지 청크가 404를 반환했다.
- 원인: OCR 확인용 보조 Next 개발 서버가 기존 4004 서버와 같은 `.next` 디렉터리를
  사용해 디스크 번들과 기존 프로세스의 메모리 상태가 어긋난 것으로 판단했다.
- 조치: `NEXT_DIST_DIR`로 보조 서버의 빌드 디렉터리를 분리할 수 있도록 설정하고,
  Next 설정 변경 감지에 의한 자체 재기동으로 4004를 복구했다.
- 복구 확인:
  - 홈 CSS 및 상품 395대 표시: PASS
  - 관리자 `박영협` 인증 유지: PASS
  - 회원·파트너 146건 표시: PASS
  - `/contract` HTTP 200, 참조 정적 자산 10개 전부 HTTP 200: PASS

### 2026-07-27 재검토

- `/`, `/inventory`, `/members`, `/chat`, `/contract`, `/settlement`: HTTP 200
- `git diff --check`: PASS
- TypeScript `tsc --noEmit`: PASS
- 폰트 토큰 드리프트: 0
- 권한 시뮬레이션: 44/44 PASS
- 채팅 Rules 시뮬레이션: 40/40 PASS
- 계약 Rules 시뮬레이션: 23/23 PASS
- 계약 전자서명 Rules 시뮬레이션: 57/57 PASS
- 3자 정산 E2E 시뮬레이션: 15/15 PASS
- 전체 생애주기 시뮬레이션: PASS
- 차량 잠금·중복계약 방지 시뮬레이션: 23/23 PASS

자동 검증은 통과했지만 실제 역할별 계정으로 회원가입·승인·배정·채팅·계약·서명·
정산서 출력까지 수행하는 브라우저 운영 E2E는 아직 완료되지 않았다. 이 항목을
오픈 전 최종 잔여 검증으로 유지한다.
## 2026-07-27 — Firebase Storage 원본 + Google Drive 백업 독립 검증

### 판정

**Storage 운영 활성화 PASS / Drive OAuth·실제 helper 업로드 PASS**

- 신규 상품 사진·계약 서류·채팅 파일은 RTDB data URL 대신 Firebase Storage를 사용한다.
- 상품·계약은 Drive 백업을 시도하고 채팅은 Storage에만 저장한다.
- Drive 설정 누락·백업 실패가 Storage 원본을 제거하거나 업무 저장을 취소하지 않는다.
- 계약·채팅 레코드 저장 실패 시 직전 Storage 업로드를 정리한다.
- 상품 편집 취소 시 신규 업로드를, 저장 성공 시 제거된 기존 사진을 정리한다.
- ERP 삭제는 Storage 원본만 삭제하고 Drive 사본은 복구용으로 보존한다.
- 레거시 data URL은 계속 표시한다.

### 자동 검증

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 드리프트 0
- `scripts/sim-*.mts` 12개: 전부 PASS
  - 영업자 39/39, 권한 44/44, 채팅 Rules 40/40
  - 계약 Rules 25/25, 전자서명 57/57, 3자 정산 15/15
  - 생애주기, Phase 1·2 25/25, private 마이그레이션 15/15·12/12
  - 시트 병합 12/12, 차량 잠금 23/23
- `NEXT_DIST_DIR=.next-storage-verification npm.cmd run build`: PASS
  - 28개 라우트, `/api/drive-backup` 포함
- Firebase Storage Emulator 15.24.0: `storage.rules` 로드·컴파일 PASS
- 공유 버킷의 V3 `product-images`, `contract-files`, `notice-images`, `user-docs`,
  `contract-signed`, `contract-unsigned`, `chat-files` 규칙을 원본과 대조해 보존
- 실행 서버: `/`, `/inventory`, `/chat`, `/contract` HTTP 200
- `/api/drive-backup`: 서버 재시작 후 HTTP 200, `{"enabled":true}` 확인
- `git diff --check`: PASS

### 운영 적용 결과

- `freepasserp3.firebasestorage.app`에 V3 호환 + V4 `/erp` Rules 게시 완료.
- 운영 Rules release ruleset:
  `projects/freepasserp3/rulesets/9a8cdcea-56e9-48f5-bcd9-445a63d0ebb2`
- 게시 전 V3 Rules는 `storage.rules.PREV`에 보존했다.
- Google Drive API를 `freepasserp3` 프로젝트에서 활성화했다.
- `drive.file` 최소 권한으로 앱이 직접 만든 Drive 루트 `FreepassERP4 자동백업`
  (`1KT0jDkm3yYFpcYWnv6-kJQutIhZwEum3`)을 로컬 환경변수에 설정했다.
- OAuth 앱 정책 동의, 테스트 사용자, 데스크톱 클라이언트, 오프라인 refresh token 발급을 완료했다.
- Vercel Production·Preview에 Drive 환경변수 4종이 모두 암호화 상태임을 확인했다.
- refresh token으로 새 access token을 발급한 뒤 확인 파일 업로드에 성공했다.
- 실제 서버 helper `uploadDriveBackup`으로
  `상품/DRIVE-CONNECTION-TEST/2026-07-27T04-01-50-914Z_connection-check.txt`를
  생성해 폴더 탐색·생성·multipart 업로드까지 확인했다.
- 관리자·영업자·공급사 계정별 실제 사진·계약서 업로드와 ERP 삭제 후
  Storage 원본 삭제·Drive 사본 보존·수동 복구는 최종 운영 E2E 항목으로 남긴다.
- Storage download URL은 capability URL이다. RTDB 업무 범위가 URL 발견을 제한하지만
  URL 자체의 외부 전달까지 막지는 못한다. 계약 개인정보의 강한 차단은 인증 다운로드 프록시가 후속 과제다.

### 개발 서버 복구 기록

- 별도 production 빌드는 성공했으나 ignored 산출물 정리 명령이 실행 중 `.next` 캐시까지 정리해
  기존 서버가 일시적으로 500을 반환했다.
- 소스와 Firebase 운영 데이터는 변경되지 않았다.
- 손상 캐시는 `tmp/server-recovery/`로 보존하고 4004 개발 서버를 재기동했다.
- Drive 환경변수 반영을 위해 4004 서버만 짧게 재시작했다.
- 최종 리스너 PID는 `30312`이며 `/api/drive-backup` HTTP 200과 `enabled:true`를 확인했다.

## 2026-07-27 — 회원·파트너 목록 규격 통일 검증

### 판정

**PASS**

- 회원·파트너 목록을 재고와 같은 아이콘 + 3줄 피드 행, 첫 행 신규 등록,
  검색 결과 조건 해제, 100명 단위 더보기 규격으로 통일했다.
- 사용자 151명에서 첫 100명과 `더보기 · 51명`, 승인대기 1명, 역할·활성 표시를 확인했다.
- 파트너 38명에서 V3 `provider`·`sales_channel`이 공급사·영업채널로 표시되는지 확인했다.
- 공급사 필터에서 V3 `provider` 항목은 남고 영업채널 항목은 제외되는지 확인했다.
- 기존 좌측 목록/우측 상세, 모바일 목록→상세 전환, 저장·승인·삭제 동작은 변경하지 않았다.
- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 드리프트 0
- `scripts/sim-*.mts` 12개: 전부 PASS
- `NEXT_DIST_DIR=.next-verification-20260727-members npm.cmd run build`: PASS
  - 28개 라우트, `/members` 8.76kB, `/api/drive-backup` 포함
- 실행 중인 `.next`와 분리한 빌드 산출물은 `tmp/verification-build/members-20260727/`에 보존했다.

---

## 2026-07-27 — 회원·파트너 및 월별 정산 4프레임 검증

### 판정

**PASS**

- 공통 화면 정의를 `목록 1 + 업무 패널 3 = 데스크톱 4프레임`으로 확정했다.
- 회원·파트너 전환을 검색·역할/유형 필터보다 상위인 목록 헤더로 이동했다.
- 회원·파트너 상세를 기본정보, 권한/정산, 영업/연동의 3개 독립 패널로 분리했다.
- 월별 정산을 월 선택 가능한 실제 정산 목록과 3개 상세 패널로 재구성했다.
- 월 집계는 검색·상태 필터와 무관하게 선택 월 전체 레코드를 기준으로 유지했다.
- 기존 정산 XLSX 가져오기, 정산서 다운로드, VAT 정산서 편집 기능을 보존했다.

### Chrome 실데이터 상호작용

- `/members` 사용자 목록: 151명, 사용자/파트너 탭이 역할 필터 위에 표시됨
- 사용자 선택: `기본정보 | 소속·권한 | 영업설정` 표시, 승인대기 동작 노출
- `/members` 파트너 전환: 38명, `기본정보 | 정산·운영 | 데이터연동` 표시
- `/settlement`: `월별정산 | 정산 상세 | 금액·지급 | 2026-07 집계` 4열 표시
- 2026-07 정산 1건 선택:
  - 계약번호·계약일·계약자·차량·공급사·영업자·영업채널 표시
  - 월대여료 890,000 / R1 89,000 / R2 35,600 / 순수익 53,400 표시
  - 월 집계와 공급사별 소계 표시
- VAT 정산서 오버레이 진입 및 월별 정산 화면 복귀 PASS
- `/members`, `/settlement` HTTP 200

### 자동 검증

- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 드리프트 0
- `scripts/sim-*.mts` 12개: 전부 PASS
  - 영업자 39/39, 권한 44/44, 채팅 Rules 40/40
  - 계약 Rules 25/25, 전자서명 57/57, 3자 정산 15/15
  - 생애주기 PASS, Phase 1·2 25/25
  - 상품 private 15/15, 정산 private 12/12
  - 시트 병합 12/12, 차량 잠금 23/23
- `NEXT_DIST_DIR=tmp/verification-build/four-panel-20260727 npm.cmd run build`: PASS
  - 28개 라우트
  - `/members` 9.03kB
  - `/settlement` 10.1kB
- Next 빌드가 추가한 임시 `tsconfig.json` include/포맷 변경은 원상복구했다.
- 실행 중 개발 서버의 `.next`는 건드리지 않았고 PID `30312` 유지.

---

## 2026-07-28 — 계약 규격 복구 및 모바일 아이콘 버튼 통일

### 변경

- 계약 목록 위에 임의로 추가됐던 `대기·완료·환수·순수익` 요약줄과
  `features/contract/SettlementSummary.tsx`를 제거했다.
- 계약 화면은 다시 `목록 1 + 업무 패널 3`만 표시하며, 정산 집계는 월별 정산 화면에서 담당한다.
- 공통 뒤로가기, 검색 초기화, 패널 전환, 하단 CRUD, 채팅 전송 버튼을 모바일에서
  아이콘 전용으로 표시하고 모든 버튼에 접근성 이름을 유지했다.
- 계약 승인·상태 변경처럼 오동작 위험이 있는 업무 버튼, 앱 하단 내비게이션,
  카테고리·상태 선택은 의미 전달을 위해 텍스트 라벨을 유지했다.
- `scripts/sim-phase12.mts`에 계약 요약줄 재삽입 방지와 공통 모바일 아이콘 규격 검사를 추가했다.

### 확인

- 브라우저 `/contract`: 규격 외 요약줄 미표시, 계약 목록과 3개 업무 패널 정상 표시
- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 드리프트 0
- `scripts/sim-phase12.mts`: 30/30 PASS
- `scripts/sim-*.mts` 12개: 전부 PASS
- `NEXT_DIST_DIR=tmp/verification-build/mobile-icons-20260728 npm.cmd run build`: PASS
  - 28개 라우트
  - `/contract` 4.68kB, `/chat` 8.45kB, `/settlement` 10.5kB
- production build가 추가한 임시 `tsconfig.json` include/포맷 변경은 원상복구했다.
- 모바일 아이콘 분기는 `useIsMobile()` 내부에 한정하고 데스크톱 텍스트 버튼은 유지했다.

---

## 2026-07-28 — 모바일 표면 액션 아이콘 전용 2차 통일

### 변경

- 위 절의 “계약 승인·상태 변경은 모바일 텍스트 유지” 판단은 사용자 지시에 따라 폐기했다.
- 공통 `Btn.mobileIcon`으로 모바일은 아이콘, 웹은 기존 텍스트를 렌더링한다.
- 계약·전자서명·정산, 재고·OCR·시트 연동·사진, 채팅, 회원 승인, 설정,
  관심함, 목록 초기화·더보기·전체보기 액션을 모바일 아이콘 전용으로 통일했다.
- 모바일 상품·계약 엑셀, 월정산 정산서, 재고 종합표 내보내기를 노출하지 않는다.
- 선택 칩·탭·확인 대화상자는 텍스트를 유지한다.

### 확인

- 브라우저 `/contract`: 웹 계약 액션 텍스트와 4프레임 유지
- 브라우저 `/settings`: 웹 저장·비밀번호 변경 텍스트 유지
- `npm.cmd run typecheck`: PASS
- `npm.cmd run check:fonts`: PASS, 드리프트 0
- `scripts/sim-phase12.mts`: 33/33 PASS
- `scripts/sim-*.mts` 12개: 전부 PASS
- `NEXT_DIST_DIR=tmp/verification-build/mobile-icon-actions-20260728 npm.cmd run build`: PASS
  - 28개 라우트
  - `/contract` 4.73kB, `/inventory` 22.6kB, `/members` 9.22kB
- production build가 추가한 임시 `tsconfig.json` include/포맷 변경은 원상복구했다.
- 실행 중 개발 서버는 재시작하지 않았다.

---
