# 구현 로그

## 2026-07-26 — 매물 카드 가격·혜택 원자 분리

### 완료한 작업

- 추가: `components/product-card-perks.tsx`
  - `MetaIcon` · `CardBenefits` · `CardEvents` · `CardPerkLine`
  - 가격 모듈(`PeriodPerkBand`)이 `CardPerkLine`을 쓰므로 순환 import 방지용 공통 분리
- 추가: `components/product-card-pricing.tsx`
  - `PricePeekRoot` · `PriceMonth` · `PriceRentDep` · `PriceAmounts`
  - `PeriodRange` · `PeriodChips` · `PeriodPerkBand` · `PriceHero`
  - `CardPerkLine`은 perks에서 import
- 수정: `components/product-card-atoms.tsx`
  - 위 심볼을 re-export 유지 (`@/components/product-card-atoms` 경로 불변)
  - 로컬 잔존: `CardSpecs` · `CardFacts` · `CardThumb` 등

### 변화

- 기능·스타일·문구 변경 없음 (구조 이동만)
- 기존 소비자(`ProductCard` · `ProductRowCard` · `ProductDetail` · `list-rows`) import 경로 유지

### 검증

- `npm run typecheck`: PASS
- `npm run build`: 미실행 (요청)
- dev `:4004`: 유지 확인 (200)

---

## 2026-07-26 — Inventory 목록 UI 분리

### 완료한 작업

- 추가: `features/inventory/InventoryListPanel.tsx`
  - 신규 등록 슬롯과 작성 중 드래프트 행
  - 검색 결과 없음·상품 없음 상태
  - 선택 행 목록
  - 더보기·전체 보기와 500대 안전 상한
- 수정: `app/inventory/page.tsx`
  - 인라인 `listEl` 구현 제거
  - `InventoryListPanelModel`로 목록 상태와 명령 전달

### 변화

- `app/inventory/page.tsx`: 789줄 → 749줄

### 검증

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

---

## 2026-07-26 — Inventory 목록 계산 훅 분리

### 완료한 작업

- 추가: `features/inventory/useInventoryResults.ts`
  - 검색어·상태·상품구분 필터
  - 상태·차명·차번·코드 정렬
  - 모바일 필터 드래프트 미리보기 건수
- 수정: `app/inventory/page.tsx`
  - 목록 파생 계산 제거
  - `useInventoryResults` 결과 사용

### 변화

- `app/inventory/page.tsx`: 802줄 → 789줄

### 검증

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

---

## 2026-07-26 — Finder 결과 계산 훅 분리

### 완료한 작업

- 추가: `features/finder/useFinderResults.ts`
  - 필터 상태 지연 적용
  - 동적 필터·기간·현재 선택지 집계
  - 차량 마스터 연쇄 필터 모수
  - 인기차종 계산
  - 숨김·관심·패스 반영 목록과 정렬
  - 모바일 필터 드래프트 미리보기 건수
  - 카탈로그 노출 총계
  - 엑셀 헤더 필터·정렬 결과
- 수정: `app/page.tsx`
  - 위 파생 계산 제거
  - 필터 입력을 훅에 전달하고 계산 결과만 렌더링에 사용
  - 사용하지 않는 도메인 import 정리

### 변화

- `app/page.tsx`: 832줄 → 724줄
- `useFinderResults.ts`: 신규 183줄

### 검증

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

---

## 2026-07-26 — Finder 데이터 로딩 훅 분리

### 완료한 작업

- 추가: `features/finder/useFinderData.ts`
  - 캐시된 매물 초기값
  - Firebase 인증 준비 후 상품·공급사 조회
  - 15초 로드 타임아웃과 실패 시 빈 목록 처리
  - 공급사명 결합
  - 숨김·패스 코드 초기화 및 변경 구독
- 수정: `app/page.tsx`
  - 데이터 조회와 로컬 목록 구독 effect 제거
  - `useFinderData` 결과만 소비
  - 보기 모드·필터 패널 표시 설정 복원은 데이터 로딩과 분리

### 변화

- `app/page.tsx`: 858줄 → 832줄
- `useFinderData.ts`: 신규 64줄

### 검증

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

---

## 2026-07-26 — Finder 필터 패널 분리

### 완료한 작업

- 추가: `features/finder/FinderFilterPanel.tsx`
  - 데스크톱 사이드바와 모바일 필터 시트의 공통 패널 UI
  - 최근·관심, 정렬, 인기차종, 기간, 가격, 차량, 동적 조건, 공급사 필터
- 수정: `app/page.tsx`
  - `renderSidebar()` 인라인 구현 제거
  - 필터 상태·파생값·콜백을 `FinderFilterPanelModel` 하나로 전달
  - 최근·관심 목록 초기화의 페이지 상태 동기화는 페이지에 유지

### 주요 결정

- 필터 상태의 소유권은 페이지에 유지했다.
- 수십 개 개별 props 대신 명시적인 패널 모델 하나로 경계를 만들었다.
- 드래프트와 라이브 필터를 나누는 기존 `bump()` 계약을 유지했다.
- 데스크톱과 모바일이 같은 패널을 공유하는 기존 동작을 유지했다.
- 정렬 라벨, 기본 열림 조건, 초기화 햅틱과 토스트 문구를 기존과 동일하게 유지했다.

### 변화

- `app/page.tsx`: 1,042줄 → 858줄
- `FinderFilterPanel.tsx`: 186줄

### 검증

- typecheck: PASS
- build: PASS
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS

---

## 2026-07-26 — Codex 독립 검증 및 테스트 하네스 수정

### 검증 결과

- Cursor의 `ExcelResultsTable` 분리는 기존 열 순서·폭·필터·정렬·행 동작을 유지함
- 타입 검사와 프로덕션 빌드 통과
- 전체 시뮬레이션 실행 중 기존 차량 잠금 테스트 역할 불일치 1건 발견

### 직접 수정

- `scripts/sim-vehicle-lock.mts`
  - 공급사 전용 단계 실행 시 `asRole('provider', ...)` 적용
  - 실행 후 이전 역할 복원
  - 제품 권한 정책은 변경하지 않음

### 최종 검증

- typecheck: PASS
- build: PASS
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS

---

## 2026-07-26 — Finder 엑셀 결과 테이블 분리

### 원래 요구사항

- `docs/REFACTOR_PROGRESS.md` 다음 단계: 엑셀 결과 테이블을 `features/finder` 독립 컴포넌트로 분리
- UI, 필터 의미, 정렬, 열 너비, 모바일 동작은 변경하지 않는다
- `IMPLEMENTATION_LOG.md` 갱신
- `npm.cmd run typecheck` 실행
- 커밋하지 않는다

### 완료한 계획 단계

- Finder 단계 분리 2번: 엑셀 결과 테이블 컴포넌트 이동

### 실제 변경 파일

- 추가: `features/finder/ExcelResultsTable.tsx`
  - 시트·테이블·헤더 필터 팝(`ExcelFilterPopover`) 렌더
  - 열 모드(`excelColMode` 등)·칸 폭·`hdrTh` 헤더 클릭 포함
- 수정: `app/page.tsx`
  - 엑셀 뷰 본문을 `<ExcelResultsTable … />` 호출로 대체
  - `excelRows`·`months`·`colFilter`/`colSort`/`openCol` 상태와 행 클릭·컨텍스트 메뉴는 페이지에 유지
- 수정: `IMPLEMENTATION_LOG.md` (본 문서)
- 수정: `docs/REFACTOR_PROGRESS.md`

### 주요 구현 결정

- 데이터 계산(`excelRows`, `months`)은 페이지에 남겨 다운로드·스크롤바 폭 계산과 계약을 유지했다.
- 팝오버용 `list`(사이드 match 결과)와 표시용 `rows`(헤더 필터·정렬 반영)를 props로 분리해 기존 OR/필터 의미를 그대로 둠.
- `openCol`은 페이지 `reset()`이 닫을 수 있도록 페이지 상태에 유지했다.
- 디자인·도메인 의미 변경 없음. `useIsMobile()` 분기는 컴포넌트 내부에서 기존과 동일하게 유지.

### 실행한 테스트와 결과

- `npm.cmd run typecheck`: PASS

### 계획과 달라진 부분

- 없음. UI/필터/정렬/열너비/모바일 동작 변경 없이 구조만 분리.
- build·sim 재실행은 이번 요청 범위 밖(typecheck만 요청).

### 알려진 문제와 미완료 항목

- Finder 필터 패널 분리, `useFinderData`/`useFinderResults` 훅 분리는 다음 단계
- build / sim-agent / sim-phase12는 이번 단계에서 미실행

### 작업 트리 상태

커밋하지 않음.

- 추가: `features/finder/ExcelResultsTable.tsx`
- 수정: `app/page.tsx` (1,213줄 → 1,042줄)
- 수정: `IMPLEMENTATION_LOG.md`, `docs/REFACTOR_PROGRESS.md`
- 기존 1차 분리 파일(`filter-state.ts`, `excel-columns.ts`, `ExcelFilterPopover.tsx`)은 유지

---

## 2026-07-26 — Finder 대형 파일 단계 분리

### 원래 요구사항

- `app/page.tsx` 같은 대형 단일 파일을 안전하게 분리한다.
- 다른 AI가 작업 상황을 이어받을 수 있도록 인수인계 문서를 계속 갱신한다.
- 기능과 화면 동작은 변경하지 않는다.

### 완료한 작업

1. Finder 필터 상태와 sessionStorage 직렬화 로직 분리
   - `features/finder/filter-state.ts`
2. 엑셀 열 표시값·필터·정렬 순수 로직 분리
   - `features/finder/excel-columns.ts`
3. 엑셀 열 필터 팝오버 UI 분리
   - `features/finder/ExcelFilterPopover.tsx`
4. 협업 및 장기 진행 문서 추가
   - `docs/AI_COLLABORATION.md`
   - `docs/REFACTOR_PROGRESS.md`
   - `HANDOFF.md` 진입 링크 갱신

### 실제 변화

- `app/page.tsx`: 1,459줄 → 1,213줄
- 필터 상태 구조, 저장 키, 엑셀 필터 의미, 정렬 방식 유지
- `FilterPop` 호출은 `ExcelFilterPopover`로 대체

### 계획과 달라진 부분

- 이번 연속 작업에는 별도의 Claude Code `PLAN.md`가 없었다.
- 사용자가 이미 승인한 Finder 구조 분리 범위와
  `docs/REFACTOR_PROGRESS.md`의 다음 작업 순서를 기준으로 진행했다.
- 중요한 아키텍처 또는 데이터 계약 변경은 수행하지 않았다.

### 검증

- 1차 분리 후:
  - `npm.cmd run typecheck`: PASS
  - `npm.cmd run build`: PASS
  - `npx.cmd tsx scripts/sim-agent.mts`: 37/37 PASS
  - `npx.cmd tsx scripts/sim-phase12.mts`: 25/25 PASS
- `ExcelFilterPopover` 분리 직후:
  - `npm.cmd run typecheck`: PASS
  - `npm.cmd run build`: PASS
  - `npx.cmd tsx scripts/sim-agent.mts`: 37/37 PASS
  - `npx.cmd tsx scripts/sim-phase12.mts`: 25/25 PASS

### 다음 작업

1. 현재 변경의 프로덕션 빌드 및 핵심 시뮬레이션 재검증
2. 엑셀 결과 테이블 컴포넌트 분리
3. Finder 필터 패널 분리
4. 데이터 로딩·검색 결과 계산 훅 분리

### 작업 트리

현재 변경은 커밋하지 않았다. 기존 사용자 변경을 삭제하거나 재정렬하지 않았다.

---

## 2026-07-26 — Inventory 3차 분리 (편집 패널 UI)

### 완료한 작업

- `features/inventory/InventoryEditorPanes.tsx` 추가
  - 기본정보 패널의 등록증 입력, 차종 마스터, 스펙 필드 UI 이동
  - 운영정보 패널의 정책, 가격, 사진, 공급사 사진 UI 이동
  - 편집 화면 의존성을 `InventoryEditorModel` 하나로 명시
- `app/inventory/page.tsx`
  - 편집 패널 JSX와 필드 메타데이터 조합 책임 제거
  - 저장, OCR 처리, 마스터 적용, 상태 변경 로직은 페이지에 유지
  - 749줄에서 643줄로 축소

### 유지한 계약

- 신규/수정/읽기 모드와 미저장 표시
- 관리자 전용 원가·이력 필드
- 공급사별 정책 필터링
- OCR 파일 입력, 마스터 선택과 재매칭
- 가격·사진·실내사진 변경 시 dirty 처리

### 검증

- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS, 26개 페이지 생성
- 전체 도메인 시뮬레이션: PASS
- 차량 마스터 검증: PASS

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — 공통 UI 오버레이 1차 분리

### 완료한 작업

- `components/ui/overlays.tsx` 추가
- 공통 `Drawer`, `Modal` 구현을 `components/ui/index.tsx`에서 이동
- 기존 `@/components/ui` 공개 import 경로는 barrel 재수출로 유지
- `components/ui/index.tsx`: 782줄 → 731줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — Firebase RTDB 데이터 계층 정리 배치

### 분리한 모듈

- `lib/firebase/rtdb-records.ts`
  - v3 첨부파일 정규화
  - 엔티티별 v3→v4 레코드 변환
  - 외부 입력 타입은 `unknown` 기반 경계로 제한
- `lib/firebase/rtdb-products.ts`
  - 카슝 상품 제외
  - 역할·소유사별 원가 마스킹
  - 실차 신원 기준 중복 제거

### 결과

- `rtdb-adapter.ts`: 537줄 → 406줄
- 공개 `RtdbAdapter`/`StoreAdapter` API 유지
- v3 읽기 전용·v4 오버레이 쓰기 정책 유지
- 계약·메시지·정산·고객 역할 스코프 조회 유지
- 남은 명시적 `any` 9건은 Firebase snapshot 동적 경계에 한정

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 홈·재고·계약·채팅·회원·설정: 모두 HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 설정·회원·계약·채팅 UI/UX 통합 배치

### 분리한 컴포넌트

- `features/settings/ProductPreferences.tsx`
  - 관심함·관심없음·숨김 상품 관리 UI 통합
- `features/members/MembersList.tsx`
  - 사용자·파트너 탭, 빈 상태, 목록행·역할 뱃지
- `features/contract/SettlementSummary.tsx`
  - 역할별 정산 대기·완료·환수·순수익 요약
- `features/chat/ChatRoomList.tsx`
  - 역할별 빈 상태, 조건 해제, 채팅 방 목록행

### 페이지 축소

- 설정: 379줄 → 302줄
- 회원: 368줄 → 353줄
- 계약: 355줄 → 337줄
- 채팅: 347줄 → 337줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `/settings`, `/members`, `/contract`, `/chat`: 모두 HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 회원 관리 1차 분리 (필터·정렬)

- `features/members/member-filter.ts` 추가
- 사용자·파트너 필터 옵션과 역할 SSOT 파생 이동
- 활성·비활성·승인대기·역할·파트너유형 필터 이동
- 이름·역할·코드 정렬과 승인대기 최상단 규칙 이동
- `app/members/page.tsx`: 409줄 → 368줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/members`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 계약 페이지 1차 분리 (필터·정렬)

- `features/contract/contract-filter.ts` 추가
- 진행·전체·계약상태 필터와 월 필터 이동
- 상태순·진행순·계약자순·최근순 정렬 이동
- 월 옵션과 표시 라벨 계산 이동
- 기본 진행 필터가 취소만 제외하고 완료를 포함하는 규칙 유지
- `app/contract/page.tsx`: 393줄 → 355줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/contract`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 채팅 페이지 2차 분리 (목록 필터·정렬)

- `features/chat/room-filter.ts` 추가
- 미확인·문의·전체·완료·취소 필터 이동
- 안읽음 우선·최근순 보조·차명순 정렬 이동
- 드래프트 필터 결과 미리보기 집계 이동
- `app/chat/page.tsx`: 372줄 → 347줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/chat`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 채팅 페이지 1차 분리 (방 색인·표시)

- `features/chat/room-display.ts` 추가
- 진행/취소 계약 first-wins 색인 분리
- 상품·삭제상품의 코드·키·차량번호 lookup 이동
- 방 제목, 삭제 차량 fallback, 공급사 표시 계산 이동
- `app/chat/page.tsx`: 435줄 → 372줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/chat`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — Finder 4차 축소 (결과 본문)

- `features/finder/FinderResults.tsx` 추가
- 빈 결과, 카드·상세·엑셀 보기, 더보기·전체 보기 UI 이동
- Excel 필터·정렬·팝오버 상태 연결과 상품 컨텍스트 메뉴 유지
- `app/page.tsx`: 563줄 → 511줄
- ref 타입 호환 문제 1건 발견 후 수정
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — Finder 3차 축소 (상단 툴바)

- `features/finder/FinderToolbar.tsx` 추가
- 모바일 검색·필터 버튼과 웹 검색·정렬·관심함·다운로드·보기 전환 이동
- 정렬·보기 옵션 SSOT도 툴바 모듈로 이동
- 기존 Finder 상태와 콜백 API 유지
- `app/page.tsx`: 644줄 → 563줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — Finder 2차 축소 (상품 컨텍스트 액션)

- `features/finder/product-context.ts` 추가
- 계약문의, 손님공유, 상품 내용 복사, 상세 이동 메뉴 구성 이동
- 페이지에는 컨텍스트 메뉴 열기와 라우팅 연결만 유지
- 복사 실패 시 구형 prompt 대신 공통 error toast 사용
- `app/page.tsx`: 690줄 → 644줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/`: HTTP 200 유지
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 차량 마스터 정확 경로·운영 작업 분리

### 완료한 작업

- `lib/domain/vehicle-master-exact.ts` 추가
  - 추정 없는 마스터 실경로 판정 엔진 이동
  - 동 gen_code 후보의 제조사·모델·세부모델 축소 규칙 유지
- `lib/domain/vehicle-master-operations.ts` 추가
  - 마스터 경로 집합·적합 판정
  - 일괄 reconcile과 전수 audit 엔진 이동
- 매칭 함수와 스냅 적용 함수는 인자로 주입해 순환 의존성 방지
- 기존 `resolveExactMasterPath`, `reconcileToMaster`, `auditMasterFit` API 유지
- `vehicle-master-match.ts`: 915줄 → 805줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 안전한 분리 후보는 공통 리스트(`ListRow`, `ListBox`)와 폼 입력 묶음이다.

---

## 2026-07-26 — 공통 UI 리스트 2차 분리

### 완료한 작업

- `components/ui/list.tsx` 추가
- 보조 공통 리스트 `ListRow`, `ListBox` 이동
- 기존 `@/components/ui` 공개 import 경로는 barrel 재수출로 유지
- `components/ui/index.tsx`: 731줄 → 706줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 작업은 `Select`, `Input`, `Textarea`, `SearchInput` 폼 입력 묶음 분리다.

---

## 2026-07-26 — 공통 UI 폼 입력 3차 분리

### 완료한 작업

- `components/ui/form-controls.tsx` 추가
- `Select`, `Input`, `Textarea`, `SearchInput` 이동
- 기존 `@/components/ui` 공개 import 경로와 props 유지
- 모바일 입력 글꼴·높이, Enter 처리, 검색 초기화·포커스 로직 보존
- `components/ui/index.tsx`: 706줄 → 633줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 후보는 버튼 묶음(`Btn`, `IconBtn`, `IconSeg`) 또는 레이아웃 묶음이다.

---

## 2026-07-26 — 공통 UI 버튼 4차 분리

### 완료한 작업

- `components/ui/buttons.tsx` 추가
- `Btn`, `IconBtn`, `IconSeg` 이동
- `components/ui/index.tsx` 내부 사용은 leaf 모듈 직접 import로 연결
- 기존 `@/components/ui` 공개 import 경로와 props 유지
- `components/ui/index.tsx`: 633줄 → 554줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 후보는 `PaneHead`, `PaneBody`, `CardGrid`, `VSplit` 등 레이아웃 원자다.

---

## 2026-07-26 — 공통 UI 레이아웃 5차 분리

### 완료한 작업

- `components/ui/layout.tsx` 추가
- `PaneHead`, `PaneBody`, `CardGrid`, `VSplit` 이동
- 기존 `@/components/ui` 공개 import 경로와 props 유지
- 패널 스크롤, 모바일 헤더 높이, VSplit 드래그·비율 저장 로직 보존
- `components/ui/index.tsx`: 554줄 → 494줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

공통 UI 본체가 500줄 아래로 내려왔다. 다음에는 핵심 차량 매칭 파일을 타입·표시 유틸부터 단계적으로 분리한다.

---

## 2026-07-26 — 차량 마스터 매칭 1차 분리 (순수 타입)

### 완료한 작업

- `lib/domain/vehicle-master-types.ts` 추가
- `MasterVariant`, `MasterEntry`, `SnapResult`, `ExactMasterPath`, `VehicleFilter`, `MasterFitBucket`, `MasterFitRow` 이동
- 기존 `vehicle-master-match.ts` 타입 import 경로는 재수출로 호환 유지
- 매칭·스냅·감사 실행 로직은 변경하지 않음

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음은 표시 전용 함수(`yearDisplay`, `fuelDisplay`, `makerDisplay`)와 그 정규화 보조 함수의 의존성을 조사한 뒤 한 묶음으로 분리한다.

---

## 2026-07-26 — 차량 마스터 매칭 2차 분리 (표시·정규화)

### 완료한 작업

- `lib/domain/vehicle-master-format.ts` 추가
- `parseYear`, `yearDisplay`, `normFuel`, `fuelDisplay`, `makerDisplay`, `fuelEmbeddedCc` 이동
- 연료 별칭 `FUEL_ALIAS`도 동일 모듈에서 관리
- 기존 `vehicle-master-match.ts` 함수 export 경로는 재수출로 유지
- 매칭 본체는 leaf 포맷 모듈을 직접 참조
- `vehicle-master-match.ts`: 1,068줄 → 1,040줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 후보는 스냅 추적·이력(`SNAP_TRACK_*`, raw capture, diff, history) 묶음이다.

---

## 2026-07-26 — 차량 마스터 매칭 3차 분리 (스냅 추적·이력)

### 완료한 작업

- `lib/domain/vehicle-master-snapshot.ts` 추가
- 추적 필드·라벨, 원본 캡처, 필드 diff, 변경 이력 생성 이동
- `applySnap`의 실제 반영 정책은 매칭 본체에 유지
- 최근 이력 10건 유지와 최초 `_raw_vehicle` 보존 규칙 유지
- 기존 `vehicle-master-match.ts` 공개 export 경로 유지
- `vehicle-master-match.ts`: 1,040줄 → 1,001줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음 후보는 필터·마스터 탐색(`VehicleFilter`, maker/model/sub 목록) 묶음이다.

---

## 2026-07-26 — 차량 마스터 매칭 4차 분리 (필터·목록 탐색)

### 완료한 작업

- `lib/domain/vehicle-master-filter.ts` 추가
- 빈 필터, 활성 필터 수, 매물 필터 판정 이동
- 제조사 그룹·모델·세부모델 목록 탐색 이동
- 르노 계열 표기 호환과 국산 우선 정렬 유지
- 기존 `vehicle-master-match.ts` 공개 export 경로 유지
- `vehicle-master-match.ts`: 1,001줄 → 976줄

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

다음은 마스터 경로 검사·감사와 일괄 reconcile의 의존성을 분리 가능한 단위로 정리한다.

---

## 2026-07-26 — 차량 마스터 매칭 5~6차 분리

### 차량 신호 수집

- `lib/domain/vehicle-master-signals.ts` 추가
- 신호 키, 원본 우선 수집, blob 생성, 재스냅 입력 복원 이동

### 파워트레인·트림 선택 보조

- `lib/domain/vehicle-master-options.ts` 추가
- 마스터 라벨, 인승 분기, 옵션 라벨, 미선택 트림 판정 이동

### 결과

- 기존 `vehicle-master-match.ts` 공개 export 경로 유지
- 매칭 점수·스냅 반영 알고리즘 변경 없음
- `vehicle-master-match.ts`: 976줄 → 915줄
- typecheck: PASS
- 전체 7개 시뮬레이션·차량 마스터 전수 검증: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 브라우저 기본 확인창·알림 현대화

### 완료한 작업

- 기존 `window.confirm`을 공통 `confirmDialog`로 교체
  - 계약 취소
  - 정책 삭제
  - 회원 편집 이탈·비공개 전환·회원 삭제
  - 재고 상품 삭제
  - 개발 도구의 V3 마이그레이션
- 로그인/가입 오류의 `window.alert`를 공통 `toast`로 교체
- `app`, `components`, `features` 아래 직접 `window.confirm`·`window.alert` 호출 제거

### 검증

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — 클립보드 호환 처리 1차 통합

- `lib/clipboard.ts` 추가
- Clipboard API 우선, 비보안·구형 환경 textarea fallback 통합
- `CopyBlock`, 계약서 링크, 재고 종합표 복사 적용
- 실패를 성공으로 표시하던 조용한 catch를 명시적 오류 알림으로 개선
- Cursor의 product card 가격 파일은 수정하지 않음
- typecheck·전체 시뮬레이션 PASS, 서버 HTTP 200

### 2차 적용

- Finder 손님공유·상품 내용 복사
- 상품 상세 손님공유
- 카드 더보기 손님공유
- 설정의 영업자 공유 링크
- 직접 `navigator.clipboard` 호출은 `lib/clipboard.ts` 내부로 일원화

---

## 2026-07-26 — Cursor 가격·혜택 원자 분리 검증 완료

- 추가: `components/product-card-pricing.tsx`
- 추가: `components/product-card-perks.tsx`
- `components/product-card-atoms.tsx`: 725줄 → 271줄
- 기존 공개 export 경로 유지
- 순환 의존성 없음
- 독립 검증에서 UTF-8 BOM 제거
- typecheck·전체 시뮬레이션 PASS, 서버 HTTP 200

---

## 2026-07-26 — Product card atoms 6차 분리 (뱃지 UI)

- `components/product-card-badge-view.tsx` 추가
- `CardKind`, `CardRailBadges` 이동
- 뱃지 계산 모듈과 카드 배치 UI 경계 분리
- `components/product-card-atoms.tsx`: 764줄 → 725줄
- typecheck·전체 시뮬레이션 PASS, 서버 HTTP 200

---

## 2026-07-26 — Product card atoms 5차 분리 (신원 UI)

- `components/product-card-identity-view.tsx` 추가
  - 차량번호 원자 `Plate`
  - 말줄임 차량 제목 `CardTitle`
- `product-card-identity.ts`의 순수 문자열 조합과 UI 표현을 분리
- 기존 `product-card-atoms` 공개 경로 재수출 유지
- `components/product-card-atoms.tsx`: 789줄 → 764줄

### 검증

- typecheck와 전체 시뮬레이션: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — Product card atoms 4차 분리 (차량 신원·제원)

- `components/product-card-identity.ts` 추가
  - 데스크톱·모바일 차량 제목 조합
  - 상세 제원 문자열
  - 카드 고정 제원 문자열
- 기존 `product-card-atoms` 경로에서 동일 이름 재수출
- `components/product-card-atoms.tsx`: 843줄 → 789줄

### 검증

- typecheck, 전체 시뮬레이션, 차량 마스터 검증: PASS
- 개발 서버 `/inventory`: HTTP 200
- production build: 서버 유지 요청에 따라 보류

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Product card atoms 3차 분리 (기간별 요금)

### 완료한 작업

- `components/product-card-fares.tsx` 추가
  - `PriceMini`
  - compact 기간별 요금 카드
  - `PriceFare`
- `components/product-card-atoms.tsx`
  - 기간별 요금 구현 제거 및 기존 경로 재수출
  - 929줄 → 843줄

### 서버 유지 방식

- 4004 개발 서버를 재시작해 `/inventory` HTTP 200 복구
- 개발 서버와 `.next` 충돌을 피하기 위해 이번 단계부터 작업 중 `next build` 미실행
- typecheck와 전체 시뮬레이션 후에도 서버 HTTP 200 확인

### 검증

- `npm.cmd run typecheck`: PASS
- 전체 시뮬레이션·차량 마스터 검증: PASS
- 개발 서버 `/inventory`: HTTP 200
- production build: 서버 유지 요청에 따라 보류

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Product card atoms 2차 분리 (뱃지)

### 완료한 작업

- `components/product-card-badges.tsx` 추가
  - 차량 상태·상품 구분·심사 뱃지 스펙
  - 축약 라벨, hover 설명, 혜택 설명
  - 사진 마크, 모바일 뱃지 클립, 차량 placeholder glyph
- `components/product-card-atoms.tsx`
  - 뱃지 구현 제거 후 내부 import·외부 재수출
  - 1,037줄 → 929줄

### 보존한 계약

- 표기 순서: 차량상태 → 상품분류 → 심사기준
- customer audience에서 차량 상태 숨김
- 계약중 solid/pulse 표시
- 사진 마크는 상태·심사만 노출
- 기존 import 경로 및 export 이름 유지

### 검증

- typecheck, 전체 시뮬레이션, 차량 마스터 검증, production build: PASS
- 주요 route 번들 크기 변화 없음

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Product card atoms 1차 분리 (옵션)

### 완료한 작업

- `components/product-card-options.tsx` 추가
  - 옵션 문자열 파싱
  - 카드·상세·엑셀 옵션 칩
  - ResizeObserver 기반 오버플로 표시
- `components/product-card-atoms.tsx`
  - 옵션 구현 제거
  - 기존 공개 import 경로를 위한 재수출 유지
  - 1,151줄 → 1,037줄

### 호환성

- `ProductCard`, `ProductRowCard`, `ProductDetail`, Finder는 기존
  `@/components/product-card-atoms` import를 그대로 사용한다.
- 옵션 2개+말줄임, 엑셀 2줄, 상세 전체 펼침 동작을 유지한다.

### 검증

- typecheck, 전체 시뮬레이션, 차량 마스터 검증, production build: PASS
- 주요 route 번들 크기 변화 없음

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Inventory 런타임 스모크·번들 분석

### 확인 결과

- 로컬 `/inventory`: HTTP 200, 응답 본문 19,887 bytes
- production route 표기: 19.7 kB / First Load JS 272 kB
- route 전용 chunk: 51,983 bytes (비압축 파일 크기)
- `SheetSync`는 별도 동적 chunk 유지
- `vehicle-master-load`는 동적 import 유지

### 판단

최근 단계별 0.1~0.3 kB 증가는 대형 의존성이 새로 초기 번들에 들어온 것이 아니라
모듈과 훅 경계 추가에 따른 작은 래퍼 비용으로 판단한다. 이를 줄이기 위해 책임을 다시
페이지에 합치는 것은 이번 리팩터링 목표와 맞지 않아 코드 변경을 하지 않았다.

### 브라우저 검증

연결 가능한 인앱 브라우저나 Chrome 세션이 없어 실제 클릭·반응형 수동 검증은 보류했다.
HTTP 스모크, 전체 자동 시뮬레이션과 production build는 통과한 상태다.

---

## 2026-07-26 — Inventory 6차 분리 (데이터·권한 초기화)

### 완료한 작업

- `features/inventory/useInventoryData.ts` 추가
  - 상품·공급사 병렬 로딩과 공급사 소유 상품 범위 적용
  - 정책, 권한 게이트, 오류 메시지 상태 관리
  - 최초 진입, 역할 변경, 작업 목록 재진입 이벤트 처리
- `app/inventory/page.tsx`: 386줄 → 342줄

### 보존한 동작

- 관리자·공급사만 재고관리 접근 가능
- 공급사 역할은 자기 회사 상품만 조회
- 초기 정책 목록 선로딩
- 모바일은 목록부터, 데스크톱은 첫 상품 자동 선택
- 마스터 데이터는 첫 화면을 막지 않고 백그라운드 로딩
- 역할 변경과 재고 메뉴 재진입 시 선택 상태 초기화

### 검증

- typecheck, 전체 시뮬레이션, 차량 마스터 검증, production build: PASS
- `/inventory`: 19.7 kB

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Inventory 5차 분리 (편집 수명주기)

### 완료한 작업

- `features/inventory/useInventoryEditorLifecycle.ts` 추가
  - 신규 생성, 필드 변경, 초기화, 복사·붙여넣기
  - 저장, 수정 취소, 편집 시작
  - 계약 보호를 포함한 소프트 삭제
- `app/inventory/page.tsx`: 496줄 → 386줄

### 보존한 업무 규칙

- 공급사는 자기 회사 상품만 저장·삭제 가능
- 차량번호 공백 정규화 후 중복 등록 차단
- 계약 엔진 잠금 상태가 폼의 차량 상태보다 우선
- 진행 중인 계약이 있으면 상품 삭제 차단
- 저장 직전 이벤트 태그와 외·내장색 정규화
- 초기화 시 식별·귀속·상태 필드 유지
- 복사 시 차번·VIN·상품코드·사진 제외

### 검증

- typecheck, 전체 시뮬레이션, 차량 마스터 검증, production build: PASS
- `/inventory`: 19.5 kB

현재 변경은 커밋하지 않았다.

---

## 2026-07-26 — Inventory 4차 분리 (OCR·차종 마스터 훅)

### 완료한 작업

- `features/inventory/useInventoryVehicleTools.ts` 추가
  - 차종 마스터 지연 로딩과 캐시
  - 상품 선택 시 exact 경로 확인 및 안전한 자동보정
  - 색상 규격 자동보정과 해당 목록·캐시 패치
  - 사용자 요청 재매칭과 마스터 피커 결과 적용
  - 등록증 OCR 요청과 빈 필드 병합
- `app/inventory/page.tsx`
  - 위 비동기 처리와 관련 상태·ref 제거
  - 643줄에서 496줄로 축소

### 보존한 안전장치

- 빠른 상품 선택 시 이전 비동기 응답 무시
- exact 경로이며 high/medium 신뢰도일 때만 DB 자동반영
- low 신뢰도 결과는 검토용 폼에만 적용
- OCR 결과는 기존 값이 비어 있는 필드만 채움
- 자동저장 실패 시 사용자 알림 및 원본 유지

### 검증

- typecheck, 7개 시뮬레이션/검증 스크립트, production build: PASS
- `/inventory`: 19.2 kB

현재 변경은 커밋하지 않았다.
## 2026-07-27 — Firebase Storage 원본 + Google Drive 백업

- `lib/firebase/storage-files.ts`: 파일 경로·크기 제한·Storage 업로드/삭제·선택적 Drive 백업을 통합했다.
- `app/api/drive-backup/route.ts`, `lib/server/drive-backup.ts`: Firebase 로그인 확인 후
  OAuth refresh token으로 Drive 폴더 생성과 multipart 백업을 수행한다.
- 상품 사진과 계약 서류는 Storage 저장 후 Drive 백업을 시도하고, 채팅 첨부는 Storage만 사용한다.
- 계약·채팅의 업무 레코드 저장 실패 시 이미 업로드한 Storage 원본을 정리한다.
- 레거시 data URL은 마이그레이션 없이 계속 읽는다.
- `storage.rules`, `firebase.json`, `.env.example`과 운영 문서를 추가했다.
- 공유 버킷을 계속 쓰는 V3의 기존 7개 Storage 경로 규칙을 병합해 V4 게시가 V3를 막지 않게 했다.
- Drive 사본은 복구용이므로 ERP 삭제와 연동해 삭제하지 않는다.
- 2026-07-27 운영 버킷 `freepasserp3.firebasestorage.app`에 병합 Rules 게시 완료.
- 게시 전 V3 Rules는 `storage.rules.PREV`에 보존했다.
- Google Drive API 활성화 및 `FreepassERP4 백업` 루트 폴더 생성 완료.
- OAuth 앱 정책 동의와 클라이언트/refresh token 발급은 계정 소유자 확인 대기다.
