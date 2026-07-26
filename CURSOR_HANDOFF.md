# CURSOR_HANDOFF — 오픈 전 실사용 QA (2026-07-26)

> Cursor 레인. 신규 기능·구조 변경 없음. Firebase Rules / 스키마 / 마이그레이션 / 전자서명 상태기계 미수정.
> `:4004` 유지 · production build 미실행.

## 검증 범위(화면)

로그인 · 재고(목록·상세·등록·수정) · 채팅 · 계약 진행 · 전자서명 · 정산 · 회원관리 · 설정 · 모바일(390×844)

## 발견한 문제

1. **채팅 보내기/첨부 중복 클릭** — `ChatThread`에 busy 가드 없음 → 연속 전송 가능
2. **전자서명 제출 실패 무음** — `submit`이 `try/finally`만 있고 `catch` 없음 → 실패 시 토스트 없이 busy만 해제
3. **계약 단계 체크 중복 클릭** — `ContractPanel.setCheck`에 busy 없음 → `applyStepCheck` 레이스
4. **설정 연락처 포맷 불일치** — 프로필 전화에 `fmtPhone` 미적용 (로그인·서명·계약은 적용됨)
5. **설정 비밀번호 재설정 메일 중복 클릭** — busy 가드 없음
6. **회원 저장 중복 클릭** — dirty만 막고 in-flight 잠금 없음
7. **회원 파트너 저장 후 fee_rate 폼 공백** — private 이관 후 `fee_rate: null`로 저장된 폼이 그대로 → enrich된 목록과 상세 불일치
8. **회원 승인/승인취소 중복 클릭** — busy 없음
9. **재고 저장 중복 클릭** — dirty만 막고 in-flight 잠금 없음
10. **데스크톱 홈 엑셀 보기 가로 스크롤** — `scrollWidth > clientWidth` (엑셀 시트 의도적 가능)
11. **설정 화면에서 세션 폼 미노출 순간** — TopBar는 `박영협`인데 설정은 `로그인`/데모 역할만 보인 스냅샷 1회 (auth 타이밍·게이트 애매)
12. **채팅 목록에 “삭제된 차량” 다수** — 데이터/표기 정책 이슈로 보임 (기능 버그 단정 불가)
13. **계약/정산 상태 버튼·xlsx 가져오기 busy** — 정적 리뷰상 이중 클릭 가능하나, 이번엔 범위 밖으로 보류

## 수정한 문제

| # | 내용 | 파일 |
|---|------|------|
| 1 | 채팅 전송·첨부 busy + 버튼/입력 disabled | `components/ChatThread.tsx` |
| 2 | 서명 제출 `catch` + toast | `app/sign/[token]/page.tsx` |
| 3 | 계약 단계 `setCheck` busy + 버튼 disabled | `components/ContractPanel.tsx` |
| 4 | 설정 연락처 `fmtPhone` | `app/settings/page.tsx` |
| 5 | 설정 비밀번호 메일 `pwdBusy` | `app/settings/page.tsx` |
| 6–8 | 회원 저장/승인 busy + 저장 후 enrich 행으로 폼 재주입 | `app/members/page.tsx` |
| 9 | 재고 저장 `saving` + PageActions disabled | `features/inventory/useInventoryEditorLifecycle.ts`, `app/inventory/page.tsx` |

## 수정하지 않은 문제와 이유

| 문제 | 이유 |
|------|------|
| 홈 엑셀 가로 넘침 | 엑셀 시트 고밀도 뷰의 의도적 스크롤로 보임 — 디자인/기능 변경 금지 |
| 설정 세션 폼 미노출(1회) | 재현 불안정·auth 타이밍 가능. Rules/세션 구조 손대면 범위 초과 |
| “삭제된 차량” 채팅 표기 | 데이터 잔존 vs UI 정책 애매 — 스키마/정리 로직 변경 금지 |
| 계약 페이지 상태 버튼·정산 import busy | 엔진/정산 흐름과 인접. 작은 수정이라도 오탐 위험 → Codex 재검증 후 결정 |
| `ContractSign` 로딩 `null` | 빈 화면 vs 미존재 구분 애매 |
| 장식 `img alt=""` | 기능 장애 아님. a11y 전면 정리는 범위 밖 |
| 채팅 enrich `catch` 삼킴 | 의도적 progressive load 주석 — 오류 UI 추가는 새 기능 |

## 변경 파일

- `components/ChatThread.tsx`
- `components/ContractPanel.tsx`
- `app/sign/[token]/page.tsx`
- `app/settings/page.tsx`
- `app/members/page.tsx`
- `app/inventory/page.tsx`
- `features/inventory/useInventoryEditorLifecycle.ts`
- `CURSOR_HANDOFF.md` (본 문서)

## 실행한 검증

- `npm run typecheck` — PASS
- `npx tsx scripts/sim-agent.mts` — 39/39 PASS
- `npx tsx scripts/sim-lifecycle.mts` — PASS
- `npx tsx scripts/sim-e2e-settlement.mts` — 15/15 PASS
- `npx tsx scripts/sim-vehicle-lock.mts` — 23/23 PASS
- `npx tsx scripts/sim-authorization.mts` — 44/44 PASS
- HTTP 스모크 `:4004` — `/` `/login` `/inventory` `/chat` `/contract` `/settlement` `/members` `/settings` `/m` `/sign/invalid-test-token` 모두 200
- 브라우저: 로그인 세션(박영협) 기준 목록·정산 빈상태·서명 무효토큰 문구·모바일 390 홈/재고 가로넘침 없음 확인
- `git diff --check` — PASS (LF/CRLF warning만, whitespace error 없음)
- **production build 미실행** (요청)

## Codex가 재검증해야 할 항목

1. **채팅** — 빠른 연타/Enter로 메시지·첨부 1회만 나가는지, 실패 토스트 유지
2. **전자서명** — 잘못된 입력·규칙 거부 시 오류 toast + busy 해제 (상태기계는 건드리지 않음)
3. **계약진행** — 단계 체크 yes/no 연타 시 `applyStepCheck` 1회·UI 갱신
4. **설정** — 연락처 하이픈 포맷, 비밀번호 메일 연타 1회
5. **회원** — 파트너 `fee_rate` 저장 후 상세에 요율 유지(private enrich), 승인 연타
6. **재고** — 저장 연타 시 단일 쓰기·“저장 중…” 표시
7. **설정 세션 폼** — 새로고침·재진입 시 프로필 입력란 안정 노출 여부 (미수정 이슈)
8. **역할별 권한 버튼** — 영업자/공급사/손님에서 회원·정산·재고 액션 노출이 게이트와 일치하는지 (브라우저 수동)
9. **모바일** — `/contract` `/settlement` `/chat` `/settings` 가로 넘침·바텀시트/모달 뷰포트 이탈 (Emulation으로 일부만 확인)
10. **콘솔** — 수정 화면에서 unhandledrejection / Next overlay 실제 에러 유무 (Dev Tools portal은 상시 존재)

## Codex 독립 검증

- 판정: **PASS**
- 원래 범위와 diff 비교: 신규 기능·Rules·스키마·상태기계 변경 없음
- busy 상태는 성공·실패·조기 반환 경로에서 `finally`로 해제됨
- 회원 저장 후 private enrich 행 재주입 경로 확인
- typecheck·폰트 검사 PASS
- 전체 권한·채팅·계약·서명·정산·생애주기·차량잠금·마이그레이션 시뮬레이션 PASS
- production build PASS: 26개 페이지
- 서버 복구 후 수정 화면 8개 경로 HTTP 200
- 포트 4004 개발 서버 유지
- 후속 Chrome 연결 검증:
  - 로그인 표시 이름 `박영협`과 localhost ERP4 탭 연결 성공
  - 390×844에서 재고·채팅·계약·정산·설정 가로 넘침 없음
  - JavaScript error 없음
  - 설정 화면은 `로그인` 버튼과 무프로필 입력 상태여서 Firebase 인증 세션은 확인되지 않음
  - `products_private`, `settlement private` 조회가 Permission denied로 반복됨
  - 실제 쓰기를 발생시키는 연타 검증은 운영 데이터 부작용을 피하기 위해 미실행
