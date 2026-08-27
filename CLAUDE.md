# freepasserp4 규격 (SSOT) — 손대기 전 필독. 이거 어기면 매번 틀어진다.

저신용·무심사 렌터카 3자 마켓 ERP (공급사·영업자·관리자 + 손님). Next.js 15 App Router + TS, dev :4004.

## ★영업자 구글시트 일이면 먼저 읽어라 — `docs/영업자시트-매뉴얼.md`
공급사시트 → 판매시트 취합은 **ERP를 안 거치는 별도 파이프라인**이다. 규칙·주소·금지목록·사고이력이
전부 그 문서에 있다. 기억으로 하지 마라 — 매번 틀어져서 매뉴얼로 박아 둔 것이다(2026-08-14).

## 협업 파이프라인 — 세션 시작 시 이 역할대로 (상세: docs/AI_COLLABORATION.md)
- **클로드코드(나) = 설계 + 위험영역 게이트/판단.** PLAN 작성·아키텍처 제약·규칙/돈/데이터/보안 최종 go·no-go. **토큰 많이 드는 일(대량 구현·리팩터·전수검증·대형파일 통독)은 직접 안 하고 오더만 제안**(직접 조종 X).
- **커서 = 노가다** — 대량·반복·리팩터 구현. `PLAN.md`·`.cursorrules` 준수, 설계·보안 판단 X.
- **코덱스 = 독립 전수검증**(sim·빌드·타입·적대) **+ 수정**. 위험영역 수정(규칙·엔진·adapter)은 **게시/머지 전 내 게이트** 필수(에뮬 통과≠실데이터 안전).
- 검증 기준 = **사용자 원래 요구사항**(내 설계 아님). 나는 선택지 제안, **중요 기술·범위·보안 결정은 사용자 승인**.
- 그래서 세션 시작 때 나는: 노가다 성격이면 "커서로 이렇게 시키세요" **오더를 제안**하고 나는 설계·게이트에 집중해 토큰을 아낀다.

## 절대원칙
1. **페이지 = 공용 원자·껍데기 배열만.** 페이지 전용 규격 금지. 로직·스타일 손롤 금지. 있는 원자 안 쓰고 raw `<button>/<input>/<select>/<div style>` 새로 짜는 순간 규격 붕괴. 새 UI가 필요하면 페이지가 아니라 **원자를 고치거나 만든다**(SSOT). 한 화면만 쓰더라도 그건 공용 규격이다.
2. **데이터·상태·디자인 = 단일출처.** 저장은 `getStore()`, 상태동기화는 엔진(`settlement-engine`) 경유. 페이지가 직접 `vehicle_status` 등 바꾸지 말 것.
3. **웹·모바일 양립 + 모바일다움.** 신규/변경 기능은 웹·모바일 양쪽 동작. 모바일은 반응형 축소가 아니라 **네이티브 앱**.

## 컨트롤 규격 (원자가 자동 처리 — 페이지에서 height 직접 쓰지 말 것)
- 높이: **md = 웹32 / 모바일40**, sm = 웹28 / 모바일36. 칩 = 웹28(sm) / 모바일40(md).
- 토큰 = `CTRL`·`ctrlH`·`ctrlFs`·`ctrlInputFs`·`ctrlChipH` (`tokens.ts`). 페이지에서 height 숫자 금지.
- 입력·버튼 폰트: **모바일 16px 통일**(검색·정렬·필터·칩 동일 · iOS 줌 방지), 웹 13(md)/12.5(sm).
- 모바일 버튼 **가로 패딩 넉넉** (좁게 만들지 않음). 높이는 40 유지.
- 같은 줄에 서는 컨트롤 = 같은 size(툴바=전부 md).
- 라운드 = `R`(4, 각짐) · 색 = `C.*` · 모노숫자 = `NUM` · 선택행 배경 = `C.selected`.
- 바 높이 = `--fp-bar-h` (웹·모바일 56). 메뉴·건수툴바·필터헤드·하단독 동일.

## 원자 사전 — 이걸 써라 (`@/components/ui`, `@/components/product-card-atoms`)
| 용도 | 원자 | raw 금지 |
|---|---|---|
| 토큰 | `C`·`R`·`NUM`·`CTRL`·`ctrlH`/`ctrlFs`/`ctrlInputFs`/`ctrlChipH` (`tokens.ts`) | 하드코딩 hex/height/radius |
| 버튼 | `Btn`(solid/ghost/danger·sm/md·href)·`IconBtn`·`IconSeg` | `<button>` |
| 입력 | `Input`(full)·`SearchInput`(돋보기·X·full)·`Select`(full)·`WorkFields`/`WorkTable`/`WorkRow`(업무 표)·`WorkInput`/`WorkSelect`/`WorkTextarea`(표 안 칸)·`FormGrid`(스키마폼 내부)·`fmtPhone` | `<input>/<select>` · 페이지에서 `FormGrid`/`FormReadList` 직접 분기 · 표 줄을 CSS grid로 손짜기 |
| 탭·필터 | `PillTabs`·`FilterChips`(단일+count)·`ToggleChips`(다중)·`FilterGroup`(접이식축+해제) | 탭/필터 `<button>` 群 |
| 목록 | `FeedListRow` + `list-rows`(정본=`/esign`) · 등록 `CreateListRow` · 더보기 `ListMoreBar` · 단순 행 `ListRow` | 손 목록행 |
| 상태·라벨 | `Badge`·`CompanyBadge`·`CountPill` · 톤맵(`productTypeStyle`·`CREDIT_TONE`·`VEHICLE_STATUS_TONE`·`SETTLEMENT_STATUS_TONE`·`ACTOR_TONE`) (`badges.tsx`) | 로컬 색맵 |
| 로딩·빈·알림 | `Loading`·`CenterNote`·`Message` · `toast`/`Toaster` | "불러오는 중" 손롤 |
| 껍데기 | `Page`·`MobilePageShell`(모바일 4단 SSOT)·`WorkPage`·`BottomNav`·`TopBar`·`PaneHead`·`PaneBody`·`SectionLabel` | 손 레이아웃 |
| 상세·폼 | `Section`·`DetailGrid`·`FormCard` | |
| 카드 슬롯 | `CardThumb`·`CardTitle`·`CardKind`·`CardRailBadges`·`CardSpecs`·`CardBenefits`/`CardPerkLine`·`CardEvents`·`OptionChips`·`Plate`·`badges()`/`badgeSpecs`·`FavHeart` | 카드 표기 손롤 |
| 가격 슬롯 | `PricePeekRoot`·`PriceAmounts`·`PeriodChips`·`PriceHero` | 요금 손롤 |
| 카드 복합 | `ProductRowCard`(상세 4×2 SSOT)·`ProductCard`(간단 세로 파생) | 페이지에서 슬롯 재조립 |

**준비만 되고 아직 안 쓰는 원자 (2026-07-21 실측 사용처 0):**
`DataTable` · `ObjCard`/`Cards`/`Metric` · `KV`/`DetailRow`/`DetailEmpty`/`Dash` · `Sec`/`HiddenSecs` ·
`Modal`/`Drawer`/`EmptyState`/`ListBox`/`DetailShell`/`VSplit`/`Panel` ·
`Status`/`StatusTag`/`RiskTag`/`SevTag` + `STATUS_TONE`/`RISK_TONE`/`PERK_TONE` · `PriceFare`/`PriceMini`/`OptionsInline`/`CardFacts`

**지우지 않는다**(모바일 분기·토큰까지 규격대로 짜여 있어 다시 만드는 비용이 더 크고, 미사용 export는 빌드에서 트리셰이킹됨).
다만 **"이게 확립된 패턴"이라고 오해하지 말 것** — 선례가 없으므로, 쓰려면 먼저 실제 화면에 맞는지 확인하고 필요하면 원자를 고쳐 쓴다.
새로 쓰기 시작하면 위 표로 옮길 것.

**레거시(쓰지 말 것 → 대체):** `Identity`→`CardTitle` · `SpecLine`→`CardSpecs` · `PriceHeadline`→`PriceHero` · `PriceRows`/`PricePeers`→`PriceFare` · `CardMarks`/`CardPerks`→`CardBenefits`.
**사전 밖(기능 셸):** `InterestRail`·`ChatThread`·`ContractPanel` 등은 원자 아님 — 페이지/도메인 조립.

### 필터 ↔ 카드 축 (product-filters SSOT)
| 축 | 티어 | 카드 원자 |
|---|---|---|
| 기간·월대여·보증 | CORE | `PriceHero` / `PriceAmounts`+`PeriodChips` |
| 상품구분 | CORE | `CardKind` / rail `pt` (`productTypeStyle`) |
| 출고상태 | CORE | rail `st` (`CardRailBadges`) |
| 심사 | CORE | rail/thumb `cd` |
| 연료 | CORE | `CardSpecs` |
| 혜택 | OPT | `CardBenefits` / `CardPerkLine` |
| 프로모 | OPT | thumb / `CardEvents` |
| 주행밴드 | OPT | specs km |
| DYN(제조사·차종…) | dyn | `CardTitle`/`CardSpecs` 파편 · 전용원자 없음(정상) |

옵션(`OptionChips`)은 카드에만 있고 필터 축 없음(검색 haystack만). 손님 카탈로그는 `CREDITS`+`CATALOG_PERKS`(로컬 PERKS 금지).

원자는 전부 `useIsMobile()` 내장 → 페이지는 그냥 갖다 쓰면 웹·모바일 규격이 자동 일치. 원자에 없는 분기를 페이지에서 손대면 그게 드리프트.

## 모바일 = 네이티브 (반응형 축소 ❌)
전 페이지 동일 골격 (SSOT = `MobilePageShell` · `WorkPage` 목록):
1. **TopBar 고정** — 메뉴 · 로그인정보 (`layout`)
2. **페이지 툴바** — 건수/정보 + 검색창
3. **본문** — 목록 또는 페이지 내용
4. **하단** — `BottomNav`/`MobileListDock` + `NavBack`:
   - **이전** = 라우트 이탈 (`history`) — 목록 화면·`/m` 상세
   - **목록** = 같은 페이지 상세→목록 (`list`) — WorkPage 선택 시
   - 홈 이동은 TopBar 메뉴 (하단 홈 버튼 없음)

**홈(매물 검색)** — 업무 4패널이 아니라 매물 카드 화면. 상단=건수·관심 / 하단 독=검색·정렬·필터(공용 원자). 페이지 전용 규격이 아니다.

- `useIsMobile(bp=760)`. 선택 후 WorkPage: stack=상하 / swap=좌우스와이프+버튼(채팅↔계약진행). 바텀시트, 햅틱(`haptic.*`).
- 스크롤 컨테이너 = `.fp-main-pad`(html/body overflow hidden). 고정바=뷰포트 기준.
- 웹=격자 콕핏(고밀도) / 모바일=엄지앱(큰 타깃·본문 담백·**남는 폭은 입력칸이 흡수**).
- **폼 행 SSOT** — `SectionLabel` 아래는 헤더 1줄 + 데이터 1행. 행마다 라벨 재반복 금지(예: 대여료=`개월|대여료|보증금` 한 줄). 원자는 `Input`/`Btn`/`C`/`NUM` 그대로 쓰되, 배치는 화면 폭에 맞게 그리드 비율만 조절.

## 토큰 (`tokens.ts` `C`) — 하드코딩 hex 금지
`ink/mute/faint`(텍스트) · `line/line2`(테두리) · `brand`(강조) · `accent`(링크·포커스) · `danger/ok/warn` · `head`(헤더바탕) · `selected`(선택행) · `zebra`. `#eef4ff→C.selected`, `var(--font-mono)→NUM`, `radius:8→R`.

## 데이터·엔진
- 저장 = `getStore().save/update`(audit 자동). 계약↔차량 상태동기화 = `settlement-engine.applyStepCheck`. 직접 상태변경 금지.
- **사업자등록번호 읽기 SSOT** = `lib/domain/business-identity.ts`. 저장 정본은 partner=`business_number`, user/customer=`business_no`, contract=`customer_business_number`를 유지한다. 레거시 alias는 읽기 fallback만 허용하며, 서로 다른 alias 값은 자동 덮어쓰기·이관하지 말고 `scripts/audit-business-identity.mts`로 충돌 건수를 먼저 확인한다.
- **차량 락** — 계약금 입금(확인) 선점 = `계약중`(목록 노출·마크) · 계약완료 = `출고불가`(목록 숨김). 문의·서류만으로는 잠그지 않는다(여러 영업 병행, 입금 선점이 이김).
  락 주인은 `product.locked_by_contract`. 락 쓰기는 `syncVehicleLock` 한 곳(매 체크마다 재계산 — 분기를 늘리면 해제 누락이 생긴다). 삭제보호는 `blockingContractFor`(락보다 넓음).
- 식별코드 = `lib/domain/ids.ts`(`usr_/sup_/veh_/pol_/chn_`).
- **v3 = 라이브 읽기 / v4 = `v4/` 오버레이 쓰기** (`lib/firebase/rtdb-adapter.ts`). 읽기 = v3 라이브 ∪ v4 오버레이 필드단위 병합, 쓰기는 전부 `v4/{node}/{key}` — **v3 구데이터 write 금지**.
  ※ 초기 설계였던 "v4=Firestore 독립 새집 + 일괄 ETL 이관"은 폐기됨(브리지로 대체). `lib/migrate/v3.ts` 도 함께 삭제(2026-07-21).

## 레인
- 이 저장소는 두 AI 도구 동시 작업. **v3 데이터 연동/브리지 = 다른 도구 담당**. UI·원자·페이지·규격 = 이 규격 따름. 같은 파일 동시편집 시 .next 청크 desync 주의(백지=stale 서버, `.next` 삭제 후 재기동).

## 금지 (드리프트 원흉)
손롤(원자 안 쓰고 raw 컨트롤) · 로컬 색맵 · 하드코딩 hex/height · 모바일 미분기(웹치수 그대로) · 페이지별 별도규격 · 확정 기능 임의변경.
