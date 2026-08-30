# freepasserp4 규격 (SSOT) — 손대기 전 필독. 이거 어기면 매번 틀어진다.

저신용·무심사 렌터카 3자 마켓 ERP (공급사·영업자·관리자 + 손님). Next.js 15 App Router + TS, dev :4004.

## ★★화면·페이지 일이면 먼저 읽어라 — `docs/건물도면.md`
이 ERP 는 층(라우트) 37개 · 동(棟) 6개(업무·로비·손님·별관·신관·기계실)다. **같은 동이면 문·창문이 같아야 한다.**
어느 층이 어느 규격을 따르는지, 로비·옥상처럼 **달라도 되는 곳은 왜 다른지**가 그 도면에 있다.
새 층(라우트)을 올리면 **도면에 한 줄 등록**해야 한다 — `npm run check:building` 이 잡는다.
고쳐서 좋아졌으면 `npm run check:building -- --tighten` 으로 **도면도 같이 낮춘다**(안 낮추면 다음 사람이 그 불을 안 믿는다).
사장님 2026-08-30 「십 층짜리 건물을 지었으면 문은 다 동일해야 되고 창문 다 동일해야 되는 거지」

## ★영업자 구글시트 일이면 먼저 읽어라 — `docs/영업자시트-매뉴얼.md`
공급사시트 → 판매시트 취합은 **ERP를 안 거치는 별도 파이프라인**이다. 규칙·주소·금지목록·사고이력이
전부 그 문서에 있다. 기억으로 하지 마라 — 매번 틀어져서 매뉴얼로 박아 둔 것이다(2026-08-14).

## 협업 파이프라인 — ★2026-08-30 개편 (상세: docs/AI_COLLABORATION.md)
> 사장님 2026-08-30 「**코덱스는 검사만 하고 커서는 보완만** 하기로 했거든. 그러니까 **클로드가 메인으로 다 옮겨놓고 이거를 자동으로** 하기로 했거든.」

- **클로드코드(나) = 본체를 «직접» 만든다 + 자동화를 소유한다.** 설계·게이트뿐 아니라 **구현도 내가 한다.**
  «오더만 제안하고 빠지는» 예전 방식은 폐기(2026-08-30). 커서에 넘길지는 내가 판단하되 기본은 직접.
  자동 파이프라인(`scripts/hourly-sync.mts` 등 시트 발행·ERP 동기)도 **내 소유**다 — 「상위 시트는 남의 담당이라 재발행 안 한다」는 옛 판단은 폐기.
- **커서 = 보완만.** 내가 만든 것의 빈칸 채우기·반복 치환. 새 구조·규격을 만들지 않는다.
- **코덱스 = 검사만.** 독립 전수검증(sim·빌드·타입·적대). **고치지 않는다** — 어긋난 것을 보고하면 내가 고친다.
- 검증 기준 = **사용자 원래 요구사항**(내 설계 아님). **중요 기술·범위·보안 결정은 사용자 승인.**
- 오더를 낼 때는 `docs/오더-양식.md` — 범위·완료조건을 기계가 읽게 적고 `scripts/check-order.mts` 로 받는다.

## 절대원칙
1. **페이지 = 공용 원자·껍데기 배열만.** 페이지 전용 규격 금지. 로직·스타일 손롤 금지. 있는 원자 안 쓰고 raw `<button>/<input>/<select>/<div style>` 새로 짜는 순간 규격 붕괴. 새 UI가 필요하면 페이지가 아니라 **원자를 고치거나 만든다**(SSOT). 한 화면만 쓰더라도 그건 공용 규격이다.
2. **데이터·상태·디자인 = 단일출처.** 저장은 `getStore()`, 상태동기화는 엔진(`settlement-engine`) 경유. 페이지가 직접 `vehicle_status` 등 바꾸지 말 것.
3. **웹·모바일 양립 + 모바일다움.** 신규/변경 기능은 웹·모바일 양쪽 동작. 모바일은 반응형 축소가 아니라 **네이티브 앱**.

## 컨트롤 규격 (원자가 자동 처리 — 페이지에서 height 직접 쓰지 말 것)
- 높이: **md = 웹32 / 모바일40**, sm = 웹28 / 모바일36. 칩 = 웹28(sm) / 모바일40(md).
  **lg = 웹44 / 모바일48 — 인증·손님 폼 «한 장짜리» 화면만**(`/login` 등). 업무동에 쓰면 콕핏이 헐거워진다(2026-08-30 추가).
- 토큰 = `CTRL`·`ctrlH`·`ctrlFs`·`ctrlInputFs`·`ctrlChipH` (`tokens.ts`). 페이지에서 height 숫자 금지.
- 입력·버튼 폰트: **모바일 16px 통일**(검색·정렬·필터·칩 동일 · iOS 줌 방지), 웹 13(md)/12.5(sm).
- 모바일 버튼 **가로 패딩 넉넉** (좁게 만들지 않음). 높이는 40 유지.
- 같은 줄에 서는 컨트롤 = 같은 size(툴바·하단독=전부 md). 하단독은 바(56)라 md(40)가 제 치수다.
  ★라벨이 붙은 버튼의 아이콘은 `ICON.md` — 옆 버튼과 같은 글리프여야 한다. `ICON.xl`(20)은 **맨 글리프**(라벨 없는 아이콘 버튼)만.
  (2026-08-30 `NavBack` 라벨형이 sm(36)·ICON.xl 이라 옆 「공유하기」(md 40·ICON.md)와 어긋나 있던 것을 md 로 맞췄다.)
- 라운드 = `R`(4, 각짐) · 색 = `C.*` · 모노숫자 = `NUM` · 선택행 배경 = `C.selected`.
- 바 높이 = `--fp-bar-h` (웹·모바일 56). 메뉴·건수툴바·필터헤드·하단독 동일.
  ★예외 하나 — **모바일 상단바만 `--topbar-h: 48`**. 머리에서 누르는 것을 다 내려 «상태 한 줄»만 남았는데
  56 이면 빈 높이가 남아 머리가 목록에서 떨어져 «붕» 뜬다(사장님 2026-08-30 「붕 떠 보이게 하면 안 돼」).
  터치 대상이 아니라 40 규격에 묶일 이유도 없다. 하단 홈바·독은 56 그대로.

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
1. **TopBar 고정** — **웹·모바일 동일하게 남색 띠**(사장님 2026-08-30 「웹도 상단 헤더 똑같이 남색의 반전으로, 모바일이랑 동일하게」).
   좌=`[아이콘] 이 페이지 N건`. 모바일은 여기까지(누르는 것은 전부 하단 홈바) · 웹은 좌 전체메뉴 + 우 오늘·소속·이름. (`layout`)
   띠(면)는 전자계약 머리(`components/sign/sign.css` `.c-head`)와 **같은 색·같은 짜임**.
   ★★**브랜드 표식은 안 세운다** — 마크도 워드마크도 없다(사장님 2026-08-30 「프리패스는 빼자,
   **노브랜드로 아무것도 안 보여야** 되는 거니까」). 공급사·영업자가 같이 쓰는 판이라 우리 이름이 서면 안 된다.
   도면에 없는 라우트의 폴백도 브랜드명이 아니라 **빈 문자열**이다.
   ⚠ 색은 **원자에 칠하지 않는다** — `.fp-onbar` 안에서 «토큰만» 뒤집으면 `C.*` 쓰는 원자가 전부 따라온다.
   ⚠ 칠하는 주체는 **CSS**다(JS `useIsMobile` 아님) — 첫 방문엔 쿠키가 없어 SSR 이 데스크톱으로 잡혀 흰 띠가 번쩍인다.
   ⚠ `.fp-onbar` 는 **전체메뉴 «버튼»에만** 건다 — 드롭 «패널»까지 뒤집히면 메뉴 글자가 남색 위 남색이 된다.
2. **페이지 툴바** — 건수/정보 + 검색창 ※**홈은 이 줄이 없다**(아래)
3. **본문** — 목록 또는 페이지 내용
4. **하단** — 탭 라우트=`AppTabBar` **홈바(홈·검색·설정)** / 그 밖=`BottomNav`·`MobileListDock` + `NavBack`:
   - **이전** = 라우트 이탈 (`history`) — 목록 화면·`/m` 상세
   - **목록** = 같은 페이지 상세→목록 (`list`) — WorkPage 선택 시
   - 홈 이동은 하단 홈바 (상단바에는 버튼이 없다)
   - ★**하단 실행독 = 꽉 채운 두 칸**(전자계약 `.c-footer.wiz` 와 같은 짜임 · 사장님 2026-08-30
     「하단에 버튼을 꽉 채워서 주요 · 비주요 두 개만, 착한거래 하단 버튼처럼」):
     **비주요(이전)=고정폭 92** · **주요(공유·확정 등)=나머지 전부**. 92 는 `.sign-root .btn-prev` 와 같은 값.
     높이는 업무동 규격 md(40) 유지 — 바가 56이라 40+8×2 로 딱 맞는다(lg 44/48 은 인증·손님 폼 전용).
     ⚠ 독에 넣는 버튼을 `<span>` 등으로 «감싸지 마라». 폭 규칙이 `__actions > .fp-press` 직계 선택자라
     한 겹만 끼어도 안 먹는다. 감싸야 하면 `display:contents`.

**하단 홈바 = 홈 · 검색 · 설정 셋**(`lib/tabbar` `appTabsFor` SSOT).
★**폰에서 하는 일은 「상품 찾아서 손님한테 보내기」뿐이다**(사장님 2026-08-30 「모바일에서는 그냥 상품 찾고
손님한테 공유하는 것만 … 하단바를 실제로 쓰는 것만 넣자」). 그래서 계약진행·재고관리·계약문의·전체메뉴는
**폰에 없다**(데스크톱에서 한다). 큰 글리프(`ICON.tab`)+작은 라벨(`FS.cap`), 흰 바탕·윗선 하나.
- **검색 탭은 라우트가 아니라 행동**(`AppTab.action='search'`) — 지금 페이지가 `lib/appbar` `search` 슬롯에
  등록해 둔 시트를 하단에서 연다. 등록이 없으면 `/finder` 로 데려간다 → 탭 수는 어느 화면에서나 셋 고정.
- **손님 공유는 하단바에 없다** — 「이 차」를 보내는 일이라 목록이 아니라 상세(`/m/[code]` 하단독 「링크 공유하기」)에 붙는다.

**홈(매물 검색)** — 업무 4패널이 아니라 매물 카드 화면. 페이지 전용 규격이 아니다.
★**검색창을 목록 위에 깔지 않는다**(사장님 2026-08-30 「검색 창을 없애고, 검색 버튼을 누르면 검색과 필터가 나오는 형태 — 당근이랑 동일하게」).
검색어·조건은 **하단 「검색」 탭 하나** 뒤에 같이 든다 — 자리는 `lib/appbar` `search` 슬롯(AppTabBar가 그린다),
내용은 finder 「검색·조건」 시트 = 검색칸 + **`FinderMobileFilters`(모바일 빠른필터)**. 목록은 첫 줄부터 상품이다.
★**폰 필터는 웹 사이드바와 규격이 다르다** — 접이식(`FilterGroup`) 아님, **전부 펼친 칩 줄**을 쌓아 연달아 찍는다.
  축도 줄인다: 인기차종·제조사·모델·월대여료·보증금·주행거리·연식·연료·심사·우대조건·정렬 **만**
  (사장님 2026-08-30 「섹션으로 이렇게 하는 게 아니라 … 제일 많이 쓸만한 것만 딱 정리해서 우루룩」).
  기간·상품구분·이벤트·색상·차종분류·약정주행·공급사는 **웹에만** 남긴다.
  ⚠ 값·집계는 웹과 같은 모델(`FinderFilterPanelModel`)을 쓴다 — 갈라지면 웹에서 건 조건이 폰에서 안 보이는 «숨은 필터»가 된다.
★**검색과 필터를 나누지 않는다** — 나누면 대수가 두 군데서 세어져 어디서 줄었는지 화면이 말해주지 않는다.
  (당근은 나눠 있지만 그건 당근 필터가 「칩 한 줄」이라 목록 위에 상시 노출되기 때문이다. 우리 조건은 축이
  열 개가 넘어 상시 노출이 안 되고 어차피 시트다 — 시트가 하나면 검색칸을 그 위에 얹는 게 이득.)
⚠ 시트 열 때 **자동 포커스 금지** — 키보드가 조건 패널을 덮어, 조건 보러 온 사람이 매번 키보드를 내려야 한다.
⚠ 검색은 즉시(디바운스) 반영 · 조건만 적용/취소(draft)를 탄다 — 시트의 「취소」는 조건만 되돌린다.

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
