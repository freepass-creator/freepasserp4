# UI/UX 규격 정합성 감사 결과

스캔 기준: `UIUX_AUDIT_WORKORDER.md` · SSOT `components/ui/tokens.ts`  
범위: `components/ui/*`, `app/page.tsx`, 주요 `components/*`, `app/m`·`members`·`chat`·`contract`·`settlement` (+ 인접 발견분)  
방법: `fontSize`/`fontWeight`/`#hex`/`borderRadius`/`height` 정적 검색 + 우선 경로 육안 확인  
**코드 수정 없음** (본 파일만 산출).

## 요약

| 카테고리 | 건수(행) | high | med | low |
|---|---:|---:|---:|---:|
| 1 하드코딩 폰트크기 | 28 | 8 | 14 | 6 |
| 2 하드코딩 두께 | 8 | 1 | 5 | 2 |
| 3 하드코딩 색 | 14 | 3 | 5 | 6 |
| 4 컨트롤 규격 우회 | 6 | 1 | 3 | 2 |
| 5 원자 일관성 | 4 | 1 | 2 | 1 |
| 6 반경 | 7 | 1 | 3 | 3 |
| 7 모바일/웹 분기 | 6 | 2 | 3 | 1 |
| 8 터치타겟 | 4 | 1 | 2 | 1 |
| 9 정렬 | 2 | 0 | 0 | 2 |
| **합계(표 행)** | **79** | **18** | **37** | **24** |

> 동일 패턴의 반복(예: Badge 톤맵 8색)은 대표 행 + 비고로 묶었고, 미사용 원자(Metric 등)는 low로 표기.

### 의도적 예외로 판단해 제외(또는 표에서 예외 표기)

| 항목 | 이유 |
|---|---|
| `app/m/page.tsx` `#0b0b0f` · `borderRadius: 48/38` | 폰 베젤·디바이스 크롬(물리색) |
| `app/login/page.tsx` 대량 HEX/CSS | 명함 CI 로그인 전용 서피스(주석 명시). ERP 본문과 분리 |
| `app/sign/**` 캔버스 `#0f1830` · 지면 `#fff` | 서명 PNG/PDF와 동일 물리 잉크·흰 지면 |
| `ContractSign` 서명 미리보기 `#fff` | 다크에서도 서명 가시성(주석 명시) |
| 그림자 `rgba(0,0,0,…)` / `rgba(15,23,42,…)` | 작업지시서: 그림자 rgba 예외 |
| `FavHeart` onPhoto `rgba(255,255,255,…)` | 사진 위 반투명 — 파일 주석 “C 토큰 대응 없음” |
| 사진 위 칩/라이트박스 `#fff` + 어두운 오버레이 | 사진/딤 위 대비용(물리색). 다크토큰 치환 시 가독 재검증 필요 |
| `borderRadius: 999` | pill 허용 |
| `borderRadius: 0` (엑셀/매트릭스/메뉴) | 각진 표·시트 의도 |
| `app/page.tsx` · `list-rows` · `chat`/`contract`/`members` | 하드코딩 검색 **위반 0** (토큰 준수 양호) |

---

## 위반 표

| 파일:줄 | 카테고리(1~9) | 현재값(위반) | 있어야 할 토큰/규격 | 심각도 | 비고(의도적 예외 여부) |
|---|---|---|---|---|---|
| `components/ui/index.tsx:127` | 1·7 | `fontSize: mobile?15:13` | `FS.title`(14.5) 또는 `FS.body`(13) 단일 | high | PaneHead — 업무 전면 패널 헤더. 15는 FS 밖 |
| `components/ui/index.tsx:128` | 1·7 | `12.5 / 11.5` | `FS.sub`/`FS.cap` | med | PaneHead count |
| `components/ui/index.tsx:190` | 1 | `fontSize: 24` | `FS.page`(18) 또는 히어로 예외 명시 | low | Metric — CLAUDE.md 사용처 0 |
| `components/ui/index.tsx:217` | 1 | `fontSize: 19` | `FS.page` | low | Cards value — 미사용 계열 |
| `components/ui/index.tsx:279` | 1·7 | `mobile?20:22` | `FS.page`(18) | med | Page 대제목. 웹이 모바일보다 큼(분기 역전 의심) |
| `components/ui/index.tsx:291` | 1 | `fontSize: 17` | `FS.page`/`FS.title` | low | Drawer 타이틀 |
| `components/ui/index.tsx:297` | 1 | `fontSize: 17` | 동일 | low | Drawer 타이틀(분기) |
| `components/ui/index.tsx:460` | 1·7 | `mobile?15:13` | PaneHead와 동일 → FS | high | FilterGroup 제목 — PaneHead와 같은 드리프트 |
| `components/ui/index.tsx:464` | 1·5 | `11.5 / 11` + raw `<button>` | `FS.cap`/`FS.micro` + `Btn` ghost | med | 「해제」액션 텍스트 |
| `components/ui/index.tsx:720` | 1 | `fontSize: 18` (×) | `FS.page` 또는 IconBtn | low | Drawer 닫기. raw button |
| `components/ui/index.tsx:739` | 1 | `fontSize: 19` (×) | 동일 | low | Modal 닫기 |
| `components/ui/index.tsx:780` | 1·7 | `mobile?13:12.5` | 콘텐츠면 `FS.body`/`FS.sub`; 입력이면 `ctrlInputFs` | med | 판단필요: Textarea류인지 콘텐츠인지 |
| `components/MasterFitSummary.tsx:50` | 1 | `fontSize: 16` | `FS.page`/`FS.title` | med | 요약 숫자 |
| `app/settlement/page.tsx:136` | 1 | `fontSize: 17` | `FS.page` 또는 Metric 토큰화 | med | 정산 KPI |
| `components/ui/detail.tsx:89` | 1·7 | `mobile?14:FS.body` | `FS.title`(14.5) 또는 `FS.body` | high | Accordion 제목 — 14는 스케일 밖 |
| `components/ui/detail.tsx:105` | 1·7 | `mobile?14:FS.body` | 동일 | high | KV 행 |
| `components/VehicleMasterFilter.tsx:34` | 1·2·7 | `12.5/11.5` + `fontWeight:700` | `FS.sub`/`FS.cap` + `FW.head`/`FW.title` | high | 필터 축 라벨 |
| `components/VehicleMasterFilter.tsx:39` | 1·2·5 | `11.5/11` + `fontWeight:600` | `FS.cap`/`FS.micro` + `FW.strong` | high | 「선택 → 모델」힌트 — FilterGroup「해제」와 규격 갈라짐 |
| `components/product-card-atoms.tsx:337` 등 | 1 | `dense?11:FS.cap` | dense도 `FS.cap`/`FS.micro`만 | med | CardSpecs/Meta 계열 다수(337·358·392·448) |
| `components/product-card-atoms.tsx:508` | 1·7 | `promoFs` `10.5/9.5` | `FS.micro`(10) 상한 | high | 9.5는 micro 미만 — 카드 프로모 칩 |
| `components/product-card-atoms.tsx:1090` | 1·7 | `11/10` | `FS.cap`/`FS.micro` | med | PriceMini 개월 |
| `components/product-card-atoms.tsx:1092` | 1·7 | `on?(13/FS.sub):(12/FS.cap)` | FS만 | med | PriceMini 금액 — 모바일만 숫자 |
| `components/product-card-atoms.tsx:1096` | 1 | `10.5/9.5` | `FS.micro` | high | 「월」접두 |
| `components/product-card-atoms.tsx:1099` | 1 | `10.5/9.5` | `FS.micro` | high | 보증 줄 |
| `components/product-card-atoms.tsx:1143` | 1·7 | `12.5/11` | `FS.sub`/`FS.cap` | med | 「가격문의」 |
| `app/q/[code]/page.tsx:50–69` | 1 | `12/13/11` 직접 | FS.* | low | 견적 공개면 — 범위 밖 가능, 참고 |
| `app/login/page.tsx:183` | 1 | `fontSize:12` + `#5f6368` | (로그인 예외) / `FS.sub`+`C.mute` | low | CI 페이지 — 예외 후보 |
| `app/sign/[token]/page.tsx:58` | 1 | `fontSize:40` | 아이콘 크기/이모지 | low | 성공 ✓ — 판단필요 |
| `components/ui/feedrow.tsx:140` | 2 | `fontWeight:700` | `FW.head`(700) 또는 `FW.title`(650) | med | FeedTitle — 숫자는 동일해도 토큰 우회 |
| `components/ChatSenderLabel.tsx:29` | 2 | `fontWeight:600` | `FW.strong` | med | |
| `components/ChatSenderLabel.tsx:38` | 2 | `fontWeight:500` | `FW.meta` | low | |
| `components/AppTabBar.tsx:139` | 2 | `on?800:500` | 활성=`FW.head`(700) 이하 · 비활성=`FW.meta` | high | **800 금지**(금액 히어로 외). 하단탭 전면 |
| `app/login/page.tsx:174` | 2 | `fontWeight:600` | `FW.strong` / 로그인 예외 | low | |
| `components/ui/badges.tsx:15–22` | 3 | Badge 톤맵 전부 HEX | `C.*` 또는 CSS var 톤 | high | 다크모드 깨짐 원흉. SSOT 자체에 hex — 토큰화 필요(값은 바꾸지 말라는 지시와 충돌 → 보고만) |
| `components/ui/badges.tsx:63` | 3 | `#fff` + `rgba(15,23,42,0.55)` | 오버레이 전용 토큰 부재 | med | Badge overlay — 사진 위 예외 가능 |
| `components/ui/badges.tsx:139` | 3 | Status 점 HEX맵 | toneAccent/`C.*` | med | |
| `components/ui/table.tsx:292` | 3 | 홀수 행 `'#fff'` | `C.taupeBg`/`C.bg` | high | Excel/표 — 다크에서 흰 줄 |
| `components/ProductDetail.tsx:93–99` | 3·4 | `#fff` + raw button 40×40 | 오버레이 예외 + `IconBtn` | med | 갤러리 화살표·카운터 — 의도적 대비 가능 |
| `components/ProductDetail.tsx:208` | 3 | `#fff` 닫기 | 동일 | low | 라이트박스 |
| `components/product-card-atoms.tsx:51` | 3 | stroke `#c4ccd8` | `C.faint`/`C.line` | low | CarGlyph |
| `components/product-card-atoms.tsx:559` | 3 | `color:'#fff'` + rgba 배경 | 사진 위 칩 예외 | med | promoChip — 의도적 예외 후보 |
| `components/ContractDocs.tsx:188–200` | 3 | 미리보기 바 `#fff` · iframe bg `#fff` | 딤 위 UI / PDF 지면 | med | 라이트박스·PDF — 예외 후보 |
| `components/ContractSign.tsx:63` | 3·6 | `background:'#fff'` · `borderRadius:4` | 서명 지면 예외 · `R` | — | **의도적 예외**(주석). `4`는 R과 동일 |
| `app/m/page.tsx:152` | 3 | `#0b0b0f` | — | — | **의도적 예외**(폰 베젤) |
| `app/q/[code]/page.tsx:52–62` | 3 | `#fff` on brand | `C.taupeBg` | low | 견적 CTA — 대비용 |
| `components/ui/ContextMenu.tsx:82` | 4·8 | `height:32` 고정 · raw button | `ctrlH(mobile)` · 모바일≥36/40 | high | 모바일 분기 없음. 웹 md와 우연히 일치 |
| `components/AdminSettlementSheet.tsx:107` | 4 | `height:32` | `ctrlH(mobile)`/`ctrlH(false,'md')` | med | 읽기칸이 컨트롤 높이 흉내 |
| `components/FavHeart.tsx:25–27` | 4·8 | `h=28/24·34/30·40/32` | `ctrlH` 또는 size prop | med | IconBtn style로 height 덮음. onPhoto 모바일 34&lt;40 |
| `components/product-card-atoms.tsx:903` | 4 | `height:20` 기간칩 | 표시칩이면 OK · 탭이면 `ctrlChipH` | low | PeriodChips — 판단필요(터치 vs 표시) |
| `components/ui/badges.tsx:215` | 4·5 | CountPill `height:15` | 목록 LINE.sub 맞춤(주석) | low | 의도적 축소 — 터치 비대상 |
| `components/ui/badges.tsx:207–227` | 5 | brand/accent=`h15` vs red/gray=`Badge h20` | CountPill 단일 치수 | med | tone에 따라 크기·모양이 갈라짐 |
| `components/ui/index.tsx:127` vs `:460` | 5 | 둘 다 15/13 하드코딩 | 공통 헬퍼/`FS` | med | PaneHead·FilterGroup 동일 드리프트 복제 |
| `VehicleMasterFilter` vs FilterGroup「해제」 | 5 | 11.5/11·FW숫자 vs 11.5/11·FW.strong | 액션/힌트 텍스트 SSOT 1종 | high | 작업지시서 cat5 명시 축 |
| `AppTabBar` vs 타 탭 라벨 | 5 | `FW 800` | `FW.head`/`FW.title` | med | 하단탭만 과굵음 |
| `components/Toaster.tsx:47` | 6 | `borderRadius:12` | `R`(4) | high | 확인 다이얼로그 — ERP 각짐 깨짐 |
| `components/PageStatus.tsx:38` | 6 | `borderRadius:6` | `R` | med | |
| `app/settings/page.tsx:239` | 6 | `borderRadius:6` | `R` | med | 공유 URL 박스 |
| `components/ui/index.tsx:158` | 6 | `borderRadius:2` | `R` 또는 핸들 예외 | low | VSplit 핸들 그립 |
| `components/BottomSheet.tsx:104` | 6 | `borderRadius:2` | 동일 | low | 시트 핸들 |
| `components/ui/badges.tsx:130·142` | 6 | `borderRadius:1` | `R`/점용 예외 | low | 1px 점 — 판단필요 |
| `app/m/page.tsx:151·177` | 6 | `48` / `38` | 디바이스 크롬 | — | **의도적 예외** |
| `components/ui/index.tsx:127` 등 | 7 | 모바일 전용 비-FS 숫자 | FS 6단 + ctrlFs | high | 위 1번과 동일 군집 |
| `components/ui/detail.tsx:89·105` | 7 | 모바일만 14 | FS | high | |
| `components/product-card-atoms.tsx` PriceMini/promo | 7 | 웹·모바일 각각 비토큰 | FS | med | |
| `components/ui/ContextMenu.tsx:82` | 7·8 | 웹 32만 | 모바일 `ctrlH` | high | |
| `components/FavHeart.tsx:27` | 8 | onPhoto mobile `34` | ≥36~40 | med | 사진 위 의도적 축소 가능 |
| `components/ui/sec.tsx:53` | 8 | 숨기기 버튼 `22×22` | ≥40(모바일) | med | raw button · EyeOff |
| `components/ui/sec.tsx:51` | 8 | grip `22×22` | 드래그 핸들 — 판단필요 | low | |
| `components/ui/badges.tsx:215` + FeedSub | 9 | CountPill h15 vs 텍스트 line | 주석상 LINE.sub=15 맞춤 | low | 의도적. 어긋남 재발 시 FeedTitle/Badge만 점검 |
| `components/AppTabBar.tsx:150` | 9 | CountPill `top:4` absolute | 아이콘과 수직 정렬 | low | 판단필요 — 실기기 확인 |

---

## 우선 수정 후보 (참고만 — 본 작업에서 수정 안 함)

1. **AppTabBar `fontWeight:800`** — 규격 명시 금지.  
2. **PaneHead / FilterGroup `15/13` · detail `14`** — 업무 화면 전면.  
3. **VehicleMasterFilter 라벨/힌트** — FS·FW 미사용 +「선택→」톤 분열.  
4. **badges HEX 톤맵 · table `#fff`** — 다크모드.  
5. **PriceMini / promoFs `9.5`** — micro 미만 난립.  
6. **Toaster `borderRadius:12`** · **ContextMenu `height:32`**.

## 양호 구간

- `app/page.tsx`, `components/list-rows.tsx`, `app/chat`·`contract`·`members` — 하드코딩 검색 위반 없음.  
- 대부분 Btn/Input/Search는 `ctrlH`/`ctrlFs`/`ctrlInputFs` 사용.  
- `PriceHero`/`PriceAmounts` 쪽 본금액은 `FS`+`FW` 토큰 사용(히어로 800 예외는 본 스캔에서 미발견).

---

*생성: UIUX_AUDIT_WORKORDER 수행 · 수정 PR은 별도.*
