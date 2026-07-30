# UI/UX 작업지시서 — 정적 리뷰 기반 (2026-07-28)

> 출처: UI/UX **정적** 안티패턴 리뷰(5축 병렬 스캔). **기능·로직·보안·정합성은 대상 아님** — 오직 비효율·중복·규격화·버벅임/느림.
> 역할(→ [AGENTS.md](AGENTS.md) 파이프라인): **커서=구현(노가다) · 클로드/코덱스=게이트 · push는 사람/클로드.** 각 오더는 독립 실행 가능.
> 공통 가드레일(모든 오더): **표시 데이터·정렬결과·필터 의미·기능 불변**(UI/성능/스타일만), 게이트 `tsc --noEmit` + `check:fonts`(Order4는 `check:tokens`), 완료 후 **커서 브라우저로 체감 확인(스샷)**, `git push` 금지.

## 추천 실행 순서 (런칭 내일 기준)
- **먼저(안전·즉효, 리스크 低):** Order 3 → 4 → 5
- **그다음(핫패스 리팩터, 리스크 中 — 커서 구현 후 클로드/코덱스 게이트 + 브라우저 실측):** Order 2 → 1
- 근거: 버벅임 90%는 Order 1(엑셀 뷰)이지만 리팩터 규모가 커서, 안전건 먼저 털고 리팩터는 검증 붙여 신중히.

## 상태
- [ ] Order 1 — 엑셀 뷰 가상화/페이징
- [ ] Order 2 — useIsMobile 전역 구독화 + 카드당 effect 제거
- [ ] Order 3 — 비파인더 화면 디바운스+페이징
- [ ] Order 4 — 토큰 규격화 + check:tokens 가드
- [ ] Order 5 — 인터랙션 폴리시
- [ ] Order 6 — UI 코드 중복 제거 *(dedup 축 스캔 결과 도착 후 추가)*

---

## ⭐ ORDER 1 — 엑셀 결과뷰 가상화/페이징  · 영향 HIGH · 리스크 中
**문제:** 웹 기본 화면인 엑셀 뷰가 필터된 전체 행(~1,600)을 페이징·가상화 없이 전량 렌더. 행마다 ResizeObserver + `priceList`/`productOptions`/`excelCondSignals` 재계산 + 셀 20여개 inline style 스프레드. 컬럼필터 토글이 동기로 전체 재렌더. → 첫 화면 최초페인트·필터·스크롤 버벅임의 근원. (리뷰 3축이 여기로 수렴)

**파일·앵커:**
- `features/finder/ExcelResultsTable.tsx:167`(tbody `rows.map` 전량) · `:186-234`(셀 style 스프레드) · `:94-165`(헤더 style) · `:240`(팝오버 열림 시 매 렌더 재필터)
- `app/page.tsx:379`(`moreN = effView==='excel'?0` → 엑셀에 페이징 미적용) · `:42-43`(PAGE=100/PAGE_HARD=500 패턴 참고)
- `lib/finder/useFinderResults.ts:155-168`(`excelRows` 상한 없음, colFilter/colSort deferred 아님)
- `features/finder/ExcelFilterPopover.tsx:40-47`(체크 토글 → setColFilter 동기)
- `components/product-card-options.tsx:37`(OptionChips 내 ResizeObserver — 행마다)

**작업:**
1. 엑셀에도 카드/리스트와 동일 `limit`(PAGE=100) 슬라이스+더보기 적용(`moreN` 엑셀 0 제거). *윈도잉 대신 페이징이 리스크 낮음 — 우선 이걸로.*
2. 열별 style 객체(`tdX`/`cellPad`/`colLock`)를 map 루프 밖 `useMemo`로 1회 산출 후 재사용.
3. 행을 `React.memo`된 `<ExcelRow>`로 추출 — 변경 행만 갱신.
4. per-row 파생값(`priceList`·`productOptions`·`excelCondSignals`·`fuelDisplay` 등)을 `useFinderResults` 파이프라인에서 1회 사전계산 → 행엔 완성 데이터만 전달.
5. 엑셀 셀 `OptionChips`는 ResizeObserver 대신 CSS `-webkit-line-clamp`.
6. `colFilter`/`colSort`를 `useDeferredValue` 또는 `setColFilter`를 `startTransition`으로.

---

## ⭐ ORDER 2 — useIsMobile 전역 구독화 + 카드당 effect 제거  · 영향 HIGH · 리스크 中
**문제:** `useIsMobile`이 카드 1장당 ~4회 호출 → resize/matchMedia 리스너 수천개(500장×4), 리사이즈 1회에 전부 발화 → 프레임드랍. `ProductMoreMenu`는 웹에서 `null` 반환하면서도 카드당 전역구독 2개 등록(500×2=1000). `useProductPhotos`는 카드마다 `setExtra([])`로 전 카드 이중 렌더.

**파일·앵커:**
- `lib/use-mobile.ts:77-88`(카드마다 subscribe 생성) — 이미 있는 `MobileBpProvider` 컨텍스트 활용
- `components/ProductMoreMenu.tsx:36-43`(구독 effect) vs `:46`(`if(!mobile) return null` — 조기 return이 hook 뒤)
- `components/use-product-photos.ts:8-24` · 진입 `product-card-atoms.tsx:137`
- `components/product-card-options.tsx:23,37,40`(productOptions 재계산 + RO) · `components/product-card-pricing.tsx:250-271`(PeriodPerkBand RO)

**작업:**
1. `useIsMobile`을 `MobileBpProvider` 컨텍스트만 읽도록 전환(전역 1구독). 카드마다 subscribe 금지. (부팅 감지 `isMobileViewport`는 유지)
2. `ProductMoreMenu`: 웹에선 아예 마운트 안 하도록 상위(카드)에서 분기, 또는 구독 effect를 `mobile` 가드 뒤로.
3. `useProductPhotos`: 반환 배열 `useMemo`, `setExtra([])`는 `scrapableSources` 있을 때만, 직접 사진만 있으면 effect 스킵.
4. `OptionChips`·`PeriodPerkBand`: `productOptions` `useMemo`, 칩 줄바꿈 측정 ResizeObserver를 CSS(`flex-wrap`)로 대체 가능하면 제거.

---

## ORDER 3 — 비파인더 화면 디바운스+페이징  · 영향 MED · 리스크 低
**문제:** 상품찾기 본체는 이미 180ms 디바운스+`useDeferredValue`로 잘 됨. 그러나 카탈로그·정산·채팅 검색은 디바운스 전무 + 결과 전량 무페이징 렌더 → 타이핑 끊김·리스트 무거움.

**파일·앵커:**
- `app/catalog/page.tsx:22`(setQ 직결) · `:41-55`(매 키 필터) · `:81`(전량 렌더)
- `app/settlement/page.tsx:69,361`(setQuery 직결) · `:134-152`(정렬 포함 memo 매 키)
- `app/chat/page.tsx:325/331`(setQ 직결) · `:214-216`(`chatRoomPreviewCount` 비메모)
- `app/contract/page.tsx:205`(전량 렌더, 페이징 상한 없음)
- 복제 대상 패턴: `app/page.tsx:42-43,236-239`(디바운스+페이징)

**작업:** 위 4개 화면에 파인더식 180ms 디바운스(또는 `useDeferredValue`) + `slice(0, PAGE=100)` 페이징+더보기 이식. 채팅 `chatRoomPreviewCount`는 `useMemo`.

---

## ORDER 4 — 토큰 규격화(그림자/반경/인버스/포커스/스크림) + 가드 확장  · 영향 MED · 리스크 低
**문제:** 그림자·반경·인버스색·포커스링·스크림 토큰이 `globals.css`에 **이미 있는데(`--shadow-*`,`--radius-*`,`--focus-ring`,`--text-inverse`) 아무도 안 쓰고** 손 rgba로 찍어 값 제각각 — 카드그림자 alpha 3종, 스크림 17종, 포커스링 색이 토큰(네이비)과 다른 색조(파랑). `check:fonts`는 `features/`·정수 폰트크기·리터럴 굵기·색을 못 막음.

**파일·앵커:**
- 그림자 하드코딩 ~25곳: `objcard.tsx:13-14`, `metrics.tsx:36,65`, `buttons.tsx:46`, `ProductCard.tsx:42`, `ProductRowCard.tsx:75`, `detail.tsx:103`, `ContextMenu.tsx:64`, `TopBar.tsx:212,367`, `Toaster.tsx:65,73`, `overlays.tsx:47,80`, `ProductMoreMenu.tsx:201`, `AppTabBar.tsx:105`, `MobileListDock.tsx:58`, `navigation.tsx:115`, `WorkPage.tsx:190,244`, `detail-shell.tsx:65`, `badges.tsx:86`
- 스크림 17종: `overlays.tsx:46,79`, `Toaster.tsx:71`, `ProductMoreMenu.tsx:191`, `BottomSheet.tsx:144`, `ChatThread.tsx:182`, `ContractDocs.tsx:256`, `ProductDetail.tsx:216`
- `#fff` 인버스 10곳: `badges.tsx:67`, `product-card-atoms.tsx:193`, `ProductDetail.tsx:113,222`, `error.tsx:31`, `not-found.tsx:20`, `ContractDocs.tsx:257,259,266`
- 포커스링 `rgba(37,99,235,·)`: `detail.tsx:103`, `VehicleMasterFilter.tsx:76`, `form-controls.tsx:109` (SSOT `--focus-ring`)
- 반경 혼용: `R` vs `'var(--radius)'`(`detail.tsx:103`) vs 리터럴 `4`(`faq/page.tsx:100`, `ContractSign.tsx:106`, `sign/[token]/page.tsx:89,115`, `global-error.tsx:32,36`) · 오프토큰 `settings/page.tsx:255`(6), `ExcelFilterPopover.tsx:73`(2)
- 팔레트 섬: `app/global-error.tsx:16,23,27,36`(웜톤 화석·다크 없음), `app/login/page.tsx`(생 hex 29개·다크 없음)
- 가드: `scripts/check-fonts.mts:12`(walk=app,components만) · `:15`(소수점 4종만 금지)
- **의도된 예외(수정 금지, tokens.ts에 명명만):** `ContractSign.tsx:106`·`sign/[token]` 흰 지면+서명잉크, `m/page.tsx:152` 폰 베젤 → `C.paperFixed`/`C.inkFixed` 상수로 명명

**작업:**
1. `components/ui/tokens.ts` 신설: `SH={cardRest,cardHover,dock,menu,modal}`, `SCRIM={light,heavy}`, `C.inverse(var(--text-inverse))`, `C.focusRing(var(--focus-ring))`. 다크 승격은 `globals.css` CSS 변수로.
2. 위 하드코딩 그림자/스크림/`#fff`/포커스링 → 토큰 치환. 반경 리터럴 `4`/`'var(--radius)'` → `R` 단일화.
3. `global-error.tsx`·`login/page.tsx` 팔레트 섬: 토큰 hex 미러링 + 다크 대응.
4. `scripts/check-fonts.mts` → **`check:tokens`** 확장: (a)walk에 `features/` 추가 (b)FS 6값 외 정수 `fontSize` 금지 (c)FW 외 리터럴 `fontWeight` 금지 (d)생 hex/rgba 금지(예외 화이트리스트). `package.json`에 스크립트 등록.

---

## ORDER 5 — 인터랙션 폴리시  · 영향 MED · 리스크 低
**문제:** 시트 닫힘이 툭 끊기고, 채팅 전송이 낙관적이 아니며, `prefers-reduced-motion`이 무한 애니메이션을 못 끄고, 채팅 이미지에 치수/lazy 누락(CLS).

**파일·앵커:**
- `components/BottomSheet.tsx:72`(`if(!open) return null` 즉시 언마운트) · `:161`(입장 `sheetUp .22s`) · `:138-146`(백드롭 즉시)
- `components/ChatThread.tsx:75-77`(전송 완료 후 append) · `:136`(img 치수·lazy 없음) · `:65-69`(scrollTop 동기)
- `app/globals.css:205-207`(reduced-motion이 menuDrop/sheetUp만) · `:162 attn-pulse`·`:175 fp-badge-pulse`·`:203 fp-page-fresh`(무한)
- `features/finder/FinderToolbar.tsx:105`·`components/ui/buttons.tsx:96`(IconSeg 뷰토글)
- 참고(양호): `transition: all` 없음 · 상품카드 썸네일은 이미 lazy+aspect-ratio

**작업:**
1. `BottomSheet`: 퇴장 트랜지션+언마운트 지연, 백드롭 opacity 페이드인(입장과 대칭).
2. `ChatThread`: 전송 낙관적(임시 메시지 즉시 append, 실패 롤백). img에 width/height(or aspect-ratio)+`loading="lazy"`+`decoding="async"`. 하단고정 scrollTop을 `requestAnimationFrame` 후로.
3. `globals.css`: reduced-motion에서 `attn-pulse`/`fp-badge-pulse`/`fp-page-fresh`/스피너도 `animation:none`.
4. 엑셀 뷰 토글을 `startTransition`으로 감싸고 pending 시 세그먼트 dim(Order 1과 함께).

---

## ORDER 6 — UI 코드 중복 제거 (dedup)  · 영향 MED · 리스크 低
**문제:** `components/ui/`에 광범위한 SSOT(Btn/Input/Select/EmptyState/Kpi/FeedListRow 등)가 있는데도, **5개 화면(finder/inventory/members/settlement/contract)에 걸친 구조적 블록이 복붙**됨. 값어치 최상 3건(#1·#2·#3)만 컴포넌트화해도 중복 대부분 제거.

**추출할 컴포넌트 (심각도 = 반복횟수 × 라인수):**

1. **[최상] `<ListMoreFooter>` + `usePaged` 훅** — "더보기 · N / 전체 보기 / PAGE_HARD 초과 toast"가 문자단위로 3곳 복붙: `features/finder/FinderResults.tsx:88-99`, `features/inventory/InventoryListPanel.tsx:58-86`, `features/members/MembersList.tsx:66-94`, `app/page.tsx:495-502`. `PAGE=100/PAGE_HARD=500` 상수도 `app/page.tsx:42-43`·`InventoryListPanel.tsx:9-10`·`MembersList.tsx:11-12` 3중 정의 → 상수 SSOT로. (Order 1·3의 페이징과 같은 훅 공유)
2. **[최상] `<EntityListPanel>`** — `InventoryListPanel.tsx:36-91` ≈ `MembersList.tsx:38-98` 패널 껍데기 통째 near-duplicate(create-row→empty→map→더보기). 차이는 renderRow·unit·label뿐 → 제네릭 패널 1개. (row는 이미 `list-rows.tsx FeedListRow`로 분리됨 — 껍데기만 문제)
3. **[상] `<DetailPane title count? actions? empty>`** — `PaneHead+PaneBody+(sel?내용:CenterNote)` 6+곳: `settlement:224-311`(한 파일 3회), `members:330-364`, `contract:257,289,293`, `chat:235,246,251`, `policy:275`.
4. **[상] `<AdminToolCard>` + `<LogOutput>`** — dev 작업카드(카드+SectionLabel+설명+Btn행+`<pre>`로그)가 `app/dev/page.tsx:265-362`에 6회. 로그 `<pre>`(pre-wrap·FS.cap·C.mute·NUM)는 dev 5회 + `SheetSync.tsx:487` + `diag/page.tsx:201-205`.
5. **[중] `Kpi`에 `money` prop 추가 → 로컬 `MoneyCard` 제거** — `settlement:43-59 MoneyCard`가 `ui/metrics.tsx:76 Kpi`와 동일 박스(won 포맷+raw tone만 차이). 사용처 `settlement:262-291`. 2×2 배치는 `KpiRow`로.
6. **[중] `msgClock` short 변형** — 짧은 날짜시각(`toLocaleString ko-KR month/day/hour/minute`)을 3파일 재구현: `audit/page.tsx:20`, `SheetSync.tsx:408`, `SnapTrace.tsx:31`. SSOT `lib/format.ts:20 msgClock`에 변형 추가 후 교체.
7. **[중하] `fmtRate(v)`** — 비율→% 중복: `settlement:40 rateLabel`(basis 10000), `list-rows.tsx:322-325`(basis 100). `components/ui/formatters.ts`(현재 won/fmtNumber/fmtPhone)에 추가.
8. **[중] `<ChipSetting label caption options hint?>`** — 설정 칩섹션(SectionLabel+caption+FilterChips+hint) `settings/page.tsx:261-311` 5회.
9. **[중] `<Panel pad? scroll?>`** — `border 1px C.line·R·C.taupeBg·overflow:hidden` 박스를 SSOT 없이 raw로 ~10곳(`audit:139,149`·`contract:270`·`settlement:298`·`AdminSettlementSheet:77,90`·`PriceMatrix:93`·`ProductDetail:25`·`SnapTrace:38`·`PhotoUpload:163`). `ListBox`와 정합.
10. **[중] `<EmptyResult filtered emptyLabel onReset?>`** — "결과없음(+조건해제)" 7곳(`FinderResults:42-49`·`InventoryListPanel:41-47`·`MembersList:45-51`·`ChatRoomList:23`·`contract:198`·`policy:233`·`settlement:221`). #1과 짝.
11. **[중하] `<PreviewRunButtons>`** — ghost 미리보기+danger 실행(busy시 '처리 중…') 쌍: `dev:290-325`, `members:352-358`.
12. **[하·빈도최상] `<Hint>`/`<Caption>` 텍스트 원자** — `color:C.faint` 보조문구 전체 163회, 대부분 `FS.sub|cap+C.faint+lineHeight1.45` 동일. 가치는 낮지만 빈도 압도적. Order 4(토큰) 이후 판단.

**손댈 필요 없음(양호·참고):** `list-rows.tsx`(FeedListRow SSOT), create-row 공용화(`CreateListRow`), 상품카드 원자분해 — 이미 잘 됨.

**작업 권장:** **#1·#2·#3 먼저**(5개 화면 구조 복붙 제거) → #4~#8 국소 → #9~#12 정리. #1의 `usePaged`는 Order 1·3의 페이징과 **같은 훅으로 공유**하면 3개 오더가 한 SSOT로 수렴.

---

## 백로그: 매물 사진 일괄 다운로드 / 손님 공유 (2026-07-30 접수)

**요청**: ① 영업자가 매물에 올라온 사진을 **한 번에 다운로드** ② 더 좋은 건 그 사진을 **손님에게 바로 공유**.

**판정: 둘 다 할 만하다. 오히려 ②가 더 쉬울 수 있다.**

- 사진은 이미 `photos[]`·`image_urls[]` 로 배열 보유(`entities.ts:100-101`) — 목록은 그대로 쓰면 됨
- **② 손님 공유** = `navigator.share({ files: [...] })` (Web Share API Level 2). 모바일에서 **카톡·문자로 이미지 자체가 바로 전달**된다. 이미 링크 공유에 `navigator.share`를 쓰고 있어(`app/m/[code]/page.tsx:101`) 확장이 자연스럽다. ZIP 불필요
- **① 일괄 다운로드** = 이미지들을 fetch → JSZip → 단일 zip 다운로드. 데스크톱용

**선결 과제(이게 진짜 작업량)**
1. **Firebase Storage CORS 설정** — 다른 오리진에서 `fetch(url)`로 blob을 못 받으면 둘 다 불가. `gsutil cors set` 1회 설정 필요. 이게 안 되면 아무것도 안 됨
2. `navigator.canShare({ files })` 지원 분기 — iOS 15+/안드로이드 Chrome. 미지원 시 ①(zip 다운로드)로 폴백
3. 용량 — 장당 최대 3MB × 5~10장 = 15~30MB. 공유 시트가 느려질 수 있어 **진행률 표시 + 장수 상한** 필요
4. 외부 URL 사진(`photo_link`, 시트 원본)은 CORS를 우리가 못 여는 경우가 있음 → 그런 건 제외하거나 프록시 경유

**권고 순서**: CORS 설정 확인 → ② 공유 먼저(현장 가치가 큼, 코드 적음) → ① zip은 데스크톱 보조로.

**주의**: 손님 공유는 매물 사진만. 계약 서류·면허증 등 PII 이미지가 같은 경로에 섞이지 않게 소스를 `photos`/`image_urls` 로 한정할 것.

---

## 백로그: 목록 행 구성 규격 (2026-07-30 접수 · 문의 목록 기준)

**요청**: 목록을 2줄로 할지 3줄로 할지, 어떤 정보가 필요한지 제대로 정하자.
지시 = **맨윗줄 = 차량번호 + 차명 (좌) / 대화 일시 (우)**, 그 밑에 필요한 내용.

### 현재 (3줄) — 문제
```
133하2383 E-클래스 W213      · 에스에이 09:33
[상담] S0035
[사진] 18장
```
- **3줄 = 세로 낭비** (B2B 밀도 원칙 위반). 한 화면 정보량이 줄어든다
- 우측 상단이 `· 에스에이 09:33`로 **상대방+시각이 뒤엉킴** → 지시대로 시각만 남겨야
- 2번째 줄을 **상태뱃지+영업자코드**가 통째로 차지 — 코드(S0035)는 이름이 있으면 중복
- **마지막 메시지가 3번째 줄로 밀림** — 채팅 목록에서 가장 중요한 정보인데 맨 아래

### 제안 (2줄)
```
133하2383 E-클래스 W213                    09:33
[상담] 에스에이 · [사진] 18장                 (2)
```
| 줄 | 좌(가변·말줄임) | 우(고정) |
|---|---|---|
| 1 | **차량번호 + 차명** | **대화 일시** |
| 2 | 상태뱃지 + **상대방** + 마지막 메시지 | 안읽음 수 |

**근거**
- 상대방은 "누구와의 대화"라 2줄로 내리고, 1줄 우측은 지시대로 **시각만**
- 마지막 메시지를 2줄로 승격 — 채팅 목록의 본질
- 영업자코드는 화면에서 제거(이름과 중복). 관리자만 필요하면 관리자 역할에서만 노출

**역할별 상대방**: 영업자→공급사명 / 공급사→영업자명 / 관리자→영업자(+공급사는 제목 뒤 suffix, 현행 `providerSuffix` 유지)

**적용 범위**: 이 2줄 규격을 **문의·계약·재고·회원·정책 목록 전체에 동일 적용**(`FeedListRow` 하나만 고치면 전파). 각 화면은 1줄 제목·2줄 내용만 다르게.

**관련**: `components/list-rows.tsx:104 ChatRoomRow` · `components/ui/feedrow.tsx`(FeedListRow SSOT) · MOBILE_REDESIGN.md 규격표

---

## 목록 행 규격 (2026-07-30 확정) — **위 「2줄 규격 제안」을 대체**

### 3줄 · 역할 기반 통일
필드가 아니라 **역할**로 통일한다. 화면마다 가진 데이터가 다르기 때문(실측: 문의·계약은 연식·연료·주행·배기량이 **0%**, 매물만 93~100% 보유). 필드로 규격을 잡으면 문의·계약에서 빈 줄이 생긴다.

```
① 주제   이 행이 무엇에 관한 것인가        [우측: 시각 or 상태]
② 식별   그것을 특정하는 값 + 보조맥락
③ 맥락   이 화면에서 왜 중요한가           [우측: 카운트 or 뱃지]
```

| 화면 | ① 주제 | ② 식별 | ③ 맥락 | 우측① |
|---|---|---|---|---|
| **홈**(매물) | 차량명 | 차번 · 연식 · 연료 · 주행 · 배기량 | 우대 · 이벤트 | 가격 |
| **재고** | 차량명 | [상태][상품유형] 차번 · 스펙 | 공급사 (+검수) | — |
| **문의** | 차량명 | [상태] 차번 · 상대방 | 마지막 메시지 | 시각 (③우측 안읽음) |
| **계약** | 차량명 | [상태] 차번 · 계약코드 | 계약자 · 계약일 | 진행 n/5 |
| **정산** | 계약자 | [상태] 차번 · 계약일 | 공급사 · 영업자 · 정산코드 | 금액 |
| **회원·파트너** | 이름 | [역할][활성] 코드 · 소속 | 연락처 | — |
| **정책** | 정책명 | [유형][전용/공용] | 코드 · 심사 | — |

> **정산 ①만 예외로 계약자** — 정산 레코드에 이 **0/14**(차번은 14/14). 없는 필드를 규격이라고 강요하면 빈 줄이 된다.


**원칙**
- **차번은 ①이 아니라 ②로.** ①은 차량명만 → 매물 카드(`①차명 ②차번·스펙 ③우대조건`)와 같은 리듬이 된다
- 화면 간 이동 시 **눈이 같은 자리를 본다**는 게 통일의 목적. 값이 달라도 자리는 같다
- 데이터가 없는 칸은 **비우지 말고 그 화면에서 의미 있는 값으로 채운다**(문의 ② = 차번 + 상대방)

**밀도**: 3줄 = 모바일 약 96px. 2줄(76px) 대비 화면당 8줄 vs 10줄. 통일성을 택하되 줄간격·패딩을 조여 보상한다([B2B 밀도 원칙](MOBILE_REDESIGN.md) 유지).

**구현**: `components/ui/feedrow.tsx`의 `FeedListRow`가 이미 `lines: ReactNode[]` 3줄 SSOT다. 원자는 그대로 두고 **각 화면이 3줄에 무엇을 담는지**만 위 표대로 맞춘다.

**진행**: 문의(`ChatRoomRow`) 적용 완료 — `roomModel()`(차명)·`roomPlate()`(차번)로 분리. 계약·정산·재고·회원은 후속.

### 적용 현황 (2026-07-31)
| 화면 | 상태 |
|---|---|
| 문의 | ✅ 차번을 ①→②로 내림 (`roomModel`·`roomPlate` 분리) |
| 재고 | ✅ ②③ 뒤바뀐 것 교정 — ②=상태·차번·스펙, ③=공급사 |
| 회원·파트너 | ✅ ②에 상태뱃지+코드·소속 병합, ③=연락처 |
| 계약 | ✅ 이미 규격 일치(변경 없음) |
| 정산 | ✅ 구조 일치. **단 데이터 결손** — `net_amount` **0/14**라 우측 금액이 항상 `0원`으로 뜬다(정산엔진이 채워야 할 값). `contract_date`도 결손이라 이관 스크립트가 백필 |
| 정책 | ✅ 구조 일치 |
| 홈(매물) | ProductRowCard 별도 규격 — 매물 카드는 이 표의 원형이므로 변경 없음 |
