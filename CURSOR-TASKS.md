# Cursor 자동 작업지시서

**이 파일은 Claude 소유다. Cursor는 읽기만 한다. 절대 수정하지 마라.**
상태 기록은 `CURSOR-STATUS.md`(Cursor 소유)에 한다.

규격 = `CLAUDE.md`. 두 AI가 같은 저장소에서 동시에 일한다.

---

## 🔁 실행 프로토콜 — 이 순서를 반복한다

```
1. 이 파일(CURSOR-TASKS.md)을 처음부터 다시 읽는다.   ← Claude가 수시로 갱신한다. 캐시된 기억을 믿지 마라.
2. CURSOR-STATUS.md 를 읽어 어디까지 했는지 확인한다.
3. 아래 "잠금판"을 확인한다. 🔒 인 태스크는 건너뛴다.
4. 열려있는(⬜) 태스크 중 번호가 가장 낮은 것 하나를 수행한다.
5. npx tsc --noEmit → 0 확인. npm run check:tokens 통과 확인. 아니면 고친다. 못 고치면 되돌리고 6-b.
6-a. 성공: 커밋 → CURSOR-STATUS.md 에 완료 줄 추가 → 1번으로 돌아간다.
6-b. 실패/막힘: 변경 되돌리고 CURSOR-STATUS.md 의 "막힘" 항목에 기록 → 그 태스크는 건너뛰고 1번으로.
7. 열린 태스크가 없으면 CURSOR-STATUS.md 에 "대기중" 기록하고 정지한다.
```

**정지 조건** (아래 중 하나면 즉시 멈추고 STATUS에 기록):
- 열린 태스크 없음
- 같은 태스크에서 2회 연속 실패
- 지시서에 없는 판단이 필요함 (설계 결정·기능 변경·삭제 여부 애매)
- 잠금 태스크를 건드려야만 끝낼 수 있음

**막혔을 때 추측으로 진행하지 마라.** 기록하고 넘어가는 것이 정답이다.

**지킬 것**
- 한 번에 한 태스크. 여러 개 묶어서 커밋하지 마라.
- **JSX 자식 위치에 `//` 주석 금지.** 화면에 글자로 그대로 찍힌다(2026-07-31 재고관리에서 실제 발생, 배포까지 나갔다). `{/* */}` 만 쓴다.
- 새 숫자를 만들지 마라. 간격·크기·색은 `components/ui/tokens.ts` 에서 파생시킨다.
- B2B 밀도 원칙: **글자를 키워서 해결하지 마라.** 여백·대비·정렬로 푼다. 모바일 본문 13px 유지.

---

## 잠금판 (2026-07-31 갱신)

| 태스크 | 상태 | 비고 |
|---|---|---|
| C-1 이관 5~8단계 | 🔒 | 서비스계정 키 = 사람이 발급. 키 생기면 해제 |
| C-2 규칙 게시 2건 | ⬜ | **가장 급함** — 코드는 고쳤는데 게시가 안 돼 실제로는 안 막혀 있다 |
| C-3 모바일 터치타깃 | ⬜ | |
| C-4 숫자 컬럼 tabular-nums | ⬜ | |
| C-5 AUTH-5 사업자번호 입력 경로 | ⬜ | |
| C-6 채팅방 헤더 방키 노출 | ⬜ | |
| C-7 말풍선 우측 여백 | ⬜ | |
| C-8 SEC-2·MONEY-1·PII-2·CONTRACT-1 | 🔒 | 설계 판단 필요 — Claude가 먼저 정한다 |

### 동시 편집 중이라 열지 마라
```
lib/firebase/rtdb-adapter.ts   lib/firebase/auth.ts   lib/legal.ts
lib/domain/settlement-engine.ts   lib/domain/contract.ts
components/ui/tokens.ts   components/ui/detail-group.tsx   components/ui/feedback.tsx
scripts/migrate-v3-to-v4.mts   scripts/apply-v4-migration.mts   scripts/verify-v4-migration.mts
MIGRATION_PLAN.md   LAUNCH_GONOGO.md   HANDOFF.md
```

---

## C-2. 규칙 게시 2건 ⬜ ← 먼저 해라

**배경**: 규칙 파일은 이미 고쳐져 커밋됐는데 **게시가 안 돼서 실제로는 안 막혀 있다.**

### 2-1. Storage 게시
```
firebase deploy --only storage
```
게시 후 확인 — 로그인 없이 아래가 **403** 이어야 한다(지금은 성공한다):
```
curl -X POST "https://firebasestorage.googleapis.com/v0/b/freepasserp3.firebasestorage.app/o?name=contract-signed/probe/x.txt" --data "x"
```

### 2-2. RTDB — 비활성 계정 차단을 서버에도
앱 게이트(`lib/auth-session.ts` isBlocked)만 막고 있어 **서버는 여전히 열려 있다.**
업무 노드 조건에 이미 있는
`root.child('users').child(auth.uid).child('status').val() !== 'pending'`
옆에 다음을 AND 로 추가한다.
```
root.child('users').child(auth.uid).child('is_active').val() !== '아니오'
```
대상: `products` · `policies` · `rooms` · `messages` · `contracts` · `settlements` 의 read/write 조건.

⛔ **`users` 노드 자체의 `.read` 는 건드리지 마라** — RTDB는 자식 `.read` 가 부모 읽기를 만들지 못해
관리자 회원목록이 통째로 빈다(에뮬레이터 실증, 401을 catch가 삼켜 "빈 목록"으로 보인다).

게시 전 `scripts/ruleprobe` 를 돌려 통과시킨다.

**완료 판정**: curl 403 · 비활성 계정으로 로그인 시 방·계약 조회가 **서버에서** 거부.

---

## C-3. 모바일 터치타깃 ⬜

브라우저 실측(2026-07-31, 390×844)에서 34px 미만인 것들.

| 위치 | 현재 | 조치 |
|---|---|---|
| `components/TopBar.tsx` 상단바 타이틀(눌러서 이동) | 28×328 | 높이를 `ctrlH(true)`(36)로. 폭은 그대로 |
| `app/login/page.tsx` `.login-links a` | 19.5px | `padding: 8px 4px; display:inline-block` |

`padding` 으로만 늘린다. 완료 후 줄 간격이 벌어지지 않았는지 스크린샷으로 확인.

---

## C-4. 숫자 컬럼 tabular-nums ⬜

실측 217곳이 숫자인데 `font-variant-numeric: tabular-nums` 가 없다. 자릿수마다 폭이 달라 **열을 세로로 훑을 때 숫자가 흔들린다.**

**전부 고치지 마라. 세로로 줄지어 비교하는 곳만.**
- `components/list-rows.tsx` — 목록 행의 금액·건수·차량번호
- `components/PriceMatrix.tsx` · `features/finder/ExcelResultsTable.tsx` — 누락분
- `app/settlement/page.tsx` — 집계 카드 금액

본문 문장 속 숫자(예: '연간 2만Km')는 **건드리지 마라** — 문장에선 비례폭이 더 읽기 좋다.

판정: 같은 열 숫자의 오른쪽 끝이 자릿수와 무관하게 일치.

---

## C-5. AUTH-5 — 파트너 사업자번호를 넣을 화면이 없다 ⬜

**증상**: 가입은 사업자번호로 회사를 매칭하는데 `partners` 레코드에 그 번호를 **입력할 화면이 없다.**
신규 공급사·영업채널은 매칭이 영원히 실패해 `SP999`(임시소속)에 머물고, 승인해도 스코프가 안 생긴다.

**조치**: `/members` 파트너 탭 편집 폼에 `business_no` 노출.
- 스키마엔 이미 있다: `lib/intake/entities.ts` partner 엔티티 `business_no`
- `app/members/page.tsx` 의 파트너 분기 `basicFields`(현재 `['name','partner_type','contact']`)에 `'business_no'` 추가
- 저장 시 숫자만 남긴다(`replace(/\D/g,'')`) — 가입 화면 `matchBizNo` 가 숫자 기준으로 찾는다
- 같은 번호를 가진 다른 파트너가 있으면 toast 로 알리되 **막지는 마라**(지점 등 정당한 중복 가능)

판정: 파트너에 사업자번호 입력 → 그 번호로 가입 → 가입 화면에 `✓ 매칭: {회사명}` 표시.

---

## C-6. 채팅방 헤더에 내부 방키가 통째로 보인다 ⬜

**증상**(모바일 실측): 헤더가 `계약문의 · 123가4567 … CH-123가4567-usr_park`.
**차명은 잘리는데 내부 방키는 온전히 보인다.** 우선순위가 뒤집혔다.

**조치**: `app/chat/page.tsx` 의 `chatCode`(`roomChatCode`)를 모바일 헤더에서 빼거나,
차번·차명이 다 보인 뒤 남는 폭에서만 보이게 한다. 웹은 폭이 있으니 유지해도 된다.

판정: 390px 폭에서 차번·차명이 잘리지 않는다.

---

## C-7. 긴 말풍선이 화면 우측 끝에 붙는다 ⬜

**증상**(모바일 실측): 짧은 말풍선은 우측 여백 14px 인데, 한 줄이 긴 말풍선은 여백 0 으로 화면 끝에 닿는다.

**조치**: `components/ChatThread.tsx` 말풍선의 `maxWidth` 를 화면이 아니라 **패딩을 뺀 폭** 기준으로.
좌우 여백이 대칭이어야 한다.

판정: 긴 메시지와 짧은 메시지의 우측 끝이 같은 선.

---

## C-1. 이관 5~8단계 🔒 (키 나오면 해제)

**사람이 먼저 할 일**: Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성.
`tmp/firebase-auth/sa.json` 에 두고 **`.gitignore` 확인**(절대 커밋 금지).

해제되면 **한 단계씩**, 각 산출물을 확인하고 다음으로.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json
npm i -D firebase-admin

# 5단계 — 먼저 드라이런(쓰기 없음)
npx tsx scripts/apply-v4-migration.mts tmp/migration/v4-payload.json
# 경로 수·건너뛸 수 확인 후에만
npx tsx scripts/apply-v4-migration.mts tmp/migration/v4-payload.json --apply

# 6단계 — 검증. 1축이라도 FAIL 이면 거기서 멈추고 보고
npx tsx scripts/verify-v4-migration.mts
```

- `set()` 금지, `update()` 멀티패스만. 스크립트가 그렇게 돼 있으니 **옵션을 바꾸지 마라.**
- 기존 값이 있는 경로는 건너뛴다. **`--overwrite` 쓰지 마라.** 이관은 빈 곳을 채우는 것이다.
- 로그 `tmp/migration/apply-*.jsonl` 이 **유일한 롤백 수단이다. 지우지 마라.**
- 7단계(앱 배포)는 브리지 **켠 채로**. 8단계(브리지 끄기)는 사람 승인 뒤에만.

옮겨지는 것(드라이런 실측): 방 142 · 메시지 1150 · 계약 33 · 정산 14 · 고객 36 · 정책 25 · 파트너 38 · 서명 1.
**매물·회원은 이관하지 않는다**(매물=시트로 새로, 회원=erp3와 루트 공유).

---

## C-8. SEC-2 · MONEY-1 · PII-2 · CONTRACT-1 🔒

설계 판단이 필요해 Claude가 먼저 정한다. Cursor는 손대지 마라.

---

_갱신: 2026-07-31 — Claude Code_
