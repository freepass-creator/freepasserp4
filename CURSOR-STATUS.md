# Cursor 상태판

**이 파일은 Cursor 소유다.** Cursor가 여기에 진행상황을 기록한다.
Claude는 읽기만 하고 수정하지 않는다. (지시서는 `CURSOR-TASKS.md` — Claude 소유, 읽기만 할 것)

---

## 진행 기록

한 줄 형식: `T번호 | 커밋해시 | 변경파일수 | tsc | 한 줄 요약`

| 태스크 | 커밋 | 파일 | tsc | 요약 |
|---|---|---|---|---|
| FIELD-GUARD | _(미커밋)_ | 6 | 0 | 축별 금지값 SSOT(`vehicle-field-guards`) · trim/variant/sub · fill·clean·resolve·snap 연결 |
| MASTER-DONE-7Y | _(미커밋)_ | — | 0 | 재고7년 완료판정: scrub367·drive74·스타리아모던 · 정상빈100% · 못채움=허용버킷 |
| MASTER-DONE-10Y | `f034f1f` | 5 | 0 | PLAN 10년(2016~) 확장: drive+28 · 정상빈48/72 · classified100% · 클로드검증인수 |
| T1 | `a2c2e14` | 3 | 0 | vstatus 죽은 배선 제거 (product-filters·page·sim-agent) |
| T2 | `b8e9bd7` | 8 | 0 | canonProductType 비교·렌더·export 경로 적용 |
| T3 | `6e734b8` | 5 | 0 | shortAt→msgClock 통합, ContractSend·미사용 export 삭제 |
| T4 | `19692b2` | 1 | 0 | PhotoUpload Btn/IconBtn·C/R/FS 원자화 (웹 조작=라이트박스) |
| T7 | `36c38e1` | 1 | 0 | 카탈로그 월대여료=priceList 밴드(홈 matchProduct와 동일). 최저가만 보던 로컬 비교 삭제 → 필터 결과 늘어날 수 있음(의도) |
| T8 | `e6107f0` | 1 | 0 | inventoryStatusIcon 색=VEHICLE_STATUS_TONE SSOT (아이콘 모양만 로컬). 맵=기존 하드코드와 동일 → 색 변화 없음 |
| T9 | `13bf969` | 1 | n/a | 죽은 원자 실사 표 (코드 변경 0, STATUS만 커밋) |
| C-3 | `9d8b964` | 2 | 0 | TopBar 상태탭 height=ctrlH(mobile) · login-links a padding 8×4 |
| C-4 | `9d8b964` | 3 | 0 | list-rows·PriceMatrix·ExcelResultsTable 금액/차번/코드 tabular-nums |
| C-5 | — | 0 | — | 이미 완료(partners basicFields에 business_number + 숫자정규화·중복 toast) |
| C-6 | `9d8b964` | 2 | 0 | 모바일 채팅 헤더에서 roomChatCode 숨김(웹 유지) |
| C-7 | `9d8b964` | 1 | 0 | ChatThread 말풍선 maxWidth 100%+minWidth 0(패딩 14 대칭) |
| U-1 | `669f3ce` | 7 | 0 | 규격통일: metrics/global-error/login FW·FS · MetaIcon/FavHeart ICON·ctrlH |
| U-2 | `d221a73` | 18 | 0 | 규격통일: lucide size→ICON · PageStatus 칩→ctrlH(sm) |
| U-3 | `ab06f88` | 6 | 0 | 규격통일: app/features 잔여 lucide size→ICON |
| U-4 | `0638afc` | 18 | 0 | 규격통일: NUM 열스캔 숫자 tabular-nums 보강 |
| TRIM-A | _(미커밋)_ | 1 | 0 | 아이오닉→아이오닉5/6 승격(`hitModel`이 더 구체적이면 model 교체). 사라짐 7 유지·새로채움 97→99 |
| TRIM-B | _(미커밋)_ | 1 | 0 | The Edge→디 엣지(expand+문구잠금). The New→더 뉴는 expand만. 사라짐 7 유지·새로채움 100 |
| ENCAR | _(미커밋)_ | 3 | — | 전수+sub-map+fill-propose. 정답지4/4. 마스터 JSON 미수정·승인대기 |
| WELRIX | _(미커밋)_ | 3 | 0 | 세대매핑 SSOT 추출·웰릭스 연결. 싼타페→MX5. gap 재생성 |
| MASTER-FILL2 | _(미커밋)_ | 3 | 0 | 접두+코드 오탐 수정·라인 flat·Honors/스마트셀렉션 append |
| MASTER-FILL-ALL | _(미커밋)_ | 2 | 0 | 3축 전면 append 364종·+1944칸·범위안 트림 3913 |
| MASTER-CLEAN | _(미커밋)_ | 3 | — | fill-all 잡음트림(터보·EV) 47칸 제거 · 연식감사 cc=연식 스킵 |
| YEAR-A2 | _(미커밋)_ | 2 | 0 | 연식1차: codeHit 구간밖 우회 제거 · 재매칭구간밖 0 |
| TRIM-UNION | _(미커밋)_ | 1 | 0 | 형제 variant 트림 합침(스타리아 모던 복구) · 사라짐 11→10 |
| TRIM-JUNK2 | _(미커밋)_ | 4 | 0 | 스마트스트림·올뉴○○·인치 제거 · 스마트키/센스 접두 오탐 막음 |
| TRIM-JUNK3 | _(미커밋)_ | 5 | 0 | 패키지조각·다중매칭·아이오닉스탠다드 · 바뀜 19→12 |
| TRIM-ALIAS | _(미커밋)_ | 4 | 0 | Long Range·Spt·RWD강등 · unpack=resolveTrim · 바뀜 12→14 |
| TRIM-G80 | _(미커밋)_ | 3 | 0 | G80 RG3 기본형 append·잡음제거 · 사라짐 11→10 |
| NAME-AXIS | _(미커밋)_ | 4 | 0 | 인승·구동 선택축을 short/full 차명에 표기 |
| MASTER-DRIVE | _(미커밋)_ | 2 | 0 | GN7·K8 HEV 조합 drivetrain=2WD 노드 완성 |
| TRIM-JUNK-BIZ | _(미커밋)_ | 3 | 0 | 디엣지 잡음트림 scrub·비즈니스 복구 · K8 스탠다드/트렌디=GL3 OK |
| TRIM-MISS-RENO | _(미커밋)_ | 3 | 0 | E-TECH 접두 peel·SLX/SE/G90기본형 append · 그랑콜 아이코닉 복구 |
| TRIM-LPG-TRENDY | _(미커밋)_ | 3 | 0 | 스포티지/K5 LPG 트렌디·로체 LEX append · year=cc raw 방어 |
| MASTER-DRIVE2 | _(미커밋)_ | 2 | 0 | 코나SX2 EV/HEV·스타리아US4 2WD (작업우선=공급 7년) |
| MASTER-DRIVE3 | _(미커밋)_ | 1 | 0 | EV6·아이오닉5/6·GV60·코나OS·더뉴스타리아 2WD 노드 21칸 |
| MASTER-DRIVE4 | _(미커밋)_ | 3 | 0 | BMW/벤츠/테슬라 RWD 노드 + xDrive 백트래킹 가드 |

---

## 막힘 / 질문

_(아직 없음)_

---

## 보고서

### TRIM-A — 아이오닉 모델 승격 (2026-08-09)

`docs/PLAN-TRIM-MATCH-2026-08-09.md` ★A.
`vehicle-master-normalize.ts`: `hitModel`이 `modelRaw`보다 구체적(`startsWith` + 마스터 실재)이면 `out.model = hitModel`.
짧은 공급 모델명은 `sub_model`에 넣지 않음.

검증:
- `_probe-ioniq` 4/4 → 아이오닉6 / 아이오닉5 NE 계열
- `sim-trim-resolve` 36/36 · `sim-sheet-merge` 150/150 · tsc · fonts
- `audit-trim-by-plate`: 사라짐 **7→7**(증가 없음) · 새로채움 97→99 · 못채움 248→246

### TRIM-B — The Edge 세대 별칭 (2026-08-09)

`docs/PLAN-TRIM-MATCH-2026-08-09.md` ★B.
`vehicle-master-score.ts`:
- `expandGenPhrases`: `The Edge→디 엣지`, `The New→더 뉴` (유사도 전)
- **디 엣지 문구 잠금** (+4.2 / −2.8) — 짧은「쏘나타 DN8」includes(0.75)가 이겨 구형으로 붙던 구멍
- 「더 뉴」는 잠그지 않음 — 싼타페 TM 페이스리프트에서 인스퍼레이션 사라짐 +1 유발

검증:
- Edge 2021/2023/연식없음/trim_extra → 전부「쏘나타 디 엣지 DN8」+ 익스클루시브
- `sim-trim-resolve` 36/36 · `sim-sheet-merge` 150/150 · tsc · fonts
- `audit-trim-by-plate`: 사라짐 **7**(증가 없음) · 새로채움 100 · 못채움 245

### ENCAR — 전수 학습 (2026-08-09)

`docs/PLAN-ENCAR-LEARN-2026-08-09.md`
- `scripts/encar-crawl.mts` · `scripts/encar-master-diff.mts` · `scripts/encar-master-fill-propose.mts`
- 수집: **215,514대** / catalog **4,606** 튜플 / 한글 정상
- **승인용 산출 (마스터 JSON 미수정)**
  - `tmp/encar/sub-map.csv` — 887종 · 매핑 885 · 미매핑 2 · **연식결정 67** (이름+연식 가중합)
  - `tmp/encar/sub-map-year-analysis.csv` — 다후보/연식분기 225행
  - `tmp/encar/master-fill-propose.csv` — 트림결손·축결손·세대미매핑·재고원문만 (반영 열 빈칸)
- 정답지 4/4 OK (셀토스 베스트=엔카0·재고원문만) · 아이오닉 그림자 OK
- 자동 반영 없음. 승인 후 append-only.

### WELRIX — 신차견적 세대매핑 공용화 (2026-08-09)

`docs/PLAN-ENCAR-LEARN-2026-08-09.md` ★근거 주인(신차=웰릭스) + 세대대응 기계 재사용.
- `lib/domain/vehicle-sub-resolve.ts` — 엔카 fill-propose와 **동일** resolve (접두+코드·서수·연식 0.65/0.35)
- `scripts/audit-master-vs-welrix.mts` · `scripts/encar-master-fill-propose.mts` 둘 다 이 SSOT 사용
- **모델키일치**: 견적기 「싼타페」처럼 짧은 model → `디 올 뉴 싼타페 MX5`(연식결정). 이전엔 접두+코드로 `싼타페 TM`에 붙음
- `tmp/welrix-gap.csv` 재생성: 세대매칭 390 · 트림일치 **242** · 결손 **31**(이전 거칠 매칭 대비 트림일치↑)
- 마스터 JSON 미수정 · RTDB/푸시 없음

참고: 견적기 「셀토스」→`더 뉴 셀토스 SP2`(연식 겹침). `더 2026 셀토스 SP3`는 엔카0·재고원문 축(기존 정답지).

### MASTER-FILL2 — 결손 잡기 2차 (2026-08-09)

사장님 「잡아줘」.
1. **매칭 구멍**
   - `접두+코드`: 접미가 `[a-z0-9]{2,8}`일 때만 (「니로」→「니로 플러스 DE」 오탐 제거 → **더 뉴 니로 SG2**)
   - 트림 flat: `라인`↔`line` (「X라인」=마스터「X-Line」)
2. **마스터 append** (`fill-master-trims` APPLY)
   - `더 뉴 그랜저 GN7` ← Honors (웰릭스)
   - `더 뉴 K5 DL3` ← 스마트 셀렉션 (웰릭스)
   - 1차분(스탠다드·비즈니스·트렌디·G80 블랙 등)은 이미 들어가 있었음
3. 게이트: tsc 0 · sim-trim-resolve 36/36 · sim-sheet-merge PASS · fonts 0
4. 남은 것: 범위 안 트림빈 **159종**(수입 껍데기·제네시스 정상빈 다수) — 다음 레인

### MASTER-FILL3 — 빈 세대·수입 소수 (2026-08-09)

작업기준 재확인 후 진행:
- 근거=엔카 실재만 · 표기=우리(리미티드-X→리미티드) · append-only · 제네시스 빈 트림은 정상 스킵
- append: 클리오 인텐스 · 그랜드체로키 오버랜드/라레도/리미티드 · 캐니언 드날리 · 포르테 에코플러스 · 돌핀 베이스 · K9 베스트 셀렉션
- 빈 159 대부분: 엔카 미매핑(149) 또는 BadgeDetail=세대코드/세부등급없음 → 일괄 불가

### MASTER-FILL4 — 공급사 원문 근거축 (2026-08-09)

**작업기준 보강:** 근거 = 웰릭스(신차) · 엔카(중고) · **공급사 입력 원문**(`_raw_vehicle`·`trim_extra`).
표기는 항상 우리 마스터 규격. 원문은 «실재 증거»만.
- `build-master-gap-worklist.mts` 재실행 → append: G80 런칭 · 뉴모닝 SLX · 싼타페TM H-Pick · K8 프리미엄 · K5 TF 베스트 셀렉션
- `TRIM_ALIAS` Finest→파이니스트
- 남은 gap 11건은 대부분 매칭/제원 낱말(기본형·E클래스·xDrive…) — 트림 append 대상 아님

### MASTER-FILL-ALL — 3축 전면 채움 (2026-08-09)

`scripts/fill-master-all.mts` — 웰릭스·엔카·공급사 원문.
- 채택 364종 → 마스터 **+1944칸 · 164세대** (append-only · 제원/차명/배기 필터)
- 범위 안 트림 **3505→3913** · 재고원문 gap **18→5**(1대짜리 잔여)
- 빈 세대 156종 남음(제네시스 정상빈·엔카 미매핑 수입 껍데기) — 근거 없으면 안 채움
- tsc 0 · sim-trim-resolve 36/36 · fonts 0

### MASTER-CLEAN — 잡음 트림 정리 (2026-08-09)

원인: fill-all 이 `터보`·`EV` 를 트림칸에 넣어 트랙스 RS 가 trim=`터보` 로 붙음.
- `scripts/clean-master-junk-trims.mts` APPLY → **47칸** 제거 (터보·EV 등)
- `fill-master-all` isJunk 에 `^터보$` 보강(재발 방지)
- 트랙스 재매칭: variant=`가솔린 1.2 RS` · trim=빈칸 (정상)
- `audit-year-submodel`: year===engine_cc(4자리) 스킵 → 구간밖 **35→20**(2000cc 오탐 0)
- `audit-trim-by-plate`: 사라짐 11(그중 트랙스 RS 터보 해제 9대=의도) · 바뀜 25 · 새로채움 180

### YEAR-A2 — 연식 1차 추출 구멍 막기 (2026-08-09)

`docs/PLAN-TRIM-MATCH-2026-08-09.md` ★A-2.
원인: 저장 `sub_model` 의 세대코드(W213·YK·J2)가 `codeHit` 로 연식 필터를 우회 → 재매칭해도 구간 밖 유지.
- `vehicle-master-score.ts`: yearFit 에서 codeHit 제거 · 연식 있는데 구간안 0이면 modelEntries 로 풀지 않음
- 배기량 오연식은 기존 `carYear`(year===cc→0) + genLock 이 담당
- `audit-year-submodel`: 열린 year_end=9999 · **재매칭도 구간밖 게이트**
- 실측: 저장구간밖 19 · 재매칭해소 13 · 공란 6 · **★재매칭도 구간밖 0**
- sim-trim-resolve 36/36 · sim-sheet-merge 153/153 · tsc 0 · 사라짐 11(증가 없음)

잔여: 저장 스테일 19대는 시트 재동기화 시 해소. 모델「I」→인피니티 I30 은 공란(원문 모델 복구는 별도). 빈 세대 156은 근거 있을 때만.

### TRIM-UNION — 형제 파워트레인 트림 합침 (2026-08-09)

원인: 마스터에 같은 `sub_model` 행이 여러 장 → 한쪽 `LPG 3.5`에만 「모던」 누락 → 그 행을 고르면 트림 증발(700호2227).
- `vehicle-master-match.ts` `unionVariantTrims`: 같은 세대·같은 variant 라벨 트림을 형제 합침
- 실측: 스타리아 「모던」복구 · 사라짐 **11→10**(QM6 모델명=트림 1대·트랙스 터보해제 9대 남음)
- 형제 합침은 **최종 trimSrc 만** (파워트레인 재선택 판정에 쓰면 모델Y RWD 회귀)
- sim-trim-resolve 36/36 · tsc 0

### TRIM-JUNK2 — 엔진·차명 조각 트림 오탐 (2026-08-09)

원인: 마스터에 `스마트스트림`·`올뉴팰리세이드`·`전기모터`·`N인치`가 트림으로 들어감 + unpack이 `스마트키`/`스마트센스`에서「스마트」접두 오탐.
- `clean-master-junk-trims` 확장 APPLY · fill-all isJunk 보강
- `vehicle-trim-resolve` COMPOUND_NOISE · `vehicle-master-normalize` 짧은 등급 덮어쓰기 금지 + 합성어 마스킹
- 실측: 바뀜 **25→19** · 모던/익스클루시브/E250 유지 · sim 36/36 · tsc 0
- 잔여 바뀜: E-Value Plus·하이리무진·런칭(N) 등 — 패키지/바디 라인 판단 여지

### TRIM-JUNK3 — 패키지 조각·다중 매칭 (2026-08-09)

- 마스터에서 `패키지`·`디자인`·`셀렉션`·`세단`·`초이스` 제거 · 아이오닉5 `스탠다드`·GV80 `기본형` append
- resolve/peel: 패키지 강등 · 짧은⊂긴 제거 · 원문 오른쪽 우선 · entry급 트림 합침(E250 아방가르드)
- 실측: 바뀜 **19→12** · 스탠다드/시그니처/기본형/E250·C220 아방가르드 유지 · sim 36/36 · tsc 0
- 잔여 12: 원문 정정(모던·노블레스 라이트·그래비티·프리미엄 럭셔리) 또는 연료접두 peel

### TRIM-ALIAS — Long Range·Spt·RWD 강등 (2026-08-09)

원인: unpack peel이 별칭 없이 오른쪽 토큰만 집어 `Long Range RWD`→`RWD`, `520i M Spt`→`520i`로 깎고, canon이 그걸 고정.
- `TRIM_ALIAS` long range · `TRIM_ALIAS_STRICT` spt · 구동표기(RWD/AWD…) 본등급 있으면 강등
- unpack peel/pick = `resolveTrim` SSOT · snap은 canon→resolveTrim→sim 순(sim이 Spt를 먼저 먹지 않게)
- 실측: 바뀜 **12→14** (의도 +2: 10호3819 프리미엄 롱레인지 · 109호4100/4042 M 스포츠) · sim **38/38** · tsc/fonts 0

### TRIM-G80 — RG3 기본형 결손 (2026-08-09)

원인: 141호4798 원문 「기본형」인데 RG3 트림칸에 없음(세부등급·19인치B·기본파퓰러패키지 잡음만).
- clean: `세부등급`·`N인치B`·`기본파퓰러패키지` 제거(24칸)
- fill-gaps: G80 RG3 `기본형` append(entry+전 variant · 라벨은 `2.5T` 표기)
- 실측: 사라짐 **11→10** (G80 복구) · 트랙스 RS 9대·QM6 모델명 사라짐은 의도 · sim 38/38

### NAME-AXIS — 인승·구동 선택축 차명 표기 (2026-08-09)

사장님: 전륜/후륜·7/9인승은 **새로 입력하는 값이 아니라** 차종마스터 조합에 이미 있는 것을 골라 표현.
- `vehicle-name` short/full: 고른 노드→`seats`/`drive_type`만 이름에 풂(없으면 발명 안 함)
- snap variant = `masterVariantOptionLabel`(노드 seat/drivetrain 표현) · drive/seats 저장도 **노드 값만**
- compose·driveForName: 빈칸에 2WD/대표인승 발명 제거
- 실측: 카니발 short `… 9인승 노블레스` · 쏘렌토 `… 7인승 4WD …` · 쏘나타 축 없음

### MASTER-DRIVE — HEV 조합 구동 노드 완성 (2026-08-09)

원인: 그랜저 GN7·K8 하이브리드 variant에 `drivetrain` 비어 이름에 2WD가 안 붙음(가솔린만 2WD/4WD).
- 마스터 조합 완성: `하이브리드 1.6` → `drivetrain=2WD` · label `하이브리드 1.6 2WD` (3칸)
- 발명 아님 — 재고 2WD·국내 HEV 전륜 근거로 **노드를 채움**
- 실측 snap: `하이브리드 1.6 2WD` · short `… 2WD 익스클루시브` · atom 40/40

### TRIM-JUNK-BIZ — 디엣지 잡음·비즈니스 복구 (2026-08-09)

원인: fill-all이 `내비1`·`인포테인먼트`·`모빌리티`·`사업용`을 트림으로 넣어 「비지니스1」이 `내비1`로 덮임.
- `clean-master-junk-trims` + fill-all `isJunk`에 내비N·사업용·인포테인먼트·모빌리티 추가 · APPLY 21칸 scrub
- 쏘나타 디 엣지 DN8 트림 = S·프리미엄·익스클루시브·인스퍼레이션·N라인·**비즈니스**
- 실측: 원문「렌터카 비지니스 1」→ 스냅 **비즈니스**(새로채움)
- K8: `스탠다드`/`트렌디`는 **K8 GL3**에만 있음 · 재고(125호8592·7613)도 K8 GL3로 스냅 — 더 뉴 K8에 append 불필요

감사(`audit-trim-by-plate`): 바뀜 20 · 사라짐 10 · 새로채움 212 · 못채움 108 · 유지 375
게이트: `sim-trim-resolve` 38/38 · tsc · fonts 0

### TRIM-MISS-RENO — 그랑콜·SLX·SE 못채움 (2026-08-09)

못채움 재분류: PLAN-C 주요 결손(비즈니스·베스트셀렉션·K8·SLX 엔트리)은 이미 있음.
남은 구멍은 **노드에 안 내려간 트림** + **E-TECH 접두 연속매칭 실패**.

1. `resolveTrim`: `E-TECH`/`GTe`/`TCe`/`LPe`/`LPi` 접두 트림은 원문에 접두·본등급이 **흩어져** 있어도 포함 인정
   - 「… E-Tech 1.5 터보 아이코닉 …」→ **E-TECH 아이코닉** (그랑 콜레오스 ×11+)
2. 마스터 append (`fill-master-trim-gaps` APPLY 5칸)
   - 뉴모닝 SA/가솔린 1.0 ← **SLX** (엔트리에만 있던 것)
   - 에이스맨 1세대/전기 ← **SE**
   - G90 RS4 ← **기본형**

검증: 로컬 재현 전→후 · `sim-trim-resolve` 39/39 · atom 도착45/유실0 · tsc · fonts 0
감사: 그랑콜·뉴모닝 SLX·에이스맨 SE·G90 기본형 = 새로채움. (못채움 숫자는 제네시스 빈원문 재분류로 ±변동)

### TRIM-LPG-TRENDY — LPG 노드 트렌디·로체 LEX (2026-08-09)

실측 못채움:
- 스포티지 NQ5 `fuel=LPG` · raw「트렌디」(161하1284) — LPG 2.0 2WD에 트렌디 없음
- K5 TF LPG 「K5 LPI 2.0 트렌디」(101하1394) — LPG 노드에 LPI 트렌디 없음
- 로체「…LEX」— 엔트리에만 LEX·이노베이션

처방:
- append: 스포티지 NQ5/LPG←트렌디 · K5 TF/LPG←LPI 트렌디 · 로체 가솔린←LEX·이노베이션
- `yearLooksLikeDisplacement`: 상품 `engine_cc` 비고 `_raw_vehicle.engine_cc` 도 비교(연식=cc 복사)
- `carYear`: `trim_extra`의 25MY 보조

검증: 스포티지·K5 live snap high · sim 39/39 · atom 45/0 · tsc · fonts 0
감사: 못채움 110→108 · 새로채움 212
참고: 32루9318 EXT는 year=2000(=cc) 방어 후 `first_registration`→2026이라 로체 구간(05–07) 밖 → 스냅 null(데이터 모순, 트림 발명 안 함)

### MASTER-DRIVE2 — 구동 노드 (2026-08-09)

**작업 우선 범위 (사장님 2026-08-09 보완):** 공급사 입력 재고는 거의 **7년 안쪽**(≈2019~).  
마스터 JSON 자체 보강 바닥은 기존 PLAN대로 **10년 걸침(2016~)** 유지 가능 — 다만 커서 노가다·못채움 추적은 **7년 우선**.

7~10년 못채움 재분류 참고(108 중, 이전 10년 필터): 범위겹침 52 · 밖 3 · 세부모델없음 53.
잔여 대부분 제네시스 빈트림·원문에 등급 없음.
(GV60「치 퍼포먼스」는 variant=`전기 퍼포먼스 AWD`, 트림칸 정상 빈값)

구동 조합 완성(`fill-master-drive-gaps`):
- 디 올 뉴 코나 SX2: 전기·하이브리드 → `2WD` (가솔린만 4WD 갈림)
- 스타리아 US4: `디젤 2.2`→`2WD`(형제 `디젤 2.2 4WD` 대비) · HEV/LPG→`2WD`(디젤만 4WD)

게이트: sim-trim 39/39 · atom 45/0 · tsc · fonts 0
더 뉴 스타리아 US4(구동 형제 없음)는 근거 더 있으면 다음.

### MASTER-DRIVE3 — EV/HEV 2WD 노드 (2026-08-09)

공급 **7년** 우선. AWD/4WD 형제가 있는 빈 drivetrain = RWD/전륜 → `2WD` (재고 더뉴아이오닉5 `drive=2WD` 실측).

채움 21칸:
- EV6 CV1 · 아이오닉5/6(·더 뉴) · GV60 스탠다드
- 코나 OS / 더 뉴 코나 OS HEV·EV
- 더 뉴 스타리아 US4 HEV/LPG (US4 디젤만 4WD 패턴)

7년 트림 못채움 잔여 등급냄새: X4 `xDrive20i`(패키지 없음·정상빈) · GV60(variant만·트림 정상빈)
게이트: sim-trim 39/39 · atom 45/0 · tsc · fonts 0

### MASTER-DRIVE4 — 수입 RWD + xDrive 가드 (2026-08-09)

공급 7년·재고 있는 수입 세단/테슬라만 (X5 등 상시AWD SUV 제외).

마스터 append 23칸:
- 5 G60/G30 · 3 G20 · E W213/W214 · C W206 → 빈 칸 `2WD` (xDrive/4MATIC 형제 대비)
- 모델 3/Y/X → `RWD` (AWD 형제 대비)

매칭 가드 (드라이브 채운 뒤 회귀 막음):
- `driveFromBlob`: xDrive·4MATIC·콰트로 인식
- 트림 백트래킹이 **명시 구동을 거스르지 않음** (G60「520i xDrive」가 530i-only xDrive 노드에서 2WD로 튀던 구멍)

실측: `520i xDrive`→가솔린 2.0 xDrive · `520i`→2WD · Model3 RWD · ModelY AWD
게이트: sim-trim 39/39 · atom 45/0 · tsc · fonts 0
참고: G60 xDrive 노드에 520i 트림 목록 없음(마스터 라인업) — 구동 우선, 트림은 비울 수 있음

### FIELD-GUARD — 축별 금지값 SSOT (2026-08-09)

원인: 트림칸에 연료·구동·엔진브랜드·인치·용도가 섞여 손님에게 가짜 등급처럼 보임. GDI 단독은 금지, 「GDI X 에디션」은 허용.

- `lib/domain/vehicle-field-guards.ts`
  - `isForbiddenAsTrim` — 런타임·마스터 scrub
  - `isForbiddenAsTrimImport` — 엔카/fill 신규 제안(더 빡셈, GDI+한글등급 통과)
  - `isForbiddenAsVariant` / `isForbiddenAsSubModel` / `isForbiddenAsModel`
- 연결: `realMasterTrims` · `resolveTrim` · `applySnap` sanitize · variant 신호 · normalize sub · fill/clean/encar
- 축 행렬: 세부모델↛연료·트림 · 파워트레인↛세부등급(EV라인·연료·구동 예외) · 트림↛연료·구동·엔진단독
- clean 미리보기 트림 **369칸** · 파워/서브 라벨 금지 0(마스터 라벨은 대체로 정상)
- 게이트: sim-trim 39/39 · atom 45/0 · tsc · fonts 0
- 마스터 트림 scrub는 `APPLY=1` 승인 후

### MASTER-DONE-7Y — 재고 7년 완료 판정 (2026-08-09)

**완료 정의:** 국산+주요수입 · `year_end≥2019` · 채울 구멍은 근거로 · 나머지는 정상빈 · scrub · 못채움=허용버킷 · sim/tsc/fonts.

#### 실행
| 항목 | 결과 |
|---|---|
| 잡음 트림 scrub | **367칸** 삭제 (`clean-master-junk-trims` APPLY) |
| 구동 형제 채움 | **74칸** 2WD/RWD (`fill-master-drive-sibling`) · X3~X7 상시AWD 스킵 |
| 트림 append | 더 뉴 스타리아 US4 `LPG 3.5` 11인승 ← **모던** (700호2227) |
| 트림 발명 | 없음 (아우디 S/RS·미니·VW 껍데기 등 안 채움) |

#### 정상빈 분류 (7y 국산·주요 · 100%)
| 버킷 | 건수 | 예 |
|---|---:|---|
| 정상빈_제네시스 | 4 | GV70·G70·GV60 |
| 정상빈_재고미소 | 36 | 쏘울EV·씨드·텔루라이드·Audi S/RS·미니·VW 껍데기 |
| 정상빈_상시AWD (구동잔여) | 8 | X5/X6/X3/X7 빈 drivetrain |
| 정상빈_구동모호 (구동잔여) | 35 | 라벨 불일치 형제(무쏘 EV kWh 등) |

#### 재고 감사 (`audit-trim-by-plate` · 725대)
| 판정 | 대수 |
|---|---:|
| 유지 | 371 |
| 새로채움 | 207 |
| 바뀜 | 25 |
| 사라짐 | 9 |
| 못채움 | 113 |

못채움 분해(전부 허용): 원문없음 53 · 등급신호없음 36 · 정상빈세대 23 · 세부모델없음 1  
사라짐 9 = 전부 트랙스 `RS`(파워트레인 라인이지 트림 아님 → 비우는 게 맞음) · 스타리아 모던 복구됨

#### 게이트
sim-trim 39/39 · atom 45/0 · tsc · fonts 0

**판정: 재고 7년 완료 (미커밋).** RTDB·푸시·커밋은 요청 전 안 함.

### MASTER-DONE-10Y — PLAN 10년(2016~) 확장 (2026-08-09)

7년 완료 위에 `YEAR_MIN=2016`으로 같은 규칙 확장. 트림 발명 없음.

| 항목 | 결과 |
|---|---|
| 구동 형제 채움 | **+28칸** (모하비·스타렉스·제네시스DH·EQ900·F10/F30·W212·A6/A4 등) |
| 상시AWD 스킵 | X3~X7 (+X4 F26) |
| 트림빈 48 | 정상빈_재고미소 44 · 정상빈_제네시스 4 (100%) |
| 구동잔여 72 | 정상빈_구동모호 62 · 정상빈_상시AWD 10 (100%) |
| 게이트 | sim-trim 39/39 · atom 45/0 · tsc · fonts 0 |

2016~2018 추가 트림빈 8 = 뉴S4·RS6·제타·볼보 XC60/S60/V60/S80/XC70 껍데기 → 정상빈_재고미소.

**판정: PLAN 10년(국산·주요수입) 완료 (미커밋).**

### T9 — 죽은 원자 실사 (2026-07-21)

실측: 심볼 참조. **정의 파일·같은 파일 내부 참조는 사용처에서 제외.**
배럴(`ui/index.tsx`) 재export만 있는 경우도 사용처 0.

| 원자 | 사용처 수 | 사용 파일(최대 3) | CLAUDE.md 등재 |
|---|---:|---|---|
| DataTable | 0 | — | Y |
| ObjCard | 0 | — | Y |
| Cards | 0 | — | Y |
| Metric | 0 | — | Y |
| KV | 0 | — | Y |
| DetailRow | 0 | — | Y |
| DetailEmpty | 0 | — | Y |
| Dash | 0 | — | Y |
| Sec | 0 | — | Y |
| HiddenSecs | 0 | — | Y |
| Modal | 0 | — | Y |
| Drawer | 0 | — | Y |
| EmptyState | 0 | — | Y |
| ListBox | 0 | — | Y |
| DetailShell | 0 | — | Y |
| VSplit | 0 | — | Y |
| Panel | 0 | — | Y |
| RiskTag | 0 | — | Y |
| SevTag | 0 | — | Y |
| Status | 0 | — (StatusTag 내부만) | Y |
| StatusTag | 0 | — | Y |
| PERK_TONE | 0 | — | Y |
| RISK_TONE | 0 | — (RiskTag 내부만) | Y |
| STATUS_TONE | 0 | — (StatusTag 내부만) | Y |
| PriceFare | 0 | — | Y |
| PriceMini | 0 | — (PriceFare 내부만) | Y |
| OptionsInline | 0 | — | Y |
| CardFacts | 0 | — | Y |

#### 사용처 0 + CLAUDE.md 등재 (사장님 판단 대기)

위 표 **전부**. 문서에 등재되어 있으나 앱/페이지 import 0.
삭제·문서정리·실사용 유도는 **사장님 판단** (Cursor는 삭제하지 않음).

---

## 현재 상태

`완료` — **MASTER-DONE-10Y** PLAN 10년(2016~) 국산·주요수입 완료 판정. 커밋 대기→클로드 검증.

### 클로드 검증 요청 (2026-08-09 · Cursor)

**범위:** 차종마스터 재고7년 + PLAN10년 완료 판정이 운영에 안전한지.

**볼 것**
1. `CURSOR-STATUS.md` `MASTER-DONE-7Y` / `MASTER-DONE-10Y` — 완료 정의·정상빈 버킷이 타당한지
2. `public/data/vehicle-master.json` — scrub(GDI/TFSI 등)·drive sibling 2WD·스타리아 LPG 모던 append
3. `lib/domain/vehicle-field-guards.ts` — 축별 금지(트림↛연료, 파워↛세부등급, EV라인·GDI접두+등급 예외)
4. 재고 감사 요약(725대): 못채움=원문없음/등급신호없음/정상빈세대만 · 트랙스 RS 트림 비움=의도(파워트레인 라인)
5. 게이트 재실행 가능: `sim-trim-resolve` · `sim-atom-pipeline` · `tsc` · `check:fonts`

**하지 말 것:** RTDB write · 재고 일괄 재스냅 · Rules 게시 · push(사람/클로드 승인 후)

**판정 부탁:** go(운영 OK) / 조건부(바뀜 25대 검수 후) / no-go(+이유)
