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
| C-2 규칙 게시 2건 | ✅ | 2026-07-31 게시 완료 (Storage 200→403 확인 · RTDB 32곳 반영) |
| C-3 모바일 터치타깃 | ⬜ | |
| C-4 숫자 컬럼 tabular-nums | ⬜ | |
| C-5 AUTH-5 사업자번호 입력 경로 | ⬜ | |
| C-6 채팅방 헤더 방키 노출 | ⬜ | |
| C-7 말풍선 우측 여백 | ⬜ | |
| C-8 SEC-2·MONEY-1·PII-2·CONTRACT-1 | 🔒 | 설계 판단 필요 — Claude가 먼저 정한다 |
| **S-1 시트 연동 데드락** | ⬜ | **오픈 차단. 최우선.** 2026-08-06 Claude 전수조사 |

### 동시 편집 중이라 열지 마라
```
lib/firebase/rtdb-adapter.ts   lib/firebase/auth.ts   lib/legal.ts
lib/domain/settlement-engine.ts   lib/domain/contract.ts
components/ui/tokens.ts   components/ui/detail-group.tsx   components/ui/feedback.tsx
scripts/migrate-v3-to-v4.mts   scripts/apply-v4-migration.mts   scripts/verify-v4-migration.mts
MIGRATION_PLAN.md   LAUNCH_GONOGO.md   HANDOFF.md
```

---

## C-2. 규칙 게시 2건 ✅ (2026-07-31 완료)

**Storage** — `contract-signed/**` 무인증 업로드·덮어쓰기 차단. 게시 전 200 → 게시 후 **403** 확인.
`contract-signed/` 잔여 파일 0개(구멍이 악용된 흔적 없음).
```
GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json \
  npx firebase-tools@13 deploy --only storage --project freepasserp3 --non-interactive
```

**RTDB** — 비활성·삭제·반려 계정을 서버에서 차단. 32곳에 주입, 라이브 반영 확인.
```
npx tsx scripts/rules-add-inactive-gate.mts database.rules.json tmp/rules/next.json
npx tsx scripts/rtdb-rules.mts put tmp/rules/next.json   # 직전 라이브를 자동 백업
```

검증: `scripts/ruleprobe/probe-inactive.mjs` 10/10 · 기존 24케이스 회귀 0.

⚠ **에뮬레이터 함정** — `scripts/ruleprobe/firebase.json` 이 `step1.rules.json` 을 본다.
`probe2.rules.json` 만 바꾸면 **규칙이 안 실린 채 통과한다.** 검증 대상 규칙은 `step1.rules.json` 에 넣어라.

---

## S-1. 시트 연동이 «승인할 수 없는 차단»에 걸려 있다 ⬜ — 최우선

**증상**: 관리자 재고관리 → 상품 검증까지는 통과하는데 **상품 반영을 누르면**
`기존 가격기간 누락 39건. 충돌을 정리하고 다시 검증하세요.` 로 막힌다.
그런데 **화면의 승인 후보 목록엔 0건**이라 운영자가 손쓸 방법이 없다. 완전한 데드락이다.

**실측 (2026-08-06, `npx tsx scripts/audit-inventory-sources.mts --plan --conflict-detail`)**
```
시트 16곳 원본 437 → 반영 388 · 무효 0 · 중복 0 · 조회실패 0   ← 1단계는 전부 PASS
ERP 대조:  BLOCKED · 기존 가격기간 누락 39건
  금액 변경 있음 → 승인 후보로 표시됨    0건
  금액 변경 없음 → 승인 후보에 안 뜸    39건   ← 전부 이것
```

**원인**: 「금액이 안 바뀌면 승인 없이 통과」 완화가 **미리보기에만** 들어갔다.

| 위치 | `priceChangesValue` | 결과 |
|---|---|---|
| `components/SheetSync.tsx:941` 미리보기 | **넘김** | 39건 통과 → 화면은 "반영 가능", 승인 후보 0건 |
| `components/SheetSync.tsx:1141` `verifyFreshSnapshot` | 안 넘김 | 39건 부활 → **여기서 throw** |
| `lib/domain/sheet-sync-all.ts:991` 커밋 경계 | 안 넘김 | 통과해도 여기서 또 차단 |
| `lib/domain/sheet-daily-sync.ts:95` 일일 자동연동 | 안 넘김 | 매일 밤 같은 이유로 실패 |

완화가 안전한 근거는 이미 코드에 있다 — soft-merge 는 누락 기간을 **삭제하지 않고 기존값으로 보존**한다
(`lib/domain/sheet-conflict-report.ts:94`). 승인하든 안 하든 결과가 같다.

**조치** — 판정을 한 곳에서 만들어 네 군데가 **같은 값**을 쓰게 한다.

1. `lib/domain/sheet-conflict-report.ts` 에 헬퍼를 추가한다(이 파일이 이미 `priceImpact` 를 갖고 있다):
   ```ts
   /** 「반영하면 손님에게 나가는 금액이 바뀌는가」 — 승인 요구 여부의 SSOT. */
   export function buildPriceChangesValue(input: Parameters<typeof buildSheetConflictReportRows>[0]): (raw: string) => boolean {
     const byRaw = new Map(buildSheetConflictReportRows(input).map((row) => [row.raw, String(row.priceImpact || '')]));
     return (raw) => (byRaw.get(raw) || '').includes('새 기본가격 적용');
   }
   ```
2. 위 표의 **나머지 세 곳**에서 이 헬퍼로 만든 `priceChangesValue` 를 `applySheetConflictResolutions` 에 넘긴다.
   입력은 네 곳 모두 동일해야 한다 — `conflicts`(raw), `existing`, `deleted`, `incoming = fetched.products`,
   `contracts`, `providerCodes = fetched.lines.map(l => l.code)`.
3. `components/SheetSync.tsx:939` 의 인라인 정의도 이 헬퍼로 교체한다(중복 정의 금지).

**하지 마라**
- `missingPricePeriods` 판정 자체를 약화시키지 마라. 고치는 건 «누가 그 판정을 보느냐» 뿐이다.
- `isPriceConflictProtected`(계약락·진행계약 보호)는 **절대 건드리지 마라.** 완화가 그쪽에 번지면 이중판매가 난다.
- 승인 이력(`v4/sheet_conflict_resolutions`)을 지우거나 일괄 승인으로 우회하지 마라.

**회귀 시험** — `scripts/sim-sheet-merge.mts` 에 3건 추가:
- 금액 무변화 + 미승인 → 미리보기·커밋 경계·일일동기화 **모두 통과**
- 금액 변경 + 미승인 → 네 곳 **모두 차단**
- 계약락 걸린 차 + 금액 무변화 → 완화와 무관하게 **차단 유지**

**완료 판정**
```
npx tsx scripts/audit-inventory-sources.mts --plan
→ 결과 PASS (지금은 BLOCKED · 기존 가격기간 누락 39건)
npm run typecheck · npx tsx scripts/sim-sheet-merge.mts   # 145/145 이상
```
운영 write 는 하지 마라. 반영 실행은 사람·Claude 게이트다.

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

_갱신: 2026-08-06 — Claude Code (S-1 추가)_
