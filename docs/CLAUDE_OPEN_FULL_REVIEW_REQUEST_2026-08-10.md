# Claude 전체 검수 요청 — Production 오픈 Go/No-Go (2026-08-10)

> **작성:** Cursor (노가다·실측·로컬 게이트 스냅샷)  
> **요청:** Claude = 위험영역 게이트·최종 go / conditional go / no-go  
> **사용자 지시:** 「오픈은 아직 아닌 이유」를 코드베이스에 적어 두고 Claude에게 전체 검수

`AGENTS.md` · `docs/AI_COLLABORATION.md` · `CLAUDE.md` · `.cursorrules` · `LAUNCH_GONOGO.md` 를 먼저 읽는다.

---

## 1. 요청 범위

**질문 하나:** 지금 이 저장소/운영 상태에서 `freepasserp.com` 을 freepasserp4 로 열어( alias 전환 포함 )도 되는가.

- Cursor 임시 판정(2026-08-10): **NO-GO** — 근거는 §3. UI/코드 “안 돌아서”가 아니라 **실서비스 스위치·Rules 순서·도메인·브랜치** 문제.
- Claude는 Cursor 판정을 그대로 따르지 말고, **사용자 원래 요구(실서비스 오픈 안전)** 기준으로 독립 재검수한다.
- **하지 말 것(검수 단계):** `database.rules.json` 게시 · RTDB write · Production env 무단 변경 · custom-domain alias 전환 · force-push.

---

## 2. Cursor가 남긴 점검 스냅샷 (재실행 가능)

기준 시각: **2026-08-10** · 브랜치 `work/2026-08-09-trim-esign` (origin 대비 ahead 가능 · dirty 파일 있을 수 있음 → 검수 시 `git status` 재확인).

### 2-1. 로컬 게이트

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run check:release` | **PASS** · 차단 0 · 경고 2 | 재동의 OFF · 서비스워커 없음 |
| `npm run check:b2b-release` | **NO-GO** · PASS 50 · **FAIL 5** | 아래 FAIL 목록 |
| `npx tsc --noEmit` | 최근 Cursor 작업 시 통과 | 검수 시 재실행 |
| `npm run check:fonts` / `check:tokens` | 드리프트 0 | 동일 |

**`check:b2b-release` FAIL 5 (로컬 `.env.local` 기준):**

1. 기존 회원 약관 재동의 게이트 ON (`NEXT_PUBLIC_REQUIRE_LEGAL_RECONSENT`)
2. 서버 전용 `FIREBASE_SERVICE_ACCOUNT_JSON` 유효 형식
3. 차량 원자 선점 서버 kill switch ON (`VEHICLE_CLAIM_SERVER_ENABLED`)
4. 차량 원자 선점 클라이언트 경로 ON (`NEXT_PUBLIC_ATOMIC_VEHICLE_CLAIMS`)
5. 아이언 홈페이지 재고 연동 ON (`IRONRENTCAR_SYNC_ENABLED` 계열)

→ Cursor 해석: **코드 부재가 아니라 Production/로컬에 오픈용 스위치가 꺼져 있음.** Preview에만 켠 이력이 있으면 Production과 분리해서 볼 것 (`HANDOFF.md` · `LAUNCH_GONOGO.md`).

### 2-2. 브라우저 규격실측 (Cursor · UI/기능 변경 없음)

- **`:4004` (운영 Firebase 붙는 로컬):** 영업자·둘러보기 기준 `/` · `/chat` · `/contract` · `/settings` · 모바일 390 입력 **16px** · 컨트롤 높이 규격 · 계약문의/계약진행 **4패널** OK. `/inventory` 는 영업자 권한 게이트 정상.
- **`:4005` QA (Firebase env 분리·시드):** 공급사 재고 4패널·상세, 관리자 정책/정산/회원 골격 OK. 모바일 재고 입력 16px OK.
- **수정한 것만:** 회원 상태 필터 `승인대기` 칩 중복 (`app/members/page.tsx` — `MEM_ACTIVE`에 이미 pending 있는데 append 하던 회귀). `sim-member-display` 10/10.
- **의도적 비수정:** 회원 4패널(페이지 주석상 HANDOFF 정렬) vs `.cursorrules` 「회원=1패널」 문구 불일치 — **설계 판단 필요**. 시드 `재렌트`↔목록 `중고렌트` 는 `canonProductType` 정상. Next Dev Issues 배지는 무시.

### 2-3. 문서상 잔여 오픈 게이트 (LAUNCH_GONOGO · HANDOFF · VERIFICATION)

런북 정본: `LAUNCH_GONOGO.md` (2026-08-04 기준 **NO-GO** 유지로 기록됨). Cursor가 2026-08-10에 로컬로 재확인한 핵심:

| # | 게이트 | Cursor 관찰 | 왜 오픈을 막는가 |
|---|---|---|---|
| A | Production 서비스계정 + 선점 2플래그 | b2b-release FAIL | 없으면 claim API·브리지 서버 경로 실패-폐쇄 / 구 경로 의존 |
| B | 후보 Rules 게시 순서 | 운영 Rules 미게시 · 후보만 존재 | **플래그 OFF + Rules 게시 = 계약금 입금·입금확인 전면 401** (RTDB 단일 인스턴스). 순서 SSOT = `LAUNCH_GONOGO.md` §1-1 · `CLAUDE_GATE_VEHICLE_CLAIM_2026-08-04.md` |
| C | 도메인 | `freepasserp.com` → **fp3** | fp4 Production alias 전환 전 “오픈” 아님 |
| D | 5역할·계약금 실계정 smoke | 문서상 미완 / QA 토큰 의존 | 읽기만 통과해도 쓰기·경쟁 선점 미검증이면 GO 불가 |
| E | 재동의 Production | 로컬 OFF · Preview 이력만 | 기존 회원 법적 증적 |
| F | 아이언 28건 반영 | 플래그/관리자 적용 대기 | 오픈 범위에 포함되면 필수 |
| G | ERP3 절연 | HANDOFF: v3-only·브리지 잔존 | “fp4 단독 오픈”이면 별도 조건. B2B만이면 범위 명시 필요 |
| H | 작업 브랜치 | trim/esign 작업선 · dirty | **main 오픈 후보 아님** — 머지·클린 상태 재정의 필요 |

### 2-4. 전자계약 «약관» 크로스체크 (착한거래 연동 · Cursor 2026-08-10)

착한거래 오픈 논의에서 말한 **약관** = 플랫폼 이용약관이 아니라  
**손님이 서명 전 통독하는 자동차 렌탈(대여) 약관**이다.

| # | 확인할 것 | 경로 / 명령 |
|---|---|---|
| 1 | 인쇄·PDF 정본 | `public/contract-template/rental-contract.html` |
| 2 | 착한거래 전송 조문 SSOT | `lib/domain/esign-agreement-text.ts` (`AGREEMENT_VERSION`) |
| 3 | payload 포장 · `isSample` | `lib/domain/esign-consent-doc.ts` → `SAMPLE_AGREEMENT` (**실발송이면 false**) |
| 4 | 발행 시 실어 보내는 곳 | `lib/domain/chakhandeal-esign.ts` → `agreement` |
| 5 | HTML↔전송본 일치 회귀 | `scripts/sim-esign-agreement.mts` |
| 6 | 법률·금전 후보 문구 go/no-go | `docs/CONTRACT_REPLACEMENT_REVIEW_2026-08-10.md` |
| 7 | 착한거래 수신·화면 | `C:\dev\chakhandeal` — `agreement.sections` 재포맷 금지, `isSample` 배지 |

**판정 시 질문:**  
① 1·2·3번이 같은 version·같은 조문인가.  
② `isSample:false` 인데 Claude/사람 게이트(CONTRACT_REPLACEMENT §Claude)를 아직 안 통과했으면 **실손님 발송 NO-GO**.  
③ 샘플 배지/`isSample:true` 잔존이 있으면 실계약 경로에서 차단되는가.

---

## 3. Cursor가 “아직 오픈 아님”이라고 한 이유 (한 장)

1. **앱 UI가 깨져서가 아님** — 최근 브라우저 실측상 업무 골격·모바일 입력 규격은 큰 결함 없음.  
2. **실서비스 스위치가 꺼져 있음** — 서비스계정·선점·재동의·아이언이 Production(및 로컬 b2b 게이트)에서 FAIL.  
3. **Rules를 지금 올리면 딜 사망 가능** — 후보 Rules는 선점 필드를 서버 단일 writer로 잠금. Production 플래그 OFF면 클라 직접쓰기 → 401. Preview ON으로는 이 사고를 못 잡음.  
4. **손님 도메인이 아직 fp3** — alias 전 오픈 선언 불가.  
5. **현재 브랜치/미커밋 ≠ 출시 산출물** — 출시 대상 커밋·환경·스모크를 Claude가 다시 못 박아야 함.

---

## 4. Claude 필수 검토 질문

1. `LAUNCH_GONOGO.md` §1·§1-1 순서가 2026-08-10 코드/환경과 여전히 맞는가. 바뀐 플래그·브리지·claim 경로가 있으면 런북 수정이 필요한가.  
2. `npm run check:b2b-release` FAIL 5가 **의도적 안전 OFF**인지, **누락(사고)** 인지 Production/Preview를 구분해 판정.  
3. 후보 Rules(`scripts/ruleprobe/release-candidate.rules.json`)를 운영에 게시할 **최소 선행 조건**과, 게시 직후 필수 smoke 목록.  
4. `freepasserp.com` alias를 fp4로 옮기기 전 **필수 통과 커밋·배포 ID·env** 체크리스트.  
5. B2B 제한 오픈 vs 손님 포함 전체 오픈 — 사용자 범위가 어느 쪽인지 문서와 코드 게이트가 일치하는가.  
6. ERP3 브리지/v3-only 잔존이 B2B 오픈을 차단하는가, 아니면 조건부 허용인가.  
7. 회원관리 4패널 vs `.cursorrules` 1패널 — 규격 드리프트로 오픈 차단인가, 문서만 고칠 일인가.  
8. Cursor의 회원 `승인대기` 중복 수정이 안전한가 (`app/members/page.tsx`).  
9. 차종마스터·시트·esign 등 **작업 브랜치 미머지 변경**이 오픈 경로에 끼면 안 되는지 분리 권고.  
10. **전자계약 약관 삼각 일치**(§2-4): HTML 정본 ↔ `esign-agreement-text` ↔ 착한거래 payload · `isSample` · CONTRACT_REPLACEMENT 법률 게이트.  
11. 최종 판정과 **다음 한 사람/한 명령** (Cursor에게 시킬 노가다 vs 사람만 할 일).

---

## 5. 집중 읽기 파일

| 구분 | 경로 |
|---|---|
| 런북 | `LAUNCH_GONOGO.md` |
| 선점 순서 게이트 | `docs/CLAUDE_GATE_VEHICLE_CLAIM_2026-08-04.md` (있으면) · `lib/firebase/vehicle-claim-client.ts` |
| 출시 스크립트 | `scripts/check-release.mts` · `scripts/check-b2b-release.mts` |
| 후보 Rules | `scripts/ruleprobe/release-candidate.rules.json` · (운영) `database.rules.json` **게시 금지** |
| 인증·게이트 | `lib/auth-context.tsx` · `lib/auth-session.ts` · `lib/legal.ts` |
| 인수 | `HANDOFF.md` · `VERIFICATION.md` (Codex 최상단) · `CURSOR-STATUS.md` |
| Cursor 실측 수정 | `app/members/page.tsx` (승인대기 칩) |
| 전자계약 약관 | `lib/domain/esign-agreement-text.ts` · `esign-consent-doc.ts`(`SAMPLE_AGREEMENT`) · `chakhandeal-esign.ts` · `docs/CONTRACT_REPLACEMENT_REVIEW_2026-08-10.md` · `scripts/sim-esign-agreement.mts` |

---

## 6. Claude가 제출할 판정 형식

1. 최종 판정: `GO` / `CONDITIONAL GO` / `NO-GO`  
2. 오픈 차단 이슈 (코드·env·Rules·도메인·데이터) + 근거 경로  
3. Cursor §3 이유 중 **동의 / 기각 / 수정**  
4. 코드로 고칠 것 vs 운영 절차만으로 풀 것  
5. Preview 조건 · Rules 게시 조건 · Production alias 조건 (순서 고정)  
6. Cursor에게 맡길 다음 오더 3줄 이내 (설계 판단 넣지 말 것)

판정은 가능하면 `CLAUDE_REVIEW_OPEN_FULL_2026-08-10.md` 로 남긴다.
