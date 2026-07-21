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
5. npx tsc --noEmit → 0 확인. 0이 아니면 고친다. 못 고치면 변경을 되돌리고 6-b로 간다.
6-a. 성공: 커밋 → CURSOR-STATUS.md 에 완료 줄 추가 → 1번으로 돌아간다.
6-b. 실패/막힘: 변경 되돌리고 CURSOR-STATUS.md 의 "막힘" 항목에 기록 → 그 태스크는 건너뛰고 1번으로.
7. 열린 태스크가 없으면 CURSOR-STATUS.md 에 "대기중" 기록하고 정지한다.
```

**정지 조건** (아래 중 하나면 즉시 멈추고 STATUS에 기록):
- 열린 태스크 없음
- 같은 태스크에서 2회 연속 실패
- 지시서에 없는 판단이 필요함 (설계 결정·기능 변경·삭제 여부 애매)
- 잠금판의 금지 파일을 건드려야만 태스크를 끝낼 수 있음

**막혔을 때 추측으로 진행하지 마라.** 기록하고 넘어가는 것이 정답이다.

---

## 🔒 잠금판 — Claude 전용 (2026-07-21 기준)

### 절대 열지 마라 (Claude가 동시 편집 중)
```
lib/firebase/rtdb-adapter.ts      lib/firebase/auth.ts
lib/firebase/contract-sign-public.ts
lib/domain/sign.ts                lib/domain/settlement-engine.ts
lib/domain/contract.ts            lib/domain/data-check.ts
app/members/page.tsx              app/data-check/page.tsx
database.rules.json               HANDOFF.md
scripts/sim-vehicle-lock.mts      scripts/audit-vehicle-status.mts
```

### 이미 Claude가 수정한 파일 (읽어도 되지만 줄번호 믿지 마라)
`app/inventory/page.tsx` · `components/TopBar.tsx` · `lib/domain/data-check.ts` · `app/data-check/page.tsx`
작업 전 반드시 다시 읽을 것.

### T5 진행 시 추가 제외
`components/TopBar.tsx` — 하이드레이션 수정 직후다. 렌더 중 `getRole()`/`actor()`/`isGuest()` 를
다시 호출하는 형태로 되돌리지 마라(마운트 후에만 읽는다). 색·높이 토큰화만 하려면 해도 되지만,
`mounted` 가드는 건드리지 말 것.
`app/diag/page.tsx` — 진단 도구. 장애 때 이것마저 깨지면 안 되니 스윕 대상에서 제외.

### 태스크 잠금 상태
| 태스크 | 상태 | 비고 |
|---|---|---|
| T1 vstatus 제거 | ✅ 완료 | `a2c2e14` |
| T2 canonProductType | ✅ 완료 | `b8e9bd7` |
| T3 중복·죽은코드 | ⬜ 열림 | |
| T4 PhotoUpload 원자화 | ⬜ 열림 | |
| T5 하드코딩 스윕 | ⬜ 열림 | 2026-07-21 해제 — 커밋 정리 완료(작업트리 클린) |
| T6 login 원자화 | ❌ 폐기 | 의도적 설계였음 |
| T7 카탈로그 요금필터 통일 | ⬜ 열림 | |
| T8 재고상태 아이콘 SSOT | ⬜ 열림 | |
| T9 죽은 원자 실사 보고 | ⬜ 열림 | 코드 변경 없음, 보고서만 |

---

## 공통 철칙
1. **한 태스크 = 한 커밋.** 커밋 전 `npx tsc --noEmit` 0 확인.
2. 지시서에 없는 리팩터·"개선"·기능 변경 금지.
3. 새 원자를 만들지 마라. 기존 원자로 안 되면 멈추고 기록.
4. 커밋에 **자기 태스크 파일만** 담아라. `git add -A` 금지, 파일을 명시해서 add.
5. 커밋 메시지는 한 줄, 무엇을 왜 바꿨는지.

---

## T3. 중복·죽은 코드 정리  ⬜

1. **시각 포맷 중복** — `components/list-rows.tsx`의 `shortAt` 이 `lib/format.ts` 의 `msgClock` 과 로직 동일
   (비오늘 `HH:mm` 접미사만 차이).
   → `lib/format.ts` 한 곳으로 합친다. `msgClock(ms, { dateOnly: true })` 형태로 옵션을 받거나
     `shortAt` 을 `lib/format.ts` 로 옮겨 export. `list-rows.tsx` 의 로컬 구현 삭제.
2. **죽은 파일 삭제** — `components/ContractSend.tsx` (임포터 0).
   ⚠️ `ContractSign.tsx` 와 `lib/domain/contract-send.ts` 는 **살아있는 다른 파일**이다. 헷갈리지 마라.
3. **미사용 export 삭제** (임포터 0 확인 후):
   - `lib/domain/product-filters.ts` → `searchHaystack` (`productHaystack` 한 줄 패스스루)
   - `lib/domain/product.ts` → `VEHICLE_STATUSES`(재export), `standardPriceList`, `isReview`, `minDeposit`, `PERIOD_ROWS`
   - ⚠️ `lib/domain/contract.ts` 의 `settlementCalc` 는 **금지 파일**이다. 손대지 마라.
4. **역할 라벨 중복은 건너뛴다** — `app/members/page.tsx` 가 금지 파일이라 이번엔 못 고친다.

**완료조건**: `tsc` 0, 삭제한 심볼 저장소 검색 0건.

---

## T4. `components/PhotoUpload.tsx` 손롤 → 원자  ⬜

**현황**: raw 컨트롤 7개, 하드코딩 hex 9개, height/radius 11개. 규격 §금지의 "손롤" 정면 위반.

- `<button>` → `Btn`(`solid`/`ghost`/`danger` · `sm`/`md`) 또는 `IconBtn`
- `<input>` → `Input`
  ⚠️ 단, `type="file"` 인풋은 대응 원자가 없다 → **숨김 input + `Btn` 트리거** 패턴을 유지하고 보이는 버튼만 원자화.
- hex → `C.*` / radius → `R` / 높이 → `CTRL`·`ctrlH` (**페이지에서 height 숫자 금지**)
- 모바일 분기를 직접 쓰지 마라 — 원자가 `useIsMobile()` 내장.

**완료조건**: 이 파일에 raw `<button>/<input>`(file 인풋 제외)·하드코딩 hex·height 숫자 0건.
업로드·삭제·미리보기 동작 육안 확인. `tsc` 0.

---

## T5. 하드코딩 스윕  ⬜ (2026-07-21 해제)

`app/**` · `components/**` 중 아래 제외 목록 밖 전부에서
하드코딩 hex → `C.*` / `borderRadius` 숫자 → `R` / height 숫자 → `CTRL`·`ctrlH`·`ctrlChipH`.

**제외**: `components/ui/*` 전체 · `components/product-card-atoms.tsx` · `app/layout.tsx` ·
**`app/login/page.tsx`**(T6 참조) · 잠금판의 금지 파일 전부.

토큰이 없으면 새 hex를 쓰지 말고 `tokens.ts` 에 토큰을 추가한 뒤 쓰고, 추가 목록을 STATUS에 남겨라.
**파일 5~10개 단위로 나눠 커밋.** 한 번에 전체를 바꾸면 리뷰가 불가능해진다.

---

## T6. ~~login 원자화~~  ❌ 폐기

**하지 마라.** `app/login/page.tsx:14` 주석대로 의도적 설계다:

> 로그인은 v3 CSS 섬(44/48·브랜드 hex). Input/Btn 원자 높이(32/40)와 충돌 → raw 유지.

로그인 화면은 v3와 브랜드 CI를 공유하는 별도 치수 체계를 쓴다. 규격 위반이 아니라 **예외 결정**.
T5 스윕에서도 이 파일은 제외한다.

---

## T7. 카탈로그 요금 필터 통일  ⬜

**증상**: 같은 "월대여료" 축인데 홈과 카탈로그의 판정이 다르다.

- `lib/domain/product-filters.ts` `matchProduct` — `pl.some(x => x.rent > b.lo && x.rent <= b.hi)`
  (**모든 기간** 중 하나라도 밴드에 들면 통과)
- `app/catalog/page.tsx` — `cheapestRent(p)` 를 밴드와 비교 (**최저가만** 본다)

→ 최저가는 밴드 밖인데 다른 기간이 밴드 안인 매물에서 결과가 갈린다.

**작업**: 카탈로그가 `product-filters` 의 판정을 쓰도록 통일한다(홈이 SSOT).
카탈로그 전용 밴드 비교 로직은 삭제.

⚠️ **손님 화면 동작이 바뀐다.** 통일 후 카탈로그에서 요금 필터를 눌러 결과가 늘어나는지 육안 확인하고,
늘어난 게 맞는지 STATUS에 한 줄 남겨라. 이상하면 되돌리고 기록.

**완료조건**: 카탈로그에 밴드 비교 로컬 구현 0건, `tsc` 0.

---

## T8. 재고 상태 아이콘 SSOT  ⬜

`components/list-rows.tsx` 의 `inventoryStatusIcon` 이 6개 상태 문자열을 손으로 다시 분기하고,
`vehicleTone(st)` 를 계산해놓고 대부분 버린다. 상태 톤맵의 **4번째 사본**이다.

**작업**: `VEHICLE_STATUS_TONE`(`components/ui/badges.tsx`) 을 SSOT로 삼아
`inventoryStatusIcon` 이 톤맵에서 색을 가져오게 정리한다. 아이콘 모양 매핑만 로컬에 남긴다.

⚠️ **화면에 보이는 색이 바뀌면 안 된다.** 바뀌면 톤맵이 아니라 이 함수가 맞았던 것이니
되돌리고 STATUS에 "톤맵과 실제 색 불일치"로 기록해라.

**완료조건**: 상태→색 매핑이 이 파일에 중복 정의되지 않음, 화면 색 변화 없음, `tsc` 0.

---

## T9. 죽은 원자 실사 보고  ⬜  (코드 변경 없음)

`CLAUDE.md` 의 "원자 사전"은 "이걸 써라"라고 하는데, 실제로는 아무도 import 하지 않는 원자가 많다.
문서가 SSOT 역할을 못 하고 있다.

**작업**: 아래 각각에 대해 **import 하는 파일이 있는지** 실측해서 표로 정리한다. **삭제하지 마라.**

```
ui/table.tsx      DataTable
ui/objcard.tsx    ObjCard, Cards, Metric
ui/detail.tsx     KV, DetailRow, DetailEmpty, Dash
ui/sec.tsx        Sec, HiddenSecs
ui/index.tsx      Modal, Drawer, EmptyState, ListBox, DetailShell, VSplit, Panel
ui/badges.tsx     RiskTag, SevTag, Status, StatusTag, PERK_TONE, RISK_TONE, STATUS_TONE
product-card-atoms.tsx   PriceFare, PriceMini, OptionsInline, CardFacts
```

**출력**: `CURSOR-STATUS.md` 에 표로. 열 = 원자 / 사용처 수 / 사용 파일(최대 3개) / CLAUDE.md 등재 여부.
사용처 0이면서 CLAUDE.md에 등재된 것을 따로 모아라 — **문서와 코드 중 뭘 고칠지는 사장님 판단**이다.

**완료조건**: 표 작성 완료. 코드 변경 0. 커밋은 STATUS 파일만.
