# 규격통일 핸드오프 (Claude ↔ Cursor)

공용 규격 = **`CLAUDE.md`**. 둘 다 이거 따름.
**철칙: 같은 파일 동시편집 금지. 편집 전 재확인 → 편집 → `npx tsc --noEmit`(0). 이제 매 push/PR = CI(typecheck·`npm run check:fonts`·sim3종·빌드) 자동 검증.**

---
## 🗓 최신 세션 (2026-07-22, Claude 레인) — 다음 도구/PC 재개용 · 먼저 읽을 것

> 순서: `git pull` → 이 절 → 아래 2026-07-21 절. 외부 평가 78→86점(보안·UI 실코드 반영).

### ✅ 이번 세션 완료 (전부 커밋·푸시 · CI 초록)
1. **보안 — 계약 읽기 역할 스코프** (`rtdb-adapter.readContractsScoped`): admin=전량·provider=회사·agent=본인uid+채널. v3 `contracts`·`v4/contracts` 양쪽 스코프 쿼리. 고객 PII(이름·전화) 역할 격리(영업자 A가 B 고객 못 봄). rules `v4/contracts`·`v4/customers` `.read` 스코프 + `.indexOn`. 게시 전/후 모두 안전(부분집합만).
2. **보안 — 공급 원가 가림**: `vehicle_price` 를 영업자·손님 read 단(`list`/`get`)에서 제거. admin·provider만. ※완전격리는 `products_private` 이관 후(아래 ③).
3. **보안 — 자가승인 차단**: 가입=항상 `pending`(`auth.ts`), `approveUser`(게이트가 읽는 **최상위** `users/{uid}/status` 에 기록 — v4 아님), `members` 승인버튼, rules `users/$uid` status `.validate`(본인은 pending만·active는 admin). ⚠️ **신규가입 전원 관리자 승인 필요**(members에서 승인).
4. **보안 — 감사로그 위조방지**: `v4/audit_logs` `actor_uid === auth.uid`.
5. **UI/UX 구조통일**: `FW`(두께)·`FS`(크기) 토큰 SSOT 전면 적용(공유원자 6 + 페이지 38 = 346건). 800/900 퇴출. 목록 지브라·호버/선택 색구분·안읽음🟠/진행중🔵 액센트·실차명 해석(product·계약스냅샷·삭제매물 다단 폴백, "삭제된 차량" 명시). **`scripts/check-fonts.mts` 가드 + CI로 잠금** — raw fontSize/fontWeight 재난립 차단.
6. **정산 3자 E2E** (`scripts/sim-e2e-settlement.mts`, 15/15): 공급등록→영업 5단계 계약→정산(수수료 R1·지급 R2·순수익)→관리자 월정산(VAT).
7. **CI** (`.github/workflows/ci.yml`): push/PR마다 typecheck·폰트가드·sim(시트병합·차량락·정산)·빌드. 시크릿 불필요.
8. **버그**: 시트 재동기화 락 대량해제 · 로그인직후 매물 안뜸 · 약정주행 필터중복 · **계약코드 전역충돌(계약 스코핑 회귀 — 두 영업자 같은날 -01 충돌 → 접미사로 전역고유)** · vehicle-lock sim flaky(하네스 Date.now 충돌).
9. **견적·구독 임베드**: `/welrix`·`/sonogong` (외부 Vue 앱 iframe, 공개경로).

### 🔴 다음 (우선순위) — 90+ 로 가는 길
- **① Rules 콘솔 게시 (사장님 손, 미완)** — `database.rules.json` = 최신본(계약/고객 스코프·status validate·감사). 콘솔 → RTDB → 규칙 → 전체 붙여넣기 → 게시. **게시 전엔 어댑터 스코프만 동작(RTDB 직접 우회 미차단).** 게시 후 관리자 화면 정상 확인.
- **② 역할별 침투 테스트** — admin·provider·agentA·agentB·승인대기·비로그인으로 직접 접근해 격리 확인(게시 후).
- **③ `products_private` 물리 분리** — `vehicle_price`·`vin`·`price.*.fee` → `v4/products_private`(관리자만). 현재 어댑터 strip은 앱만 보호(v3 원가 인라인). v3 원가 이관 필요.

### v3→v4 종료(exit) 기준 — 브리지는 "이전 구조"지 최종 아님
현재: 읽기 = v3 라이브 ∪ v4 오버레이 필드병합, 쓰기 = `v4/` 만. 장점=무중단 이전. 장기부채=병합비용·이중추적·삭제복잡·어댑터 병목. **아래 충족 시 v4 단독 전환 검토:**
- [ ] 모든 활성 계약이 v4 스키마로 정착
- [ ] 핵심 상품 데이터 v4 저장(카탈로그·가격·상태)
- [ ] 회원 역할체계 v4 정착(status·role·company)
- [ ] 과거 v3 데이터 read-only 아카이브
- [ ] v3 신규 쓰기 완전 중단(신규는 v4 단독 생성)

권장: 각 엔티티에 `source_version`·`source_id`·`overridden_fields`·`migrated_at`·`migration_status` 부착 → 이관 추적. 일정 시점 후 **신규 데이터만이라도 v4 단독** 생성으로 전환.

---
## 전략 (사장님 결정 2026-07-18)

1. **외부시트 = 공급사마다 고유 시트.** v3 공용 종합/오토플러스 `source` enum 동기화는 **이식하지 않음**.
2. v4 기본 모델(이미 방향 맞음): `partner.sheet_url` + `mapping_profile` + `SheetSync`/`sheet-import` → 공급사별 학습.
3. **나머지 v3 운영기능은 v4 구조로 이식** (원자·`lib/domain`·`getStore`·엔진). v3 JS/HTML 덤프 금지.

---
## 구조 정리 — Cursor 진행

### ✅ Phase 1 — Messaging SSOT
### ✅ Phase 2 — Product 패밀리
### ✅ Phase 3 — 갓페이지 추출 (DONE_VALS→`isDone` SSOT · MasterFitSummary · 원자 adopt)
### ⏭ Phase 4 — Auth + store 단일화 (타 레인)
### ✅ Phase 5 — UI 사전 adopt or delete (레거시 Identity/SpecLine/PriceRows 등 삭제 · Chat/Sign/Finder 원자화)

---
## v3→v4 기능 이식 로드맵 (시트 전제 반영)

### ✅ Phase A — 공급사별 시트 아키텍처 강화
- `lib/domain/sheet-merge.ts` — softMerge / planProductUpsert / `commitSheetProducts` (빈칸→수기 덮어쓰기 금지, price 기간 병합)
- `lib/domain/sheet-adapters.ts` — generic|autoplus 레지스트리, `partnerSheetOpts`
- partner 필드: `adapter_id` · `header_row` · `sheet_tab`=gid
- `SheetSync` — 어댑터·헤더행·gid UI, 커밋=soft-merge upsert, PillTabs
- sim: `npx tsx scripts/sim-sheet-merge.mts` (10/10)
- **안 함:** v3 공용 external-sheet sync

### ✅ Phase B — 계약발송 허브
- 템플릿: `public/contract-template/*.html` (v3 embed API 재사용)
- `lib/domain/contract-send.ts` — buildPayload / draft / send→sign.ts
- `ContractSend.tsx` — iframe + 임시저장·PDF·발송
- `/contract` WorkPage 패널 **발송** 마운트
- 엔티티: `contract_draft`, `sign_draft_at`

### ✅ Phase C — 월별 관리자 정산 (VAT 정산서)
- `lib/domain/admin-settlement.ts` — BLOCKS·VAT10%·정산완료 불러오기
- `AdminSettlementSheet` + `/settlement` 탭 **VAT 정산서**
- 엔티티 `admin_settlement` (건별 settlement와 분리)

### ✅ 손님 공개 연결 (공유·서명)
- Auth: `/q` `/catalog` `/sign` 면제 (`public-access.ts`)
- Store: 공개면에서 RTDB 읽기 (`getSession || isPublicAccess`)
- Rules: `products`/`policies`/`v4/products|policies` `.read: true`
- 서명: `contract_sign/{token}` 공개 슬롯 읽기·제출 (`sign.ts`)
- **규칙 = 2026-07-21 재작성 완료.** `database.rules.json` 이 최신본이다. 아래 "세션 이력" 참고.

### ⏭ Phase D — 알림 + 관리자소통
### ⏭ Phase E — 회원 승인·스코프
### ⏭ Phase F — 카탈로그·OCR·P2

---
## 메모 — 모바일 하단바 (다음에 모바일 레인에서)

**결정 (2026-07-18)**
1. **하단탭/하단바 = 상시.** 모바일에서 숨기거나 스크롤에 사라지게 하지 않음. 네이티브 앱처럼 항상 고정.
2. **홈(파인더 `/`)에도 하단바 메뉴가 있어야 함.** 지금은 `Page`/`BottomNav`가 홈에 안 붙어 있거나(이전·홈만), 홈 전용 메뉴(재고·계약문의·정산·더보기 등)가 없음 → TopBar 드롭다운만으로는 부족.

**구현 방향 (할 때)**
- `BottomNav`를 **탭바 SSOT**로 확장: 홈 / 계약문의 / 재고(역할별) / 정산·더보기 등 주요 레인.
- 홈 화면(`app/page.tsx` finder)도 모바일에서 하단바 **상시 마운트** + `fp-main-pad` 하단 패딩 확보.
- 웹은 기존 콕핏(TopBar·사이드) 유지, **모바일만** 하단 탭 강조(`useIsMobile`).
- 규격: 터치 40+ · `R` · `C.*` · 햅틱(`haptic.nav`) · safe-area.

**하지 말 것**
- 홈만 하단바 없음 / 스크롤 시 자동 숨김 / 페이지마다 다른 하단 높이.

---
갱신: Phase3·5 규격통일 + 영업자 막힘 개선(2026-07-19: session.code=user_code, RTDB rooms/messages 스코프 조회, /q?a= 매칭, 발송 링크 UX).

---
## 🗓 세션 이력 — 2026-07-21 (Claude 레인, 다른 PC 인수인계용)

> 이 세션은 3자 동시 작업이었다: **Claude(나) + Cursor + 다른 Claude**.
> 파일 소유권 분리 = `CURSOR-TASKS.md`(Claude 소유·지시) / `CURSOR-STATUS.md`(Cursor 소유·기록).
> 다른 PC에서 이어받을 때 **먼저 `git pull` → 이 절 → CURSOR-STATUS.md 순으로 읽을 것.**

### ✅ 이번 세션에 끝낸 것 (전부 커밋·푸시됨, tsc 0)
1. **차량 락 재설계 버그 수정** (`474d62d`) — 계약금 체크 해제 시 영구잠금·자기잠금 데드락.
   원인 = 락에 주인이 없었음. `product.locked_by_contract` 도입, 락 쓰기를 `syncVehicleLock` 한 곳으로.
   검증 = `scripts/sim-vehicle-lock.mts` 23/23. 삭제보호는 `blockingContractFor`(락보다 넓음)로 분리.
2. **데이터점검 잠금 정합성** (`4778441`) — `/data-check` 에 매물상태 vs 계약 대조(읽기전용). 옛 규칙 잔재 출고불가 탐지.
3. **TopBar 하이드레이션** (`f454b00`) — 세션을 렌더 중 읽던 것 → 마운트 후로.
4. **진단 페이지 `/diag`** (`2cb57dc`) — RTDB 연결·권한·건수·사진해석을 화면에서 확인(콘솔 대신). 장애 시 여기부터.
5. **홈 총계 기준 통일** (`ef52fed`) — 사이드바 "총 N대"가 rows.length(출고불가 포함) → totalVisible 로. 상단바와 일치.
6. **역할 라벨 SSOT 통일 + settlementCalc 삭제 + 원자 사전 실측** (`ad3f328`).
7. **폐기 ETL 골격 삭제 + CLAUDE.md 락/데이터 규격 정정** (`a723490`) — 문서가 옛 규칙이었음.
8. **비밀번호 재설정 폼 잠김 버그** (`57e54a7`) — 성공 경로에 busy 해제 누락. v3·v4 코드 동일(기능은 있음).
9. **메뉴 워딩 의미화 + 관리자 전 메뉴 + members 게이트** (`1a2327b`).
   상품찾기/계약문의/계약진행 및 정산/재고관리/정책관리. 탭 축약=NAV_TAB_LABEL. 관리자는 TopBar 필터에서 규칙화(seesAll).
10. **가입 승인 게이트** (`45de7de`) — 사업자번호 매칭=즉시 active / 미매칭=pending(승인대기 화면). `AuthProvider` 중앙 게이트.
    `user.status` 필드 부활(is_active 와 의미 분리). 기존회원 보호 위해 `!== 'pending'` 블랙리스트.

### 🔴 다음에 할 일 — 우선순위 순

**① 라이브 RTDB 규칙 게시 (사장님 손 필요, 미완)**
- `database.rules.json` = 최신 재작성본. **아직 콘솔에 게시 안 됨(마지막 pending 가드 60곳 추가분).**
- 절차: `database.rules.json` 전체 → Firebase 콘솔 → Realtime Database → 규칙 → Ctrl+A → 붙여넣기 → 게시.
- ⚠️ Claude 는 firebase CLI 로그인이 이 환경에서 막힘(non-interactive 거부) → **직접 배포 불가.** 붙여넣기만이 경로.
- 게시 후: 관리자·영업자로 로그인해 매물목록·계약·정산·채팅·재고저장 정상인지 확인. 이상 시 즉시 되돌릴 것.
- 막은 것: v4 통째 덤프·삭제, 수수료율·정산금액 조작, 감사로그 열람, contract_sign 부모 읽기(주민번호 대량유출), 승인대기자 접근.

**② 계약·고객 스코프 조회 (어댑터 수정 필요)** — Phase E 후반
- 현재 `v4/contracts`·`v4/customers` 는 로그인 사용자면 **전부 읽힘**(고객 이름·전화번호).
- 규칙에 스코프 조건을 걸면 어댑터의 통째 `get()` 이 거부→`.catch(()=>[])`→빈 목록. 그래서 규칙만으론 못 조임.
- 해결: `rtdb-adapter.ts` 에 `readContractsLive`(역할별 orderByChild 스코프) 추가. **선례 = `readRoomsLive`.**
- 선착순 락은 `product.locked_by_contract` 로 이미 매물에 각인돼 있어, 계약을 못 봐도 락 판정 가능(스코프 걸어도 됨).

**③ 원가 필드 분리** — 1~2h
- `products` 의 `vehicle_price`(원가)·`vin`·`price.*.fee`(수수료)를 `v4/products_private/{코드}` 로 분리, 관리자 읽기 제한.

### ⚠️ 3자 작업 주의
- **dev 서버는 한 명만.** 같은 프로젝트에 서버 2개 띄우면 `.next` 청크 desync → 먹통. 복구 = `.next` 삭제 후 재기동.
- **`lib/tabbar.tsx`·`components/TopBar.tsx` = 모두가 건드리는 SSOT.** 편집 전 확인.
- Cursor T5(하드코딩 스윕)는 해제됨·미착수. 잔여 hex ~52·치수 ~29·raw 컨트롤 ~10.
- 편집 묶음마다 `npx tsc --noEmit` 돌리고 넘어갈 것(이번 세션에 import 누락으로 먹통 2회).

### 미결 판단 (사장님)
- 죽은 원자 28개: 코드 유지·문서만 정리 완료(CLAUDE.md "준비만 된 원자"). 실사용 유도/삭제는 판단 대기.
- 옛 규칙 `출고불가` 잔재 백필: `/data-check` 잠금정합성으로 목록만 노출. 자동복구 안 함(공급사 수기설정과 구분 불가).

갱신: 2026-07-21 — rules 재작성·가입승인·메뉴워딩·락버그. 다음 = ① rules 게시(붙여넣기) → ② 계약/고객 스코프 → ③ 원가분리.
