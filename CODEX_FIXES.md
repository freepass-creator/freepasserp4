# freepasserp4 수정 기록

기준: `CODEX_DIAGNOSIS.md`의 confirmed 항목 중 WRITE 무결성과 명확한 코드 버그만 수정했다. 사용자가 의도적으로 개방한 `v4/products`, `v4/contracts`, `v4/rooms`, `v4/messages`, `v4/partners_private`, `v4/users`의 READ 규칙은 변경하지 않았다. Firebase 규칙은 파일만 변경했으며 실제 프로젝트에는 게시하지 않았다.

## 완료

### #11 정산 임포트 음수 부호 보존

- 파일:라인: `lib/domain/settlement-import.ts:9-18`
- 뭘 바꿨나: 숫자형 음수를 0으로 버리던 처리를 제거하고, 문자열의 선행 `-`와 회계식 괄호 음수 `(100,000)`를 보존하도록 변경했다. 그 밖의 통화 기호와 구분자는 제거하되 부호는 유지한다.
- 검증:
  - `npx tsc --noEmit`: 통과.
  - 타깃 실행: `-100,000원 → -100000`, `(200,000) → -200000` 확인.
- 게시 필요 여부: 없음.

### #12 이미지 프록시 redirect SSRF 방어

- 파일:라인: `app/api/img/route.ts:1-39`, `lib/net/proxy-hosts.ts:27-38`
- 뭘 바꿨나: 자동 리다이렉트 추적을 제거하고 `redirect: "manual"`로 최대 5홉을 직접 처리한다. 최초 URL과 매 리다이렉트 URL마다 이미지 호스트 allowlist를 다시 검사하고, DNS A/AAAA 결과 중 하나라도 loopback, private, link-local, CGNAT, multicast/reserved 범위이면 거부한다. fetch에 12초 timeout도 추가했다.
- 검증:
  - `npx tsc --noEmit`: 통과.
  - IP 분류 타깃 실행: `127.0.0.1`, `10.0.0.1`, `169.254.169.254`, `192.168.1.1`, `::1`, `fd00::1` 차단 및 공인 IPv4/IPv6 허용 확인.
- 게시 필요 여부: Vercel 애플리케이션 배포 필요. Firebase 규칙 게시와는 무관.

### #15 계약·정산 RTDB 읽기 오류와 빈 목록 구분

- 파일:라인: `lib/firebase/rtdb-adapter.ts:407-429`, `app/contract/page.tsx:56-83,131-139,300-310`, `app/settlement/page.tsx:29-48,91-94`
- 뭘 바꿨나: `contract`와 `settlement` read 오류는 어댑터에서 빈 배열로 삼키지 않고 호출부로 전파한다. 계약·정산 화면은 이 경우 0건/0원 합계를 렌더링하지 않고 오류 내용과 `다시 시도` 버튼을 표시한다. 비핵심 엔티티의 기존 best-effort 빈 배열 동작은 보존했다.
- 검증:
  - `npx tsc --noEmit`: 통과.
  - 코드 경로 확인: critical entity의 `readNode` rejection이 `merged()`에서 재throw되고 두 화면의 오류 상태로 전달됨.
- 게시 필요 여부: Vercel 애플리케이션 배포 필요.

### #5 `v4/settlements` 가짜 생성·금액/상태 조작 차단

- 파일:라인: `database.rules.json:189-199`
- 뭘 바꿨나:
  - 관리자 외 사용자는 기존 정산을 수정할 수 없고 신규 정산만 생성할 수 있게 했다.
  - 신규 키를 `ST_{contract_code}`로 강제하고 실제 `v4/contracts/{contract_code}` 존재를 요구한다.
  - 공급사는 자기 `company_code`, 영업자는 계약의 자기 `agent_uid` 또는 `agent_code`에 해당할 때만 생성 가능하다.
  - 계약의 공급사·영업자·채널·월대여료·동결 수수료율과 신규 정산 값을 대조한다.
  - `fee_amount`와 `agent_payout`은 앱의 `Math.round()` 결과와 일치하는 정수만, `net_amount = fee_amount - agent_payout`, 최초 상태 `정산대기`, 환수액 0만 허용한다.
- 검증:
  - Firebase RTDB Emulator가 규칙 파일을 실제 파싱·로드함.
  - 정상 영업자의 자기 계약 정산 `ST_C1` 생성: 통과.
  - `FAKE` 키 가짜 정산 생성: 거부.
  - 일반 영업자의 기존 정산 `정산완료` 상태 조작: 거부.
  - `npx tsc --noEmit`: 통과.
- 게시 필요 여부: **필요. `database.rules.json`은 아직 게시하지 않았다. 게시 전 Firebase Rules Simulator/Emulator 재검증 필요 + 정당 write 통과 확인 필요.** 이번 로컬 에뮬레이터에서는 정당 영업자 생성 통과를 확인했다.

### #1 `contract_sign` 비인증 제출 제한

- 파일:라인: `database.rules.json:84-88`
- 뭘 바꿨나:
  - 비인증 write는 기존 상태가 `sent`이고 새 상태가 `pending_review`인 한 번의 제출 전이만 허용한다.
  - `sign_token`, `contract_code`, 렌트/보증금/기간 스냅샷, 상품·차량·회사 필드는 기존값과 같아야 한다.
  - 고객명·전화·선택 PII의 타입/길이, 서명 이미지 100~500,000자, 동의 문자열 500자 이하를 검증한다.
  - 인증된 기존 발송·승인·반려 흐름은 보존했다.
- 검증:
  - 정상 비인증 `sent → pending_review` 제출: 통과.
  - 동일 제출에서 `rent_amount_snapshot` 변조: 거부.
  - Firebase RTDB Emulator 규칙 파싱·로드: 통과.
  - `npx tsc --noEmit`: 통과.
- 게시 필요 여부: **필요. `database.rules.json`은 아직 게시하지 않았다. 게시 전 Firebase Rules Simulator/Emulator 재검증 필요 + 정당 write 통과 확인 필요.** 이번 로컬 에뮬레이터에서는 정상 공개 제출 통과를 확인했다.

### #2 `v4/contracts` write 소유권·핵심 스냅샷 불변

- 파일:라인: `database.rules.json:204-211`
- 뭘 바꿨나:
  - 관리자는 전체 write를 유지한다.
  - 공급사는 자기 `company_code`와 계약 `provider_company_code`가 일치하는 계약만 생성·수정할 수 있다.
  - 영업자는 자기 UID 또는 `user_code`와 계약의 `agent_uid`/`agent_code`가 일치하는 계약만 생성·수정할 수 있다.
  - 생성 후 공급사, 영업자 UID/코드/채널, 상품코드, 렌트·보증금·기간, 동결 공급사율·영업자율을 불변으로 강제한다.
  - READ 규칙은 변경하지 않았다.
- 검증:
  - 정상 영업자의 자기 계약 생성: 통과.
  - 정상 P1 공급사의 자기 계약 단계 업데이트: 통과.
  - P2 공급사의 P1 계약 업데이트: 거부.
  - 영업자의 기존 계약 `rent_amount_snapshot` 변조: 거부.
  - Firebase RTDB Emulator 규칙 파싱·로드: 통과.
  - `npx tsc --noEmit`: 통과.
- 게시 필요 여부: **필요. `database.rules.json`은 아직 게시하지 않았다. 게시 전 Firebase Rules Simulator/Emulator 재검증 필요 + 정당 write 통과 확인 필요.** 이번 로컬 에뮬레이터에서는 정당 영업자 생성과 자기 공급사 업데이트 통과를 확인했다.

## 규칙 시뮬레이션 결과

- 도구: Firebase CLI 15.24.0 + Realtime Database Emulator 4.11.2 + `@firebase/rules-unit-testing`.
- 결과: 예상 allow/deny 9개 중 9개 통과.
- 정상 허용:
  1. 영업자의 자기 계약 생성.
  2. 공급사의 자기 계약 단계 업데이트.
  3. 영업자의 자기 계약 기반 정산 생성.
  4. 비인증 고객의 정상 서명 제출.
- 공격 차단:
  1. 타 공급사 계약 업데이트.
  2. 계약 금액 스냅샷 변경.
  3. 가짜 키 정산 생성.
  4. 일반 사용자의 기존 정산 상태 변경.
  5. 비인증 서명 제출의 계약 금액 변조.
- 주의: 로컬 에뮬레이터 검증은 실제 게시를 대신하지 않는다. 콘솔 게시 전 프로젝트 데이터의 실제 역할값·레거시 필드 형태로 Simulator를 한 번 더 실행해야 한다.

## 결정 필요 — 수정하지 않음

### #3 `v4/products` write 소유권과 영업자 락 필드 제한

- 파일:라인: `database.rules.json:143-146`, `lib/firebase/rtdb-adapter.ts:501-522`
- 결정 필요: 공급사 전체 매물 편집과 영업자의 `vehicle_status`/`locked_by_contract` 부분 write가 동일 노드에서 일어난다. 부모 `.write`를 유지하면 영업자 임의 필드 추가를 막을 수 없고, 자식 wildcard 규칙으로 전환하려면 매물 전체 허용 필드 스키마와 레거시 필드 목록을 확정해야 한다. 불완전한 allowlist는 정상 시트 동기화·사진·마스터 스냅 write를 차단하므로 이번 수정에서는 건드리지 않았다.
- 권장 결정: (A) 매물 필드 전체 allowlist를 확정해 자식별 write 규칙으로 전환하거나, (B) 계약 락을 `v4/product_locks/{product_code}` 별도 노드로 분리해 영업자는 락 노드만 쓰게 한다. B가 규칙과 원자성 측면에서 안전하다.
- 검증: 변경 없음.
- 게시 필요 여부: 없음.

### #8/#9/#10 완료·취소·정산·차량락 원자성

- 파일:라인: `lib/domain/settlement-engine.ts:75-93,188-260`, `lib/firebase/rtdb-adapter.ts:484-540`
- 결정 필요: single multi-location update와 transaction을 동시에 적용하려면 StoreAdapter에 원자 도메인 연산을 추가하고 Local/Firestore/RTDB 세 구현의 계약을 바꿔야 한다. 특히 상품 락 transaction과 계약·정산 multi-update의 커밋 순서 및 복구 정책을 먼저 결정해야 해 단순 안전 패치 범위를 넘는다.
- 권장 결정: `claimVehicle`, `completeContract`, `cancelContract`를 StoreAdapter 원자 연산으로 명시하고 RTDB는 transaction + operation ID/대사 상태를 사용한다.
- 검증: 변경 없음.
- 게시 필요 여부: 없음.

### #13/#14 프록시·OCR rate limit

- 파일:라인: `app/api/img/route.ts`, `app/api/sheet/route.ts`, `app/api/extract-photos/route.ts`, `app/api/ocr/extract/route.ts`
- 결정 필요: Vercel KV/Firewall, 인메모리 제한, Firebase ID token 중 어떤 운영 인프라를 사용할지 정해지지 않았다. 서버리스 인메모리 rate limit은 인스턴스 간 일관성이 없어 보안 통제로 과신할 수 있으므로 추가하지 않았다. OCR은 dev 전용 의도 가능성 있음.
- 검증: 변경 없음.
- 게시 필요 여부: 없음.

### #16 메시지 팬아웃

- 파일:라인: `lib/firebase/rtdb-adapter.ts:200-222,400-409`
- 결정 필요: 마지막 메시지/미읽음 요약 비정규화와 v3/v4 브리지 종료 시점을 정해야 한다. 데이터 모델 변경 없이 요청만 줄이면 레거시 메시지 누락 가능성이 있어 수정하지 않았다.
- 검증: 변경 없음.
- 게시 필요 여부: 없음.

### #17 접근성 키보드

- 파일:라인: `components/ChatThread.tsx:96,130`, `components/ContractDocs.tsx:163-167,187`
- 결정 필요: 없음. 다만 P0/P1 무결성 범위와 무관하고 모달 포커스 관리까지 함께 검증할 UI 작업이어서 이번 변경 묶음에는 포함하지 않았다.
- 검증: 변경 없음.
- 게시 필요 여부: 없음.

## 최종 검증

- `npx tsc --noEmit`: 통과.
- `database.rules.json` JSON 파싱: 통과.
- Firebase RTDB Emulator 규칙 컴파일/로드: 통과.
- RTDB 정상·공격 write 시뮬레이션: 9/9 통과.
- 정산 음수 파싱 타깃 테스트: 통과.
- 프록시 private/loopback IP 분류 타깃 테스트: 통과.
- READ 규칙 변경: 없음.
- Firebase 규칙 실제 게시: 수행하지 않음.
