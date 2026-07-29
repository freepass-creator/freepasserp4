# 모바일 구조 재설계안 — 네이티브 틀로 전환 (2026-07-29)

> 출처: 모바일 아키텍처 4축 병렬 구조분석(골격·세부페이지·인터랙션·프리미티브).
> 원칙: **임시방편(:active 몇 개) 아님 — 틀 자체 교체.** 웹은 건드리지 않고(모바일 분기만) 모바일 골격을 네이티브로.
> 역할: Claude=설계+위험영역(auth/라우팅/셸) 게이트 · Cursor=구현+브라우저 반복 · push는 사람/Claude.

## 진단 요약 (왜 "웹 좁힌 느낌"인가)
- **기반은 이미 완성**: BottomSheet(스와이프·트랜지션 완비)·AppTabBar·Toaster/confirmDialog·haptics·safe-area·tokens(모바일 치수 내장). ← 살릴 자산.
- **틀이 웹**: 모바일 화면 프레임 SSOT 없음 → `position:fixed top:var(--topbar-h)` 복붙 3~4벌. 앱바가 전역 TopBar라 **제목 위·컨트롤 아래 분리**. 마스터→상세가 **`selected` 토글 오버레이**(URL·뒤로가기·전환 없음). 하단바 3~4겹·safe-area 8곳 재계산.
- **상세가 웹 pane**: ProductDetail만 네이티브식. 계약·정산·회원은 **폼그리드/표(라벨116px+값)** + per-record swap 세그먼트가 스크롤을 대체. 히어로·그룹섹션·chevron·sticky 액션 없음.
- **인터랙션 배선 누락**: `.fp-press`·haptics 있지만 **목록 행·카드에 안 붙음**. 스켈레톤 0. Drawer/Modal 전환 전무. reduced-motion `.attn-dot` 버그.
- **콘텐츠 프리미티브 갭**: NavRow·ListGroup·Segmented(텍스트)·Switch·RadioRow·Skeleton·ActionSheet·SheetSelect 없음.

## Layer 0 — 먼저 결정할 것 (아키텍처 전제)
**타깃이 웹뷰/PWA인가, React Native 실네이티브인가?** (4축 모두 지적)
- 현재 스택 = Next.js DOM + CSS-in-JS. **PWA/웹뷰면 아래 Phase 그대로 진행.**
- RN 실네이티브면 프리미티브 재사용 불가 → 먼저 `tokens.ts`를 raw값+플랫폼 어댑터로 이식하는 레이어부터.
- **가정: PWA/웹뷰**(ERP4 = 이 웹앱을 공급사/영업에게 제공). 아니면 알려줘 — 계획이 달라짐.

---

## Phase 1 — 전역 인터랙션 레이어 (즉효·저위험, 6파일) ⭐ 먼저
모든 화면이 즉시 "앱처럼 반응". "터치 가능한 건 반드시 (프레스 + 내장 햅틱)" 단일 계약.
- `components/ui/buttons.tsx` — Btn/IconBtn/IconSeg onClick에 `haptic.tap()` 내장(변형 prop)
- `components/ui/feedrow.tsx:124` — 행 onClick 햅틱 + `.fp-card-row:active` 배경 눌림(스케일 금지 정책 유지)
- `components/ProductCard.tsx`·`ProductRowCard.tsx` — Link 탭 `haptic.nav()`
- `app/globals.css` — `.fp-card-row:active`, 전역 `-webkit-tap-highlight-color:transparent`(button/a/[role=button]), shimmer·drawer 키프레임, reduced-motion을 **클래스 나열로 전환 + `.attn-dot` 펄스 버그 수정**
- `components/ui/feedback.tsx` — `<Skeleton>`/`<FeedRowSkeleton>` 신설 → 목록·상세 로딩을 스피너에서 스켈레톤으로
- `components/ui/overlays.tsx` — `useEnterExit(open,ms)` 훅 추출(BottomSheet 로직) → Drawer(우측 슬라이드)·Modal(모바일 슬라이드업) 입·퇴장 트랜지션
- **리스크 낮음(전역이나 시각만), 웹도 개선됨. tsc+check:tokens.**

## 대전제: B2B 밀도 (2026-07-29 확정)
이 ERP는 **B2B 업무용**이다. B2C 앱보다 **작고 조밀하게**, 대신 **잘 보이게**가 원칙 — 밀도는 축소가 아니라 기능이다(영업자·공급사가 하루 종일 목록을 스캔·비교한다).
- **모바일이라고 폰트를 키우지 않는다.** 본문 13px 유지(FS.body). B2C 표준(14~16px)으로 올리는 제안은 반려.
- 세로를 먹는 **중복 요소 제거**(예: 하단 세그먼트가 이름을 말하는데 패널헤드 반복 → 헤드 생략).
- 가독성은 **크기가 아니라 렌더링·대비·트래킹**으로: `text-rendering: optimizeLegibility` 금지(한글 획이 굵고 불균일해짐), 전역 `letter-spacing: -0.01em`, 굵기는 반 단계만.
- 폭이 모자라면 라벨을 아이콘으로(입력 폭 우선 — 채팅 입력행 예외 참조).
- 비교 기준은 erp3(`D:\dev\freepasserp3-latest`) CSS 토큰 실측.

## 모바일 규격표 (SSOT · 2026-07-29 확정) — 「틀은 동일, 내용만 다르게」
전 화면 감사(골격·컨트롤·밀도 3축) 결과로 확정. **개별 화면에서 임의로 벗어나지 말 것.** 새 화면도 이 표대로.

### 골격
```
① 상단바   PageStatus(아이콘 + 이름 + 건수)        ← 전 화면 동일
② 툴바     검색·필터·정렬 (있는 화면만, 같은 자리)
③ 본문     단일 스크롤 (중첩 금지)                  ← 여기만 내용이 다름
④ 하단독   [목록/뒤로] + 액션                        ← 전 화면 동일
```
- 셸 = `WorkPage`(목록+상세) / `MobilePageShell`(단일) / `Page`. raw 골격 금지.
- 상세 진입 = 제자리 fixed 오버레이. **예외: 매물상세(`/m/[code]`)만 route push** — 손님 공유 URL이 필요.
- 하단독 = `BottomNav` 하나로. 자체 fixed 래퍼·safe-area 재계산 금지.
- 건수 단위 = **건** (매물만 **대**).

### 치수 (모바일)
| 항목 | 값 | 비고 |
|---|---|---|
| 컨트롤 높이 | **36** (md·sm 동일) | `CTRL`·`--fp-ctrl-h`. size로 갈리지 않음 |
| 바 높이 | **56** | 36 + pad-y 10×2 |
| **좌우 패딩(전 요소)** | **12** | 바·독·툴바·목록행·PaneHead/Body·폼컨트롤 전부. `ctrlPadX()` |
| 섹션 간 세로 | **12** | 컨테이너 gap만. 자식이 marginTop 중복 금지 |
| 목록 행 | `8px 12px` · gap 10 · 높이 **76** | `FeedListRow` |
| 아이콘 | `ICON` sm14·md16·lg18·xl20 | 숫자 하드코딩 금지 |

### 타이포 (역할 고정)
| 역할 | FS / FW / 색 |
|---|---|
| 목록 행 제목 | title 14.5 / **title 650** / ink (700 금지) |
| 패널·섹션 제목 | title 14.5 / title 650 / ink |
| 카드 밖 캡션 | cap 11 / meta 500 / faint |
| **정보행** | body 13 / **라벨 mute · 값 ink** — 구현은 `DetailRow` 하나만 |

### 컨트롤
- 셀렉트: 모바일 = **`SheetSelect`**. 원시 `<select>` 금지.
- 삭제 = 아이콘+텍스트(danger) · 조건 해제 = ghost 텍스트 버튼.
- `variant="bare"`도 높이는 `ctrlH` 유지(탭 타깃 붕괴 방지).

## 모바일 컨트롤 규격 (SSOT rule · 2026-07-29 확정) — 중구난방 방지
버튼 표시를 규격으로 고정. 개별 임기응변 금지.
| 종류 | 표시 | 예 |
|---|---|---|
| 범용 네비/툴바(화이트리스트만) | **아이콘 only** | 뒤로·닫기·메뉴·검색·필터·정렬·공유·더보기 |
| 주요/결정적 액션(독·CTA·폼) | **아이콘+텍스트** | 저장·취소·삭제·수정·승인·정산확정·계약문의·사진 추가 |
| 시트 푸터 | **텍스트** | 닫기·취소·적용 |
| 뷰 전환(세그먼트/탭) | **텍스트** | 목록·채팅·계약진행 / 간단·상세·엑셀 |

**규칙: 아이콘 only는 위 화이트리스트로만. 그 외 전부 라벨 필수.** `Btn.mobileIcon`은 화이트리스트 액션에만 사용. 전 버튼 이 규격으로 정렬(audit).

**예외 — 채팅 입력행(모바일):** 첨부·보내기는 **아이콘 only**. 라벨을 달면 입력창 폭이 죽어 메시지 작성이 어려워진다(입력 폭 우선). 웹은 라벨 유지. audit에서 위반으로 잡지 말 것. (`components/ChatThread.tsx` 입력행)

**데스크톱 전용 스코핑(규격 위반 아님):** 모바일서 부적절하거나(엑셀 파일 업/다운로드) 저빈도인 기능은 **모바일 미제공이 정상**(예: 정산 가져오기·정산서·VAT 정산서 = 데스크톱 전용). 이건 "기능 소실"이 아니라 의도된 스코핑 — audit에서 위반으로 잡지 말 것. 단 **앱 내 조회성 기능**은 가급적 모바일서도 접근 가능하게(파일 I/O만 데스크톱).

## Phase 2 — 콘텐츠 프리미티브 신설 (그룹리스트 틀) ⭐ 레버리지 최대
세부페이지·목록·폼이 한 번에 네이티브 그룹리스트로.
- **`NavRow`** `{icon?,label,value?,badge?,chevron?,onClick?,href?,danger?}` — 44px, 우측 값+chevron, inset divider. (`ui/list.tsx ListRow` 대체)
- **`ListGroup`/`GroupHeader`/`GroupFooter`** — 라운드 카드 + inset 구분선 + 섹션 캡션·footnote. (`ui/detail.tsx Section` 승격)
- **`Segmented<T>`** — 균등폭 텍스트 세그먼트 + 슬라이딩 인디케이터. (`IconSeg` 로직 재사용)
- **`Switch`·`RadioRow`·`CheckRow`·`FieldRow`** — 네이티브 폼 행(불리언 스위치·라디오). `ToggleChips` 우회 해소.
- **`ActionSheet`** — BottomSheet 위 얇은 래퍼 `{actions[],cancel}`. `ProductMoreMenu`·삭제확인 흡수.
- **`SheetSelect`** — `Select`(raw select) 모바일 변형 = BottomSheet + RadioRow(검색가능).
- (소) `Stepper`(숫자 +/−)·`Avatar`·`toast` undo 액션.
- **신설 위주라 리스크 낮음. 기존 Section/ListRow는 alias로 점진 대체.**

## Phase 3 — 세부페이지 틀 전환 (DetailScreen)
Phase 2 프리미티브 위에서 상세를 네이티브화.
- **`DetailScreen`**(단일 스크롤 + sticky 액션 슬롯) · **`DetailHero`**(제목+상태+지표, 본문 최상단) · **`DetailSection`**(=ListGroup) · **`DetailRow`**(=NavRow, 인라인 편집 스왑) · **`StickyActionBar`**.
- **ProductDetail이 이미 레퍼런스** → 히어로·섹션 추출해 SSOT화.
- 적용: 계약(ContractPanel/Sign: 히어로+단계섹션+sticky CTA)·정산(swap 제거, 순수익 히어로 지표)·회원(적층 pane→그룹섹션, FormGrid 2열→1열 행). **per-record swap/stack → 한 스크롤 그룹섹션.**
- 리스크 中(화면 재구성). 커서 브라우저 반복 + 화면별 단계.

## Phase 4 — 페이지 골격 + 라우트 전환 (가장 구조적, 고위험) 
- **`<MobileScreen header body footer>`** SSOT: 로컬 앱바(back+title+actions 한 바)·유일 스크롤 body·footer 슬롯·safe-area/바높이 **단독 소유**. WorkPage 복붙 fixed·MobilePageShell 자체컬럼·`padBottom` 화해·`setTabCss` 흡수.
- **마스터→상세 = 라우트 push**(`/contract/[code]` 등) → URL·하드웨어 back·슬라이드 전환. `selected` 오버레이·`useHideTabBar` 곡예 제거.
- **모바일에서 3-pane 추상 폐기**. 웹은 `WorkPageWeb`로 그대로 존치(**웹 무영향**).
- 마이그레이션: MobileScreen 신설(웹영향0) → 리스트 1개 검증 → contract 1개 라우트상세 → chat/inventory/settlement 이관 → TopBar 모바일 하단바·work-stack override·setTabCss 제거.
- 리스크 高(라우팅·셸 = 위험영역). **Claude 게이트 필수.** 단계별·화면별 신중히.

---

## 실행 순서 권장
1 (전역 인터랙션) → 2 (프리미티브) → 3 (세부페이지) → 4 (골격/라우팅). 1·2는 신설/저위험이라 빠르게 체감↑, 3·4는 화면별 점진 + 브라우저 검증. 각 Phase 착수 시 이 문서에서 커서 오더로 뽑는다.

## 상태
- [ ] Phase 1 — 전역 인터랙션 레이어
- [ ] Phase 2 — 콘텐츠 프리미티브(그룹리스트)
- [ ] Phase 3 — 세부페이지 틀(DetailScreen)
- [ ] Phase 4 — 페이지 골격 + 라우트 전환
