# 독립 검증 결과

## 2026-07-26 — 공통 UI 내비게이션·피드백 분리

### 범위

- `components/ui/navigation.tsx`: `NavBack`, `BottomNav`
- `components/ui/feedback.tsx`: `EmptyState`, `Loading`, `CenterNote`, `Message`
- `components/ui/index.tsx`: 구현 제거 후 기존 공개 API 재수출

### 호환성 및 검증

- 기존 `@/components/ui` import와 props·타입 export 유지
- 모바일 하단 safe-area 및 history/list 뒤로가기 동작 유지
- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- `git diff --check`: PASS
- production build는 실행 중인 개발 서버 보호를 위해 보류

## 2026-07-26 — 공통 UI 통계·요약 분리

### 범위

- `components/ui/metrics.tsx` 신규
- `Card`, `Toolbar`, `Panel`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`, `Step` 이동
- `components/ui/index.tsx`는 기존 공개 API 재수출

### 1차 검증

- `npm.cmd run typecheck`: PASS
- `/contract`: HTTP 200
- `components/ui/index.tsx`: 393줄 → 309줄

### 전체 검증

- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- `git diff --check`: PASS

## 2026-07-26 — 공통 UI 본체 최종 분리

### 범위

- `detail-shell.tsx`: `DetailShell`
- `form-grid.tsx`: `FormGrid`
- `copy-block.tsx`: `CopyBlock`
- `formatters.ts`: `won`, `fmtNumber`, `fmtPhone`
- `components/ui/index.tsx`: 구현 제거 후 순수 barrel

### 1차 검증

- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/members`, `/policy`, `/faq`: HTTP 200
- `components/ui/index.tsx`: 191줄 → 32줄
- 기존 `@/components/ui` import 경로 변경 없음

### 전체 검증

- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- 홈·재고·계약·채팅·회원·설정·정책·FAQ: HTTP 200
- `git diff --check`: PASS

## 2026-07-26 — 공통 UI 칩·필터 분리

### 범위

- `components/ui/filters.tsx` 신규
- `PillTabs`, `ToggleChips`, `FilterGroup`, `FilterChips`, `ChipOpt` 이동
- `components/ui/index.tsx` 기존 공개 API 재수출
- `FormGrid`의 `ToggleChips` 의존성을 leaf 직접 import로 전환

### 1차 검증

- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/contract`: HTTP 200
- `components/ui/index.tsx`: 309줄 → 191줄

### 전체 검증

- 전체 7개 시뮬레이션·마스터 전수 검증: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- `git diff --check`: PASS

## 2026-07-26 — 공통 UI 통계·요약 분리

### 범위

- `components/ui/metrics.tsx`
- 이동 대상: `Card`, `Toolbar`, `Panel`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`
- `components/ui/index.tsx`는 기존 API를 재수출한다.

### 호환성 및 검증

- 기존 `Step` 타입과 컴포넌트 props 유지
- tone 색, 수치 표시, Stepper 상태 표현 유지
- `npm.cmd run typecheck`: PASS
- `/`, `/inventory`, `/contract`, `/chat`, `/members`, `/settings`: HTTP 200
- `git diff --check`: PASS
- production build는 실행 중인 개발 서버 보호를 위해 보류

## 2026-07-26 — Inventory 목록 UI 분리 검증

### 검증 결과

- 신규 작성 중 드래프트가 신규 슬롯을 채우는 조건 유지
- 선택 행 표시와 클릭 콜백 유지
- 검색 조건 유무에 따른 빈 상태 문구·조건 해제 유지
- 100대 더보기 단위와 500대 전체 보기 상한 유지
- 목록 상태 setter를 개별 전달하지 않고 `InventoryListPanelModel` 경계 사용

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- 전체 도메인 시뮬레이션 및 차량 마스터 검증: PASS

### 남은 위험

- 실제 브라우저의 목록 선택·더보기·신규 슬롯을 수동 검증하지 않았다.
- `/inventory` 라우트는 누적 리팩터링 전 18.5 kB에서 18.8 kB로 증가했다.

### 최종 판정

**PASS**

---

## 2026-07-26 — Inventory 목록 계산 훅 검증

### 검증 결과

- 180ms 디바운스 검색 계약 유지
- 상태·상품구분 필터 의미 유지
- 상태 미등록 값의 후순위 처리 유지
- 상태 동률 시 차명 정렬 유지
- 차명·차번·코드 정렬 유지
- 모바일 드래프트는 즉시 검색어를 사용해 미리보기 건수 계산 유지

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- 전체 도메인 시뮬레이션 및 차량 마스터 검증: PASS

### 남은 위험

- Inventory 전용 UI 상호작용을 실제 브라우저에서 수동 검증하지 않았다.
- `/inventory` 라우트 크기가 18.5 kB에서 18.7 kB로 0.2 kB 증가했다.

### 최종 판정

**PASS**

---

## 2026-07-26 — Finder 결과 계산 훅 검증

### 검증 결과

- 기존 `useDeferredValue` 기반 무거운 필터 지연 유지
- 숨김 코드 제외와 패스 상품 후순위 배치 유지
- 최근·관심 합집합 필터 유지
- 명시 정렬과 기본 혜택 점수 정렬 유지
- 필터 드래프트 미리보기 건수 계산 유지
- 인기차종·카탈로그 노출 총계 유지
- 엑셀 열 필터와 숫자 정렬 유지

`app/page.tsx`는 최초 1,459줄에서 724줄로 줄었으며, 결과 계산은
`useFinderResults.ts` 183줄에 모였다.

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS
- git diff --check: PASS

### 남은 위험

- 실제 브라우저에서 빠른 연속 필터 조작과 엑셀 팝오버를 수동 검증하지 않았다.
- `/` 라우트 크기는 리팩터링 전 16.4 kB에서 현재 17.1 kB로 소폭 증가했다.
  기능 모듈 경계와 타입 안정성을 얻은 대가지만, 추후 번들 분석 대상이다.

### 최종 판정

**PASS**

Finder 대형 파일의 우선 분리 목표는 달성했다. 추가 분리는 페이지 상태 훅까지
확장할 수 있으나, 현재 724줄에서 위험 대비 효율을 다시 판단하는 것이 적절하다.

---

## 2026-07-26 — Finder 데이터 로딩 훅 검증

### 검증 결과

- `peekList` 기반 동기 초기값 유지
- Firebase 사용 시 `authReady` 이후 조회 유지
- 로그인 사용자 변경 시 재조회 유지
- 상품·공급사 병렬 조회 및 공급사명 결합 유지
- 15초 타임아웃과 실패 시 빈 목록 처리 유지
- 숨김·패스 목록의 초기 로드와 구독 해제 유지
- 보기 설정 복원을 데이터 조회와 분리해 인증 재조회 시 반복 부작용 제거

### 전체 자동 검증

- typecheck: PASS
- build: PASS
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS

### 최종 판정

**PASS**

다음 단계는 검색·필터·정렬 파생 계산을 `useFinderResults`로 이동하는 작업이다.

---

## 2026-07-26 — Finder 필터 패널 분리 검증

### 요구사항

- Finder의 대형 인라인 필터 패널을 독립 컴포넌트로 이동한다.
- UI, 필터 의미, 드래프트 적용·취소, 모바일 동작을 변경하지 않는다.
- props 전달 자체가 새로운 복잡도가 되지 않도록 명확한 경계를 만든다.

### 검증 결과

| 항목 | 결과 |
|---|---|
| 필터 패널 독립 컴포넌트 이동 | PASS |
| 페이지의 필터 상태 소유권 유지 | PASS |
| 드래프트/라이브 `bump()` 계약 유지 | PASS |
| 최근·관심 목록과 필터 스냅 동기화 유지 | PASS |
| 데스크톱·모바일 공통 패널 유지 | PASS |
| 정렬 라벨·기본 열림·초기화 동작 유지 | PASS |

`FinderFilterPanelModel` 하나가 패널의 표시 모델과 명령을 묶으며, 페이지 내부 상태
setter를 개별적으로 노출하지 않는다. `app/page.tsx`는 1,042줄에서 858줄로 줄었다.

### 전체 자동 검증

- typecheck: PASS
- build: PASS, 26개 페이지 생성
- sim-agent: 37/37 PASS
- sim-lifecycle: PASS
- sim-e2e-settlement: 15/15 PASS
- sim-vehicle-lock: 23/23 PASS
- sim-sheet-merge: 12/12 PASS
- sim-phase12: 25/25 PASS
- verify-master-pass: PASS
- git diff --check: PASS

### 남은 위험

- 실제 브라우저에서 필터 패널의 접힘·스크롤·모바일 하단시트를 수동 시각 검증하지 않았다.
- 다음 구조 작업은 데이터 로딩과 검색·필터 결과 계산 훅 분리다.

### 최종 판정

**PASS**

---

## 2026-07-26 — Cursor 엑셀 결과 테이블 분리 검증

### 검증 기준

원래 사용자 요구사항:

- `app/page.tsx`의 대형 단일 파일을 기능 변경 없이 단계적으로 분리한다.
- 엑셀 결과 테이블을 `features/finder` 아래 독립 컴포넌트로 이동한다.
- UI, 필터 의미, 정렬, 열 너비, 모바일 동작을 유지한다.
- 다른 AI가 이어받을 수 있도록 구현·검증 문서를 갱신한다.

별도 `PLAN.md`는 없으므로 원래 요구사항, `docs/REFACTOR_PROGRESS.md`,
`IMPLEMENTATION_LOG.md`, 실제 diff를 함께 비교했다.

### 구현 대조 결과

| 항목 | 결과 | 근거 |
|---|---|---|
| 엑셀 테이블 분리 | PASS | `ExcelResultsTable.tsx`로 테이블·헤더·팝오버 조립 이동 |
| 필터 의미 유지 | PASS | 표시 행과 팝오버 후보 행을 기존처럼 `rows`/`list`로 분리 |
| 정렬 유지 | PASS | 가격·연식·주행거리 숫자 정렬 함수 유지 |
| 열 순서·너비 유지 | PASS | 기존 `EXCEL_*`, `colLock*`, `excel*Chars` 계산 그대로 이동 |
| 행 동작 유지 | PASS | 상세 이동·컨텍스트 메뉴를 기존 페이지 콜백에 위임 |
| 모바일 동작 유지 | PASS | 기존 `useIsMobile()` 기반 `is-fit` 조건 유지 |
| 인수인계 문서 | PASS | 구현 로그와 리팩터링 진행 문서 갱신 |

`app/page.tsx`는 최초 1,459줄에서 현재 1,042줄로 축소됐다.

### 독립 검증 중 발견·수정한 문제

`scripts/sim-vehicle-lock.mts`가 공급사 전용 단계를 영업자 역할로 호출해 전체
시뮬레이션 중 1건이 실패했다. 제품 엔진의 역할 차단은 올바르며 테스트 하네스가
현재 권한 정책을 반영하지 못한 문제였다.

수정 내용:

- 테스트용 `asRole()` 헬퍼 추가
- `provider_balance_confirmed`, `provider_delivery_response` 실행 시 공급사 역할 적용
- 실행 후 이전 역할을 항상 복원

제품 코드나 권한 정책은 완화하지 않았다.

### 전체 검증 결과

- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS, 26개 페이지 생성
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS, 마스터 ID 1,800개 검증
- `git diff --check`: PASS

---

## 2026-07-26 — 4개 업무 화면 UI/UX 배치 검증

### 판정

**PASS**

- 설정 관심·숨김 관리, 회원 목록, 계약 정산 요약, 채팅 방 목록을 feature 컴포넌트로 분리했다.
- 기존 역할별 표시, 빈 상태, 복구·초기화 액션, 정산 R1/R2 표시 규칙을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 설정·회원·계약·채팅: 모두 HTTP 200
- `git diff --check`: PASS
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — RTDB 어댑터 데이터 계층 분리 검증

### 판정

**PASS**

- 레코드 변환과 상품 보안·중복 정책을 네트워크 어댑터에서 분리했다.
- 첨부 URL 이름 복원, 엔티티 자연키, 정책·계약 조인 결과를 유지했다.
- 공급 원가는 관리자 또는 본인 소유 공급사에만 보이는 정책을 유지했다.
- 카슝 제외 및 차량번호/VIN 실차 중복 제거 우선순위를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 주요 6개 화면: 모두 HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 회원 관리 필터·정렬 분리 검증

### 판정

**PASS**

- 사용자·파트너 목록 필터와 정렬을 순수 모듈로 이동했다.
- 승인대기는 정렬 선택과 관계없이 최상단에 놓이는 규칙을 유지했다.
- 승인 상태와 운영 활성 상태를 별도 필드로 판정하는 규칙을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/members`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 계약 목록 필터·정렬 분리 검증

### 판정

**PASS**

- 계약 필터·정렬·월 옵션을 순수 모듈로 이동했다.
- 진행 기본값의 완료 포함·취소 제외 규칙과 진행률 동률 시 최근 계약 우선을 유지했다.
- 누락된 월 라벨 공개 연결 1건을 타입 검사에서 발견해 수정했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/contract`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 채팅 목록 필터·정렬 분리 검증

### 판정

**PASS**

- 역할별 미확인·문의·완료·취소 판정과 정렬을 순수 모듈로 이동했다.
- 안읽음 동률 시 최근 메시지 우선과 드래프트 미리보기 집계를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/chat`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 채팅 방 색인·표시 분리 검증

### 판정

**PASS**

- 진행 계약과 취소 계약 색인을 분리한 기존 first-wins 규칙을 유지했다.
- product_code, product_uid, product_id, 차량번호 탐색과 삭제 차량 fallback을 유지했다.
- 관리자·공급사·영업 역할별 헤더 계산 연결을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/chat`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Finder 결과 본문 분리 검증

### 판정

**PASS**

- 빈 상태, 카드·상세·엑셀 결과와 페이징 UI를 `FinderResults`로 이동했다.
- 상품 열기·우클릭, Excel 필터/정렬 상태, 500대 표시 상한 연결을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Finder 상단 툴바 분리 검증

### 판정

**PASS**

- 모바일·웹 툴바를 `FinderToolbar`로 이동했다.
- 검색, 정렬, 필터 뱃지, 관심함, 엑셀 다운로드, 보기 전환 연결을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Finder 상품 컨텍스트 분리 검증

### 판정

**PASS**

- 상품 우클릭 액션 구성을 Finder 페이지에서 독립 모듈로 이동했다.
- 역할별 계약문의·공유 노출, 링크·내용 복사, 상세 이동을 유지했다.
- 복사 실패 fallback은 공통 오류 알림으로 현대화했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 정확 경로·감사·일괄 변환 분리 검증

### 판정

**PASS**

- 정확 경로 엔진과 운영 감사·일괄 변환 엔진을 별도 모듈로 이동했다.
- 기존 API는 얇은 호환 진입점으로 유지했다.
- 의존성 주입으로 매칭 본체와 운영 모듈 사이 순환 import가 없다.
- exact 경로, confidence 집계, 샘플 제한, auto/all 정책을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 신호·선택 보조 분리 검증

### 판정

**PASS**

- 원본 차량 신호 수집과 재스냅 입력 복원을 독립 모듈로 이동했다.
- 파워트레인 라벨·인승 분기·실트림 판정을 독립 모듈로 이동했다.
- 기존 export 호환과 매칭 알고리즘 결과를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 마스터 필터·탐색 분리 검증

### 판정

**PASS**

- 차량 5단 필터와 마스터 제조사·모델·세부모델 탐색을 leaf 모듈로 이동했다.
- 르노 표기 호환, 국산 우선 그룹, 한글 정렬, 기존 공개 import 경로를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 마스터 스냅 추적 분리 검증

### 판정

**PASS**

- 추적 키·라벨, 원본 캡처, 필드 diff, 이력 생성을 leaf 모듈로 이동했다.
- 최초 원본 유지, 변경 필드만 기록, 최근 10건 제한을 보존했다.
- `applySnap`의 업무 반영 정책과 기존 공개 import 경로는 변경하지 않았다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 차량 마스터 표시·정규화 분리 검증

### 판정

**PASS**

- 연식·연료·제조사 표시와 연료 배기량 추출을 독립 모듈로 이동했다.
- 기존 공개 import 경로와 반환 규칙을 유지했다.
- 매칭 본체의 연료 정규화도 동일 leaf 모듈을 사용해 규칙 중복이 없다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 클립보드 공통화 검증

**PASS**

- `copyText`가 최신 Clipboard API 실패 시 호환 fallback을 수행한다.
- 임시 textarea는 성공·실패 모두 제거된다.
- 계약 링크와 재고 TSV 복사 실패가 오류로 표시된다.
- typecheck·전체 시뮬레이션 PASS
- 개발 서버 `/inventory`: HTTP 200
- 2차 적용 후 앱·컴포넌트의 직접 Clipboard API 호출 0건
- 실패 시 기존 prompt 또는 오류 toast fallback 유지

---

## 2026-07-26 — Cursor 가격·혜택 원자 분리 독립 검증

### 판정

**PASS (BOM 수정 후)**

- `product-card-pricing.tsx`: 가격 컨텍스트·기간·요금 UI 319줄
- `product-card-perks.tsx`: 혜택·이벤트·조건 UI 158줄
- `product-card-atoms.tsx`: 725줄 → 271줄
- pricing → perks → badges 단방향이며 barrel 역참조가 없어 순환 의존성 없음
- 기존 `product-card-atoms` export 경로 유지

### 발견 및 수정

- Cursor 저장 과정에서 `product-card-atoms.tsx` 시작에 UTF-8 BOM이 추가됨
- BOM 제거 완료

### 검증

- typecheck: PASS
- 전체 시뮬레이션·차량 마스터 검증: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — 공통 확인창·알림 전환 검증

### 판정

**PASS**

- 계약, 정책, 회원, 재고, 개발 도구의 파괴적/중요 작업이 공통 `confirmDialog`를 사용한다.
- 로그인/가입 오류는 브라우저 기본 alert 대신 공통 error toast를 사용한다.
- `app`, `components`, `features` 범위에 직접 `window.confirm`·`window.alert` 호출이 남지 않았다.

### 실행 결과

- `npm run typecheck`: PASS
- `sim-agent`, `sim-lifecycle`, `sim-e2e-settlement`, `sim-vehicle-lock`, `sim-sheet-merge`, `sim-phase12`, `verify-master-pass`: 모두 PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버의 `.next` 충돌 방지를 위해 보류

로컬 시뮬레이션 중 Firebase 환경변수 누락 메시지는 기존 예상 경고이며 실패가 아니다.

---

## 2026-07-26 — 공통 UI 오버레이 분리 검증

### 판정

**PASS**

- `Drawer`, `Modal`을 `components/ui/overlays.tsx`로 이동했다.
- 기존 `@/components/ui` import 경로와 컴포넌트 API를 유지했다.
- 오버레이의 키보드 이동, 닫기, 모바일 풀스크린 표현 로직을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 차량 마스터 타입 분리 검증

### 판정

**PASS**

- 순수 도메인 타입 7종을 별도 파일로 이동했다.
- 기존 `vehicle-master-match.ts`의 type re-export를 유지해 모든 소비자와 스크립트가 호환된다.
- 실행 로직과 데이터 변환 결과에는 변화가 없다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `verify-master-pass`: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — 공통 UI 레이아웃 분리 검증

### 판정

**PASS**

- 레이아웃 원자 4종을 `components/ui/layout.tsx`로 이동했다.
- 공개 API, 스타일 토큰, 모바일 규격, VSplit 이벤트 정리·localStorage 동작을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 공통 UI 버튼 분리 검증

### 판정

**PASS**

- `Btn`, `IconBtn`, `IconSeg`를 `components/ui/buttons.tsx`로 이동했다.
- 기존 공개 API, 모바일 높이·패딩, disabled·접근성 속성, 스타일 오버라이드를 유지했다.
- leaf 버튼 모듈은 tokens와 모바일 훅만 참조하며 barrel 순환 의존성이 없다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 공통 UI 폼 입력 분리 검증

### 판정

**PASS**

- 기본 폼 입력 4종을 `components/ui/form-controls.tsx`로 이동했다.
- 공개 API와 모바일 입력 규격, 키보드·포커스 동작을 보존했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

---

## 2026-07-26 — 공통 UI 리스트 분리 검증

### 판정

**PASS**

- `ListRow`, `ListBox`를 `components/ui/list.tsx`로 이동했다.
- 기존 공개 import 경로, props, 스타일 토큰 사용을 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 실행 중인 개발 서버 보호를 위해 보류

Firebase 환경변수 누락 메시지는 localStorage 시뮬레이션에서 발생하는 기존 경고이며
검증 실패가 아니다.

### 남은 위험

- 실제 브라우저에서 엑셀 헤더 팝오버 위치와 가로 스크롤을 수동 시각 검증하지 않았다.
- `app/page.tsx`는 여전히 1,042줄이므로 필터 패널과 결과 계산 훅 분리가 남아 있다.
- `.claude/`는 이번 검증에서 생성·수정하지 않은 별도 미추적 디렉터리다.

### 최종 판정

**PASS**

Cursor의 엑셀 결과 테이블 분리는 원래 요구사항과 일치한다. 독립 검증에서 발견한
테스트 하네스 불일치도 수정했으며, 전체 자동 검증이 통과한다.

---

## 2026-07-26 — Finder 구조 분리

### 검증 기준

원래 사용자 요구사항:

- 대형 단일 파일을 분리한다.
- 다른 AI가 이어받을 수 있도록 진행 내용을 문서화한다.
- 기존 기능과 사용자 동작을 깨뜨리지 않는다.

별도의 Claude Code `PLAN.md`는 없었다. 따라서 사용자의 원래 요구사항,
`docs/REFACTOR_PROGRESS.md`, 실제 변경사항을 기준으로 검증했다.

### 요구사항 충족 여부

| 요구사항 | 결과 | 근거 |
|---|---|---|
| 대형 Finder 파일 분리 | PASS | 1,459줄에서 1,213줄로 축소, 3개 모듈로 책임 이동 |
| 인수인계 문서화 | PASS | 협업 규칙, 진행 메모, 구현 로그, 검증 문서 추가 |
| 동작 호환성 유지 | PASS | 타입 검사, 빌드, 핵심 시뮬레이션 통과 |

### 실제 변경

- `features/finder/filter-state.ts`
- `features/finder/excel-columns.ts`
- `features/finder/ExcelFilterPopover.tsx`
- `app/page.tsx`에서 위 책임 제거 및 import로 교체
- `docs/AI_COLLABORATION.md`
- `docs/REFACTOR_PROGRESS.md`
- `IMPLEMENTATION_LOG.md`
- `HANDOFF.md`

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS, 26개 페이지 생성
- `npx.cmd tsx scripts/sim-agent.mts`: 37/37 PASS
- `npx.cmd tsx scripts/sim-phase12.mts`: 25/25 PASS
- `git diff --check`: PASS

### 회귀·보안·데이터 호환성

- Firebase 데이터 경로와 보안 규칙은 변경하지 않았다.
- `FilterBag` 필드와 sessionStorage 키를 유지했다.
- 엑셀 필터 다중값 OR 의미와 숫자 정렬 방식을 유지했다.
- 팝오버의 검색, 선택, 초기화, 정렬, 닫기 동작을 유지했다.
- 프로덕션 번들의 `/` 크기는 변경 전과 동일한 16.4 kB다.

### 남은 위험

- 브라우저에서 실제 팝오버 위치와 클릭 동작을 수동 시각 검증하지 않았다.
- `app/page.tsx`는 여전히 1,213줄이므로 추가 분리가 필요하다.
- Firebase 환경변수가 없는 localStorage 시뮬레이션에서는 기존 경고가 출력된다.
- 당시 `scripts/sim-vehicle-lock.mts` 역할 기대 불일치가 남아 있었으나, 위의 최신
  검증 단계에서 테스트 역할 설정을 수정해 23/23 통과로 해소했다.

### 최종 판정

**PASS**

현재 단계의 구조 분리는 원래 요구사항을 충족하며, 자동 검증 범위에서 회귀가 없다.

---

## 2026-07-26 — Inventory 편집 패널 분리 독립 검증

### 판정

**PASS**

`app/inventory/page.tsx`의 기본정보·운영정보 UI를
`features/inventory/InventoryEditorPanes.tsx`로 이동했다. 페이지에는 저장, OCR,
차종 마스터 적용과 같은 도메인 조정 로직을 남겨 UI 분리로 동작 계약이 바뀌지 않게 했다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 정적 페이지 26개 생성

### 독립 확인 사항

- 선택 여부, 신규/수정 모드, dirty 상태가 모델을 통해 그대로 전달된다.
- 마스터 선택 결과의 `applySnap(..., source: 'picker')` 처리는 페이지에 보존됐다.
- 가격·사진 변경은 기존처럼 폼 갱신과 dirty 설정을 함께 수행한다.
- 관리자 전용 필드와 공급사 정책 범위 필터가 유지됐다.
- Firebase 환경변수 누락 문구는 localStorage 시뮬레이션의 기존 경고다.

### 남은 위험

- 실제 브라우저에서 OCR 파일 선택, 사진 길게 누르기, 마스터 피커를 수동 검증하지 않았다.
- `/inventory` 라우트 크기가 18.8 kB에서 19.1 kB로 0.3 kB 증가했다.
  구조 분리 결과이며, 동적 로딩을 포함한 번들 최적화는 별도 후속 작업으로 남긴다.

---

## 2026-07-26 — Inventory OCR·차종 마스터 훅 분리 검증

### 판정

**PASS**

OCR와 차량 마스터 처리 책임을 `useInventoryVehicleTools.ts`로 이동했고,
`app/inventory/page.tsx`는 643줄에서 496줄로 축소됐다.

### 회귀 확인

- 선택 generation 가드 유지: 늦게 끝난 이전 선택 작업이 현재 폼을 덮지 않는다.
- exact 경로 및 high/medium 신뢰도 조건을 만족할 때만 자동 DB 패치한다.
- 색상 패치와 마스터 패치 모두 목록 캐시를 함께 갱신한다.
- 사용자 재매칭은 `source: 'manual'`, 피커 선택은 `source: 'picker'`를 유지한다.
- OCR는 `/api/ocr/extract` 계약과 빈 칸 우선 병합을 유지한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 26개 페이지

### 남은 위험

- OCR와 마스터 피커의 실제 브라우저 파일·클릭 흐름은 수동 검증하지 않았다.
- `/inventory` 라우트는 19.2 kB로 직전보다 0.1 kB 증가했다.

---

## 2026-07-26 — Inventory 편집 수명주기 분리 검증

### 판정

**PASS**

저장·삭제·편집 상태 전환을 `useInventoryEditorLifecycle.ts`로 분리했다.
페이지는 496줄에서 386줄로 축소됐다.

### 독립 확인 사항

- 공급사 소유권 검증과 귀속 코드 강제가 유지됐다.
- 차량번호 중복 검사에서 공백 제거 및 자기 상품 제외 조건이 유지됐다.
- `vehicleLockedBy` 결과가 저장 폼 상태보다 우선하며 계약 코드도 함께 각인된다.
- 삭제 전 `blockingContractFor`로 진행 계약 전체를 검사한다.
- 저장 실패 시 dirty 상태를 해제하지 않는다.
- 신규 취소는 선택 해제, 기존 수정 취소는 목록 원본 복원으로 동작한다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 26개 페이지

### 남은 위험

- 저장 확인 알림과 삭제 확인창은 실제 브라우저에서 수동 검증하지 않았다.
- `/inventory` 라우트가 19.5 kB로 직전 대비 0.3 kB 증가했다.

---

## 2026-07-26 — Inventory 데이터·권한 초기화 분리 검증

### 판정

**PASS**

상품 로딩과 접근 제어 이벤트를 `useInventoryData.ts`로 이동했다.
`app/inventory/page.tsx`는 386줄에서 342줄로 축소됐다.

### 독립 확인 사항

- 상품과 파트너를 병렬 조회한 후 공급사 이름을 결합하는 순서를 유지했다.
- 공급사 역할의 `provider_company_code` 범위 제한을 유지했다.
- 최초 진입에서 시드·권한·정책·상품 순으로 준비한다.
- 마스터 로딩과 데스크톱 첫 상품 선택은 비동기로 실행한다.
- 역할 이벤트 리스너는 최신 선택 콜백을 ref로 참조해 불필요한 재등록을 방지한다.
- 모바일 역할 전환에서는 첫 상품을 자동 선택하지 않는다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- `scripts/sim-agent.mts`: 37/37 PASS
- `scripts/sim-lifecycle.mts`: PASS
- `scripts/sim-e2e-settlement.mts`: 15/15 PASS
- `scripts/sim-vehicle-lock.mts`: 23/23 PASS
- `scripts/sim-sheet-merge.mts`: 12/12 PASS
- `scripts/sim-phase12.mts`: 25/25 PASS
- `scripts/verify-master-pass.mts`: PASS
- `npm.cmd run build`: PASS, 26개 페이지

### 남은 위험

- 역할 변경과 모바일/데스크톱 첫 선택 차이는 실제 브라우저에서 수동 검증하지 않았다.
- `/inventory` 라우트가 19.7 kB로 직전 대비 0.2 kB 증가했다.

---

## 2026-07-26 — Inventory 런타임·번들 후속 검증

### 판정

**자동 검증 PASS / 브라우저 수동 검증 보류**

### 확인 내용

- 실행 중인 로컬 서버의 `http://localhost:4004/inventory`: HTTP 200
- 응답 본문: 19,887 bytes
- production build의 `/inventory`: 19.7 kB, First Load JS 272 kB
- route 전용 JavaScript 파일: 51,983 bytes
- 공급사 시트와 차량 마스터 로더의 기존 지연 로딩 유지

### 번들 판단

구조 분리 과정의 소폭 증가는 새 대형 라이브러리 유입으로 확인되지 않았다.
현재 크기만 줄이기 위해 훅을 다시 합치지 않는다. 이후 최적화는 실제 사용자 성능 측정이나
명확한 예산 기준이 생겼을 때 동적 패널 로딩 등으로 별도 진행한다.

### 보류 사유

브라우저 제어를 연결하려 했으나 사용 가능한 브라우저 세션이 없었다. 따라서 다음 항목은
수동 확인이 남아 있다.

- 데스크톱 첫 상품 자동 선택
- 모바일 목록 우선 진입
- OCR 파일 선택 및 완료 표시
- 마스터 피커와 재매칭
- 사진 탭·길게 누르기
- 역할 변경 시 권한 게이트와 선택 초기화

---

## 2026-07-26 — Product card 옵션 원자 분리 검증

### 판정

**PASS**

옵션 파싱과 칩 UI를 `product-card-options.tsx`로 이동했다. 기존 barrel 역할을 하는
`product-card-atoms.tsx`에서 같은 이름을 재수출하므로 소비자 import 계약은 바뀌지 않았다.

### 확인 사항

- 빈 옵션의 `옵션미입력` 표시 유지
- 기본 카드의 최대 2개 표시와 말줄임 유지
- 엑셀 결과의 2줄 높이·간격 상수 유지
- 상세 화면의 전체 wrap 표시 유지
- ResizeObserver 해제 처리 유지

### 실행 결과

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `npm.cmd run build`: PASS, 26개 페이지
- `/`, `/inventory` 번들 표기 변화 없음

### 남은 작업

`product-card-atoms.tsx`는 1,037줄이다. 다음 안전한 경계는 가격 컨텍스트·기간 칩·요금
표시 묶음이다.

---

## 2026-07-26 — Product card 뱃지 원자 분리 검증

### 판정

**PASS**

뱃지 계산과 렌더링을 `product-card-badges.tsx`로 이동했다. 기존 파일은 내부 사용을
명시적으로 import하고 동일 이름을 재수출하므로 순환 의존성과 소비자 변경이 없다.

### 확인 사항

- 고객 화면에 차량 상태가 노출되지 않는 audience 게이트 유지
- 상태·상품·심사 순서 및 tone 유지
- 계약중 pulse와 solid variant 유지
- 축약 라벨 역변환을 포함한 tooltip 유지
- 혜택별 설명과 연령 숫자 설명 유지

### 실행 결과

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- `npm.cmd run build`: PASS, 26개 페이지
- 주요 route 번들 표기 변화 없음

### 다음 경계

`product-card-atoms.tsx`는 929줄이다. 가격 컨텍스트와 기간·요금 표시 묶음을 다음
분리 대상으로 유지한다.

---

## 2026-07-26 — Product card 기간별 요금 분리 검증

### 판정

**자동 검증 PASS / production build 보류**

`PriceMini`와 `PriceFare` 묶음을 `product-card-fares.tsx`로 이동했고 기존 공개 경로를
재수출로 유지했다. `product-card-atoms.tsx`는 929줄에서 843줄로 축소됐다.

### 실행 결과

- `npm.cmd run typecheck`: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- production build: 실행하지 않음

### 빌드 보류 이유

Next 개발 서버와 production build가 같은 `.next`를 사용하면 실행 중 서버가 500으로
깨질 수 있다. 사용자의 서버 유지 요청에 따라 작업 중에는 build를 실행하지 않고,
서버를 내려도 되는 시점에 최종 build를 수행한다.

---

## 2026-07-26 — Product card 차량 신원·제원 분리 검증

### 판정

**자동 검증 PASS / 서버 유지**

- `idParts`, `idMobile`, `cardTitle`, `specLine`, `specLineCard`를
  `product-card-identity.ts`로 이동했다.
- 제조사 표준 표시, 무트림 라벨 제외, 연료 내장 배기량 fallback을 유지했다.
- 카드 고정 슬롯의 누락값 `-` 표시를 유지했다.
- 기존 `product-card-atoms` import 경로를 유지했다.

### 실행 결과

- typecheck: PASS
- 전체 7개 시뮬레이션·검증 스크립트: PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS
- production build: 서버 유지 요청으로 보류

---

## 2026-07-26 — Product card 뱃지 UI 분리

**PASS**

- 상품구분 뱃지와 상태·상품·심사 레일을 `product-card-badge-view.tsx`로 이동
- audience 게이트, 표시 순서, pulse, dense 폭 유지
- typecheck·전체 시뮬레이션 PASS
- 개발 서버 `/inventory`: HTTP 200
- `git diff --check`: PASS

---

## 2026-07-26 — Product card 신원 UI 분리 검증

### 판정

**PASS**

- `Plate`, `CardTitle`을 `product-card-identity-view.tsx`로 이동했다.
- 폰트, 말줄임, tooltip, 차량번호 monospace 표현을 유지했다.
- 순수 문자열 모듈이 UI 컴포넌트를 import하지 않는 방향을 유지했다.
- 기존 공개 import 경로는 재수출로 호환된다.

### 실행 결과

- typecheck: PASS
- 전체 시뮬레이션·차량 마스터 검증: PASS
- 개발 서버 `/inventory`: HTTP 200
- production build: 서버 유지 요청으로 보류
