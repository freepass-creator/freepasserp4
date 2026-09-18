# 2026-09-18 ChatGPT audit 55 — ERP5 SSOT downstream distribution / live freshness

상태: **IMPLEMENTATION STAGED / runtime schedule HOLD**

Implementation PR: **#414** (`chatgpt/erp5-downstream-canonical-v2-20260918` → `main`)

## 질문

> freepasserp5 SSOT가 뿌려져야 할 곳에 실제로 같은 값으로 뿌려지는가? 업데이트는 실시간/최신인가?

판정은 두 축을 분리한다.

1. **ERP5 → 소비처 전달 정합성**
2. **공급사 원천 → ERP5 자체 신선도**

둘을 섞어서 “실시간 정상”이라고 말하면 안 된다.

---

## 1. 실제 운영 발행 증거 — 2026-09-18 16:49 KST

GitHub Actions full apply run:

- workflow: `ERP5 SSOT 원천 최신화(매시간)`
- run: **35320568657**
- fixed snapshot: **`20260918074946904-1eb68b19bbd1`**
- snapshot captured: 2026-09-18 16:49:46 KST
- ERP5 등록 1,615 / 출고불가 944 / 현재 재고 **671**

같은 fixed snapshot에서:

- 공개 카탈로그 대사: **664대, expected=actual, PASS**
- F01: **671대 게시**
  - 상품리스트 388
  - 오공구독 42
  - 픽업구독 186
  - 오플구독 55
- F86: **671대 / 19탭 / 90열 게시**
- F86 원자 칸 대조: **43,925칸 / 어긋남 0**
- Atom ↔ F01: 빠진 차 0 / 내려야 할 차 0 / 값 다른 칸 0
- F01 ↔ F86: 없는 차 0 / 추가 차 0 / 값 다른 칸 0
- F01/F86 차량번호 사진링크 대조: **어긋남 0**

run 전체 conclusion이 failure였던 이유는 데이터 발행 실패가 아니라 당시 production F86 freshness checker가
현재 탭 이름 규격을 잘못 판정한 false-positive였다. 이 checker는 PR #411로 수정되어 production engine
`cf940df642edf315adbc6da2b4134fbad53da160`에 승격 완료됐다.

**결론:** 마지막 full apply 기준 ERP5 → public/F01/F86 값 전달은 실제 운영 데이터로 정합성이 증명됐다.

---

## 2. 소비처별 현재 계약

| 소비처 | 2026-09-18 감사 전 상태 | audit55 조치/판정 |
|---|---|---|
| F01 | 같은 ERP5 snapshot 발행 | 정상, 실측 PASS |
| F86 | 같은 ERP5 snapshot 발행 | 값/링크 PASS, 잘못된 freshness checker는 PR #411로 해소 |
| 손님/화이트라벨 목록 | ERP5 server direct read | 정상 구조, server cache 60초 + 열린 화면 45초 poll |
| 손님 상세/공유 | ERP5 canonical resolve | 정상 구조 |
| ERP5/Finder 목록 | **ERP4 기본 Firebase `products` onSnapshot** | **수정:** 인증 `/api/products` → ERP5 canonical, 30초 poll + focus/visibility |
| 내부 `/m/[code]` 상세 | **ERP4 getStore product** | **수정:** `/api/products?code=...` → ERP5, 60초 + focus/visibility |
| Finder 시트 상세링크 매핑 | F01 + **ERP4 products/partners** | **수정:** F01 + ERP5 products/partners |
| 영업자 내부정보 | product는 ERP5, policy/partner는 **ERP4** | **수정:** product/policy/partner 모두 ERP5 |
| 읽기전용 관제 재고 | **ERP4 products/partners** | **수정:** ERP5 products/partners |
| 가게 재고 업데이트 시각 | ERP5 atom freshness를 읽지만 열린 화면은 1회 fetch | **수정:** 60초 + focus/visibility 재조회 |
| `/inventory` 편집 | ERP4 Store read/write | **HOLD:** 읽기만 ERP5로 바꾸면 저장 DB가 갈라짐. ERP5 write API와 함께 전환해야 함 |

### 웹 반영 지연

ERP5 Atom이 이미 갱신됐다는 전제에서:

- 손님/화이트라벨: server cache 최대 60초 + client 45초 poll → 보통 **1~2분 이내**
- Finder: client 30초 poll + shared ERP5 server cache 최대 60초 → 보통 **1~2분 이내**
- 내부 상세: 60초 재확인
- stock freshness label: 60초 재확인

즉 downstream 화면 자체는 “초 단위 realtime”이 아니라 **near-real-time** 계약이다.

---

## 3. 현재 진짜 병목 — upstream schedule

canonical workflow current cron:

- 월~토 KST **09:17~19:17, 매시간**

하지만 2026-09-18 repository-wide `event=schedule` 전달이 끊겼다.

- 마지막 관측 canonical scheduled run: **35304903901**, 12:53 KST
- PR #410로 `:05 → :17` 변경 뒤:
  - 17:17 미관측
  - 18:17 미관측
  - 19:17 미관측
- 반면 push/PR CI는 정상 실행됨.

오늘 마지막 실제 canonical write는 manual full apply run **35320568657 / 16:49 KST snapshot**이다.

따라서 **downstream이 빠르게 ERP5를 읽어도 ERP5 자체가 자동으로 최신 원천을 못 받아오면 “실시간”은 아니다.**
현재 최우선 운영 병목은 소비처 poll이 아니라 **GitHub scheduled-event delivery / workflow enablement**다.

---

## 4. 이번 구현의 fail-closed 원칙

- Finder/API 장애 시 ERP4 products로 자동 fallback하지 않는다.
- 첫 화면에 옛 ERP4 product cache를 잠깐 그리지 않는다.
- 내부 인증은 ERP4 Firebase Auth를 계속 사용한다.
- 상품 값만 canonical ERP5 server reader로 분리한다.
- private 원가/차대번호/계좌 등은 기존 역할 규칙에 따라 서버에서 마스킹한다.
- CI `check:erp5-firebase`가 Finder/상세/시트매핑/내부정보/관제의 ERP5 소비 계약을 잠근다.
- 레거시 `docs/원자-뻗어나가는-지도.md`, `docs/자동동기-매뉴얼.md`는 ERP5 최신 계약보다 우선하지 못하도록 상단 경고를 추가했다.

---

## 5. 남은 HOLD

### A. `/inventory` canonical write boundary

현재 재고관리 편집 화면은 ERP4 Store에서 읽고 ERP4 Store로 저장한다.

읽기만 ERP5로 전환하면:
- 화면에는 canonical 값
- 저장은 ERP4 DB

가 되어 더 위험하다.

따라서 다음 작업은 **ERP4 UI → ERP5 authenticated write API → freepasserp5**를 만들고
권한/감사로그/필드 ownership/CAS를 확정한 뒤 read/write를 함께 전환해야 한다.

### B. schedule runtime

이번 코드 변경과 별개로 다음 실제 scheduled canonical run이 생성되는지 확인해야 한다.
수동 dispatch 성공을 schedule 복구 증거로 사용하지 않는다.

### C. live Vercel endpoint probe

현재 연결된 Vercel connector는 팀은 보이나 해당 프로젝트를 조회하지 못해 production endpoint를 직접 HTTP probe하지 못했다.
따라서 웹 소비처의 runtime 판정은:
- current code path
- GitHub full-apply live evidence
- publication verifier

를 근거로 한다. 직접 endpoint probe가 가능해지면 별도 live smoke를 추가한다.

---

## 최종

**값 전달:** ERP5 → public/F01/F86는 실제 운영 증거로 정상. Finder/내부 상세/관제의 legacy read drift는 audit55에서 ERP5 direct-consumer로 수정 중.

**신선도:** ERP5가 갱신된 이후 소비처 반영은 1~2분 수준으로 설계되어 충분히 빠르다. 하지만 공급사 → ERP5 자동수집 schedule이 오늘 끊겼으므로 전체 시스템을 현재 “실시간 정상”이라고 판정하지 않는다.

**최우선:** scheduled-event delivery 복구/증명 → 그 다음 `/inventory` ERP5 write boundary.
