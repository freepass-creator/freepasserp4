# FreepassERP4 리팩터링 진행 메모

## 완료: 전자서명 공개 쓰기 경계 (2026-07-26)

- 공개 슬롯에 계약 영업 귀속 스냅샷 추가
- 익명 최초 제출만 허용하고 계약·금액·귀속 필드 불변 처리
- 로그인 관리자를 플랫폼/소유 영업조직으로 제한
- 입력 길이·서명 크기·임의 필드 가드 추가
- 전용 시뮬레이션 15/15 PASS
- 다음: 서명 링크 만료·해지 정책

## 완료: 정산 private dry-run 마이그레이션 도구 (2026-07-26)

- V3/V4 공개 정산 → R1/R2/admin private 이동 계획
- 기존 private 우선 보존 및 안전 삭제 계획
- `/dev` 미리보기·위험 확인 실행 UI
- 전용 시뮬레이션 10/10 PASS
- 라이브 실행은 운영 절차로 보류

## 완료: 정산 private 저장 골격 (2026-07-26)

- 신규 정산을 공개/R1/R2/admin 노드로 물리 분리
- 역할별 private 조회·병합 및 Rules 추가
- 권한·분리 시뮬레이션 44/44 PASS
- 다음: 기존 정산 dry-run 마이그레이션 도구

## 완료: 정산 표시 역할 분리 1차 (2026-07-26)

- 영업 R2 / 공급사 R1 / 관리자 R1·R2·순수익 화면 분리
- 정산 엑셀 열도 동일한 역할 정책 적용
- 전체 검사 PASS
- 다음: RTDB 정산 금액 private 노드 물리 분리

## 완료: Firebase Rules 조직 5역할 정렬 (2026-07-26)

- 일반 영업자 개인/영업 관리자 채널/공급사 역할 회사/플랫폼 관리자 전체 범위 적용
- `provider_admin`을 재고·정책·private 상품·채팅·계약·정산 Rules에 반영
- 계약 단계 역할군과 정산 관리자 전용 상태 변경 적용
- 권한 시뮬레이션 35/35 및 전체 핵심 회귀 PASS
- 운영 Rules 게시와 실계정 검증은 미완료

## 완료: 조직 권한 코드 골격 1차 (2026-07-26)

- 중앙 권한 모듈과 표준 5역할 판정 추가
- 기존 3역할 UI 호환을 유지하며 세션 원본 역할 보존
- 영업 개인/영업 채널 관리자/공급사 회사 조회 범위 분리
- 채팅·계약·메뉴 뱃지의 로컬 역할 필터를 중앙 판정으로 통일
- 권한 시뮬레이션 26/26 및 기존 핵심 회귀 PASS
- 다음: Firebase Rules 5역할 정렬. 역할 부여 UI는 후속 범위

## 설계 확정: 조직 기반 권한 모델 (2026-07-26)

- 상세 기준: `docs/AUTHORIZATION_MODEL.md`
- 플랫폼 관리자 전체, 영업채널 관리자 채널 전체, 영업자 개인, 공급사 관리자·직원 회사 전체
- 채팅·계약·정산·재고·회원·감사 권한 매트릭스 정의
- 현재 3역할 축약과 신규 5역할 모델의 차이 및 구현 순서 기록
- 다음 단계: 세션 세부 역할 보존 + 중앙 권한 helper

## 완료: 계약 쓰기 스코프·상태 무결성 (2026-07-26)

- 계약 참여자 단위 쓰기 및 귀속·금액 스냅샷 불변 처리
- 영업자/공급사 담당 단계 필드 분리
- 신규 상태 `계약요청` 강제, 전체 5단계 완료 전 `계약완료` 차단
- 전자서명 승인 예외 경로 보존
- 계약 규칙 시뮬레이션 23/23 및 전체 핵심 회귀 PASS
- 실 Rules 게시와 Emulator 검증은 운영 단계 미완료

## 완료: 채팅 쓰기 스코프 (2026-07-26)

- 방 참여자만 방 생성·갱신 가능, 핵심 소유 필드 변경 금지
- 메시지 create-only 및 인증 UID 발신자 강제
- V3/V4 방 소유권을 함께 판정해 레거시 브리지 보존
- 채팅 규칙 시뮬레이션 40/40 및 핵심 회귀 검사 PASS
- 실 Rules 배포·실계정 검증은 운영 단계 미완료

## 완료: 채팅방·메시지 읽기 스코프 (2026-07-26)

- V3/V4 방 목록을 관리자 전체, 공급사 회사, 영업자 UID·채널 범위로 제한
- V3 중첩 메시지는 방 노드 소유권 검사
- V4 평면 메시지는 `room_id` 쿼리와 방 소유권 검사
- 어댑터의 기존 스코프 조회와 Rules 경계를 일치시킴
- 채팅 규칙 전용 시뮬레이션 21/21 및 전체 회귀 검사 PASS
- Rules 실배포와 실제 계정 검증은 운영 단계 미완료

> 목적: 다른 AI/개발자가 기존 판단을 반복하지 않고 안전하게 이어서 작업하기 위한 인수인계 문서.
> 원칙: 기능·화면·데이터 계약을 바꾸지 않는 구조 분리를 먼저 수행한다.
> 협업 역할과 산출물 규칙은 `docs/AI_COLLABORATION.md`를 따른다.

## 현재 작업 대상

- Finder 우선 분리 완료: `app/page.tsx` 1,459줄 → 724줄
- 현재 대상: `app/inventory/page.tsx`
- Inventory 시작 크기: 802줄
- Inventory 현재 크기: 749줄
- 목표: 순수 목록 계산 → 목록 UI → 편집 폼/마스터 처리 순서로 단계 분리

## 완료: Finder 1차 분리

### 새 파일

- `features/finder/filter-state.ts`
  - `FilterBag`, `SavedFinderFilters`, `InterestKey`
  - 필터 초안 복제·동등성 비교
  - sessionStorage 읽기·쓰기·초기화
  - 배열→Set 및 숫자 fallback 유틸
- `features/finder/excel-columns.ts`
  - 엑셀 열 표시값
  - 다중값 필터 매칭
  - 숫자 열 판정 및 정렬값
- `features/finder/ExcelFilterPopover.tsx`
  - 엑셀 열 필터의 값 검색·선택·초기화 UI
  - 숫자 열 오름차순·내림차순 전환 UI

### 유지한 계약

- 저장 키 `FILTER_SS` 유지
- `FilterBag` 필드와 Set 기반 상태 구조 유지
- 엑셀 조건·옵션 필터의 OR 의미 유지
- 가격·연식·주행거리 숫자 정렬 방식 유지
- 기존 `app/page.tsx`의 화면 및 사용자 동작 변경 없음

### 검증 결과

- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS
- `npx.cmd tsx scripts/sim-agent.mts`: 37/37 PASS
- `npx.cmd tsx scripts/sim-phase12.mts`: 25/25 PASS
- `ExcelFilterPopover` 분리 후 동일 검증 재실행: 전체 PASS

Firebase 환경변수 누락 경고는 시뮬레이션이 localStorage 백엔드로 실행될 때 발생하는 기존 경고다.

## 완료: Finder 2차 분리 (엑셀 결과 테이블)

### 새 파일

- `features/finder/ExcelResultsTable.tsx`
  - 엑셀 시트·테이블·헤더 필터 팝오버 조립
  - 열 모드·칸 폭·헤더 클릭(`hdrTh`) 포함
  - 행 클릭·컨텍스트 메뉴는 콜백으로 페이지에 위임

### 유지한 계약

- UI·필터 의미·정렬·열 너비·모바일 `is-fit` 분기 변경 없음
- `excelRows`/`months` 계산과 `colFilter`/`colSort`/`openCol` 상태는 페이지에 유지
- 다운로드·스크롤바 폭 계산은 페이지에서 기존과 동일하게 `excelRows` 사용

### 검증 결과

- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS
- 전체 도메인 시뮬레이션 및 차량 마스터 검증: PASS
- 독립 검증 중 `sim-vehicle-lock`의 역할 설정 불일치를 수정해 23/23 PASS

## 완료: Finder 3차 분리 (필터 패널)

### 새 파일

- `features/finder/FinderFilterPanel.tsx`
  - 데스크톱 사이드바와 모바일 필터 시트 공통 UI
  - 필터 표시 모델과 변경 명령을 `FinderFilterPanelModel`로 묶음

### 유지한 계약

- 페이지가 필터 상태와 드래프트/라이브 전환을 계속 소유
- 최근·관심 목록 초기화 시 라이브 상태와 필터 스냅을 함께 갱신
- 필터 그룹 순서, 기본 열림, 정렬 라벨, 초기화 동작 유지

### 검증 결과

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

## 완료: Finder 4차 분리 (데이터 로딩)

### 새 파일

- `features/finder/useFinderData.ts`
  - 상품·공급사 조회와 공급사명 결합
  - 인증 준비 및 로그인 사용자 변경에 따른 재조회
  - 로드 타임아웃·오류 처리
  - 숨김·패스 목록 구독

### 유지한 계약

- 캐시된 목록을 최초 렌더에 사용
- Firebase 인증 토큰 준비 전 조회 금지
- 데이터 조회 실패와 빈 데이터의 현재 UI 처리 유지
- 구독 cleanup 유지

### 검증 결과

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

## 완료: Finder 5차 분리 (결과 계산)

### 새 파일

- `features/finder/useFinderResults.ts`
  - 지연 필터링·정렬·관심·숨김·패스 반영
  - 인기차종·동적 선택지·차량 연쇄 필터 모수
  - 드래프트 미리보기·총 노출 수·엑셀 결과

### 유지한 계약

- 무거운 목록 계산의 deferred 적용
- 기본 혜택 점수 정렬과 명시 정렬
- 최근·관심 합집합 및 패스 상품 후순위
- 엑셀 열 필터와 숫자 정렬

### 검증 결과

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

## 완료: Inventory 1차 분리 (목록 계산)

### 새 파일

- `features/inventory/useInventoryResults.ts`
  - 검색·상태·상품구분 필터
  - 상태·차명·차번·코드 정렬
  - 드래프트 미리보기 건수

### 유지한 계약

- 디바운스된 검색어는 실제 목록에 사용
- 즉시 검색어는 모바일 드래프트 미리보기에 사용
- 상태 정렬 순서와 미등록 상태 후순위 유지

### 검증 결과

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

## 완료: Inventory 2차 분리 (목록 UI)

### 새 파일

- `features/inventory/InventoryListPanel.tsx`
  - 신규 등록·드래프트 슬롯
  - 빈 상태·조건 해제
  - 선택 행 목록과 페이지 증가

### 유지한 계약

- 100대 더보기 단위와 500대 상한
- 작성 중 신규 행 표시
- 선택 상품 클릭과 조건 초기화

### 검증 결과

- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS

## 다음 작업 순서

1. 브라우저 세션 연결 후 Inventory 수동 회귀 검증
2. Product card 가격 컨텍스트·기간·요금 원자 분리
3. Inventory 사진 처리 책임 분리는 실제 복잡도 증가 시 재검토

각 단계 완료 후 아래 검증을 반복한다.

```powershell
npm.cmd run typecheck
npm.cmd run build
npx.cmd tsx scripts/sim-agent.mts
npx.cmd tsx scripts/sim-phase12.mts
```

## 주의·금지사항

- 기존 UI를 새 디자인으로 재작성하지 않는다.
- 필터 상태를 하나의 거대한 Context로 옮기지 않는다.
- props만 수십 개 전달하는 형식적인 컴포넌트 분리는 피한다.
- `product-filters.ts`, `product-card-atoms.tsx`의 도메인 의미를 페이지에 복제하지 않는다.
- 모바일은 단순 축소판이 아니므로 `useIsMobile()` 분기를 임의로 통합하지 않는다.
- 기존 사용자 변경사항과 무관한 파일은 정리하거나 포맷하지 않는다.
- 공급사 전용 단계를 테스트할 때 실제 공급사 역할을 설정한다. 권한 검사를 우회하거나
  제품 엔진의 역할 제한을 완화하지 않는다.

## 작업 트리 상태

현재 리팩터링 변경은 커밋하지 않았다.

- 수정: `app/page.tsx`
- 수정: `scripts/sim-vehicle-lock.mts` (테스트 역할 설정)
- 추가: `features/finder/filter-state.ts`
- 추가: `features/finder/excel-columns.ts`
- 추가: `features/finder/ExcelFilterPopover.tsx`
- 추가: `features/finder/ExcelResultsTable.tsx`
- 추가: `features/finder/FinderFilterPanel.tsx`
- 추가: `features/finder/useFinderData.ts`
- 추가: `features/finder/useFinderResults.ts`
- 추가: `features/inventory/useInventoryResults.ts`
- 추가: `features/inventory/InventoryListPanel.tsx`
- 추가: `features/inventory/InventoryEditorPanes.tsx`
- 추가: `features/inventory/useInventoryVehicleTools.ts`
- 추가: `features/inventory/useInventoryEditorLifecycle.ts`
- 추가: `features/inventory/useInventoryData.ts`
- 추가: `docs/REFACTOR_PROGRESS.md`
- 추가: `docs/AI_COLLABORATION.md`
- 추가: `IMPLEMENTATION_LOG.md`
- 추가: `VERIFICATION.md`

## 완료: Inventory 3차 분리 (편집 패널 UI)

### 새 파일

- `features/inventory/InventoryEditorPanes.tsx`
  - 기본정보와 운영정보 패널
  - 필드 메타데이터 그룹 구성
  - OCR 입력, 마스터 피커, 가격, 사진 UI

### 페이지에 유지한 책임

- 저장·삭제와 편집 수명주기
- OCR 요청 처리
- 차종 마스터 자동보정 및 DB 반영
- 선택 마스터 결과의 폼 적용

### 결과

- `app/inventory/page.tsx`: 749줄 → 643줄
- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS
- `/inventory` 라우트: 19.1 kB (이전 18.8 kB, 후속 최적화 후보)

## 완료: Inventory 4차 분리 (OCR·차종 마스터)

### 새 파일

- `features/inventory/useInventoryVehicleTools.ts`
  - 마스터 지연 로딩
  - 선택 시 자동보정 및 경쟁 상태 방지
  - 수동 재매칭과 피커 적용
  - 등록증 OCR

### 결과

- `app/inventory/page.tsx`: 643줄 → 496줄
- 자동 DB 반영 조건과 OCR 빈 칸 병합 계약 유지
- typecheck, build, 전체 도메인 시뮬레이션, 차량 마스터 검증: PASS
- `/inventory`: 19.2 kB

## 완료: Inventory 5차 분리 (편집 수명주기)

### 새 파일

- `features/inventory/useInventoryEditorLifecycle.ts`
  - 신규·편집·취소·저장·삭제
  - 폼 초기화·복사·붙여넣기
  - 색상 필드 즉시 정규화

### 결과

- `app/inventory/page.tsx`: 496줄 → 386줄
- 소유권·차번 중복·계약 잠금·삭제 보호 규칙 유지
- typecheck, build, 전체 시뮬레이션, 차량 마스터 검증: PASS
- `/inventory`: 19.5 kB

## 완료: Inventory 6차 분리 (데이터·권한 초기화)

### 새 파일

- `features/inventory/useInventoryData.ts`
  - 상품·파트너·정책 로딩
  - 공급사 데이터 범위
  - 권한 게이트 및 역할·메뉴 이벤트

### 결과

- `app/inventory/page.tsx`: 386줄 → 342줄
- 모바일/데스크톱 초기 선택 차이와 백그라운드 마스터 로딩 유지
- typecheck, build, 전체 시뮬레이션, 차량 마스터 검증: PASS
- `/inventory`: 19.7 kB

## 완료: Inventory 번들·런타임 후속 분석

- 로컬 `/inventory` HTTP 200 확인
- route 전용 chunk 51,983 bytes
- production 표기 19.7 kB / First Load JS 272 kB
- `SheetSync`, 차량 마스터 로더의 지연 로딩 유지 확인
- 소폭 번들 증가는 구조 분리 래퍼 비용으로 판단하여 재결합하지 않음
- 브라우저 세션 부재로 클릭·반응형 수동 검증은 보류

## 다음 대형 파일 후보

2026-07-26 줄 수 기준:

1. `components/product-card-atoms.tsx` — 1,151줄
2. `lib/domain/vehicle-master-match.ts` — 1,132줄
3. `components/ui/index.tsx` — 826줄
4. `app/page.tsx` — 724줄
5. `lib/firebase/rtdb-adapter.ts` — 567줄

다음 구현 후보는 UI 원자 컴포넌트가 다수 모인 `product-card-atoms.tsx`다.
차량 마스터 매칭 파일은 핵심 도메인 알고리즘이므로 순수 함수 단위 테스트 경계를 먼저
확보한 뒤 분리한다.

## 완료: Product card atoms 1차 분리 (옵션)

- 새 파일: `components/product-card-options.tsx` (121줄)
- `productOptions`, `OptionChips`, `OptionsInline` 이동
- 기존 `product-card-atoms` 공개 import 경로 재수출 유지
- `components/product-card-atoms.tsx`: 1,151줄 → 1,037줄
- typecheck, build, 전체 시뮬레이션: PASS

## 완료: 공통 UI 내비게이션·피드백 분리

- 새 파일: `components/ui/navigation.tsx`
  - `NavBack`, `BottomNav` 이동
- 새 파일: `components/ui/feedback.tsx`
  - `EmptyState`, `Loading`, `CenterNote`, `Message` 이동
- `components/ui/index.tsx`는 기존 공개 API를 재수출해 호출부 변경이 없다.
- 내비게이션의 history fallback, 모바일 아이콘 크기, safe-area와 하단 탭 위치 계산을 유지했다.
- 로딩 role/aria-label, 상태 메시지 색 토큰과 레이아웃을 유지했다.
- typecheck·전체 7개 시뮬레이션·마스터 전수 검증·diff 검사 PASS, 홈·재고·계약·채팅·회원·설정 HTTP 200.
- 다음 후보: 통계·요약 묶음(`Card`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`).

## 완료: 공통 UI 통계·요약 분리

- 새 파일: `components/ui/metrics.tsx`
- 이동: `Card`, `Toolbar`, `Panel`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`, `Step`
- tone별 색상 선택을 `toneColor` 내부 함수로 통합했다.
- 기존 `@/components/ui` 공개 import와 props·타입 export는 유지한다.
- `components/ui/index.tsx`: 393줄 → 309줄.
- typecheck·전체 7개 시뮬레이션·마스터 전수 검증·diff 검사 PASS.
- 홈·재고·계약·채팅·회원·설정 HTTP 200.
- 다음 후보: 칩·필터 UI(`PillTabs`, `ToggleChips`, `FilterGroup`, `FilterChips`).

## 완료: 공통 UI 칩·필터 분리

- 새 파일: `components/ui/filters.tsx`
- 이동: `PillTabs`, `ToggleChips`, `FilterGroup`, `FilterChips`, `ChipOpt`
- 선택 햅틱, 모바일 높이·패딩, disabled 표시, 필터 카운트 동작을 유지했다.
- `FormGrid`는 `ToggleChips`를 leaf 모듈에서 직접 import해 barrel 순환을 피한다.
- 기존 `@/components/ui` 공개 import와 타입 export는 유지한다.
- `components/ui/index.tsx`: 309줄 → 191줄.
- typecheck·전체 7개 시뮬레이션·마스터 전수 검증·diff 검사 PASS.
- 홈·재고·계약·채팅·회원·설정 HTTP 200.
- 다음 후보: `DetailShell`, `FormGrid`, `CopyBlock` 책임별 분리.

## 완료: 공통 UI 본체 최종 분리

- 새 파일: `components/ui/detail-shell.tsx`
- 새 파일: `components/ui/form-grid.tsx`
- 새 파일: `components/ui/copy-block.tsx`
- 새 파일: `components/ui/formatters.ts`
- 이동: `DetailShell`, `FormGrid`, `CopyBlock`, `won`, `fmtPhone`
- 숫자 입력 표시용 `fmtNumber`도 순수 포맷 유틸로 명명했다.
- 기존 `@/components/ui` 공개 import와 동작은 유지한다.
- `components/ui/index.tsx`: 191줄 → 32줄의 순수 barrel.
- typecheck·전체 7개 시뮬레이션·마스터 전수 검증·diff 검사 PASS.
- 홈·재고·계약·채팅·회원·설정·정책·FAQ HTTP 200.
- 공통 UI 대형 단일 파일 분리는 완료 상태다.
- 다음 큰 후보: `vehicle-master-match.ts` 신호 정규화·점수 계산 경계.

## 완료: 차량 마스터 입력 신호 정규화 분리

- 새 파일: `lib/domain/vehicle-master-normalize.ts` (225줄)
- `unpackVehicleSignals` 구현을 `unpackVehicleSignalsEngine`으로 이동했다.
- 기존 공개 함수는 호환 래퍼로 유지해 호출부 변경이 없다.
- 본체 정책 함수는 명시적 의존성 객체로 주입해 순환 import를 피했다.
- 연식·배기 파서는 정규화 엔진 내부로 이동했다.
- `vehicle-master-match.ts`: 843줄 → 676줄.
- typecheck·전체 7개 시뮬레이션·마스터 전수 검증·diff 검사 PASS.
- `/inventory` HTTP 200.
- 다음 후보: 모델 잠금·세대 후보 점수 계산 엔진.

## 완료: 차량 마스터 모델·세대 점수 엔진 분리

- 새 파일: `lib/domain/vehicle-master-score.ts` (148줄)
- `selectMasterEntry`로 제조사 풀, 모델 잠금, 세대 후보 점수 계산을 이동했다.
- 세대코드·N세대 서수·연식·연료·EV·쿠페 정책과 동점 정렬을 유지했다.
- 선택 결과에 후속 variant·트림 판정이 필요한 컨텍스트를 명시적으로 반환한다.
- variant·트림·confidence는 본체에 남겨 한 번에 정책을 과도하게 이동하지 않았다.
- `vehicle-master-match.ts`: 676줄 → 625줄.
- typecheck·전체 7개 시뮬레이션·마스터 전수 검증·diff 검사 PASS.
- `/inventory` HTTP 200.
- 다음 후보: variant 점수 계산 엔진.

## 완료: 차량 마스터 variant 점수 엔진 분리

- 새 파일: `lib/domain/vehicle-master-variant.ts` (98줄)
- `selectMasterVariant`로 연료·배기·구동·인승·터보·라벨 점수 계산을 이동했다.
- `modeSeat`, `modeSeatForModel`도 이동하고 기존 공개 경로에서 재수출한다.
- 선택 결과는 variant와 세대 내 인승 구분 여부를 반환한다.
- 트림과 confidence 판정은 본체에 유지했다.
- `vehicle-master-match.ts`: 625줄 → 574줄.
- typecheck·전체 7개 시뮬레이션·마스터 전수 검증·diff 검사 PASS.
- `/inventory` HTTP 200.
- 다음 후보: 트림 선택 및 conflict·confidence 판정.

## 전환: 구조 분리 종료, 계약 조회 보안 강화

- 차량 마스터 추가 분리는 중단하고 실제 기능·보안 완성도로 전환했다.
- 기존 `readContractsScoped`·`readCustomersScoped` 구현과 규칙을 대조했다.
- v3/v4 계약 규칙을 관리자·공급사 회사·영업자 uid/채널 쿼리로 제한했다.
- 고객은 기존 `created_by` 스코프가 어댑터와 규칙에 모두 적용되어 있었다.
- 정산 계약일자 조인은 전체 계약 읽기 대신 스코프 계약 병합 결과를 사용한다.
- 규칙 JSON 파싱·typecheck·전체 7개 시뮬레이션·diff 검사 PASS.
- 계약·채팅·정산 HTTP 200.
- 라이브 Firebase 규칙 게시는 별도 운영 작업으로 남아 있다.

## 민감 매물 필드 private 노드 기반

- 비권한 상품 객체에서 `vehicle_price`, `vin`, 기간별 `fee`·`commission`·`fee_memo`를 제거한다.
- 대여료·보증금 등 고객/영업 공개 가격은 유지한다.
- `v4/products_private/{product}` 규칙 골격을 추가했다.
- 관리자와 자기 회사 공급사만 private 레코드에 접근할 수 있다.
- 영업자 시뮬레이션에 객체 마스킹 회귀 검사를 추가해 38/38 PASS.
- 전체 자동 검증과 홈·재고·계약 HTTP 200.
- 민감 필드 추출·공개 제거·권한 병합 helper를 구현했다.
- 신규 저장·수정·일괄 패치는 public/private RTDB 경로로 원자 분기한다.
- 관리자·자기 회사 공급사만 private 원자를 다시 병합한다.
- public/private 왕복 회귀 검사를 포함해 영업자 시뮬레이션 39/39 PASS.
- 기존 public 레코드 마이그레이션과 라이브 규칙 게시는 남아 있어 운영 완료로 판정하지 않는다.

## 완료: 민감 필드 마이그레이션 도구

- `migrate-products-private.ts`: v3/v4/public/private 마이그레이션 계획 및 적용 함수.
- 기본 dry-run이며 관리자 개발도구에서만 실제 실행 확인을 제공한다.
- v3·v4 기간별 가격을 깊게 병합해 한쪽에만 있는 수수료를 보존한다.
- 기존 private 값 우선으로 재실행 안전성을 확보했다.
- private 복사 대상이 있는 상품만 public 민감 필드를 삭제한다.
- 전용 시뮬레이션 14/14 PASS, 기존 전체 검증 PASS.
- 실제 Firebase 데이터에는 실행하지 않았다.

## 완료: 공통 UI 통계·요약 분리

- 새 파일: `components/ui/metrics.tsx`
- 이동: `Card`, `Toolbar`, `Panel`, `Kpi`, `KpiRow`, `StatBar`, `Stepper`
- tone별 색 선택을 모듈 내부 헬퍼로 중복 제거했다.
- 기존 `Step` 타입과 `@/components/ui` barrel export를 유지했다.
- 수치 글꼴·tabular 숫자·상태 색·Stepper 상태 표현은 변경하지 않았다.
- typecheck·diff 검사 PASS, 홈·재고·계약·채팅·회원·설정 HTTP 200.
- 다음 후보: 선택·필터 묶음(`PillTabs`, `ToggleChips`, `FilterGroup`, `FilterChips`).

## 완료: 브라우저 기본 확인창·알림 현대화

- 공통 `confirmDialog` 적용: 계약 취소, 정책 삭제, 회원 관련 확인, 재고 상품 삭제, V3 마이그레이션
- 공통 error toast 적용: 로그인/가입 오류
- `app`·`components`·`features`의 직접 `window.confirm`·`window.alert` 호출 0건
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지

## 완료: Finder 상품 컨텍스트 액션 분리

- 새 파일: `features/finder/product-context.ts`
- 계약문의·공유·복사·상세 이동 메뉴 구성 이동
- `app/page.tsx`: 690줄 → 644줄
- 구형 prompt fallback 제거
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/` HTTP 200 유지
- 다음 후보: Finder 상단 툴바 컴포넌트

## 완료: Finder 상단 툴바 분리

- 새 파일: `features/finder/FinderToolbar.tsx` (107줄)
- 모바일·웹 검색/정렬/필터/관심/다운로드/보기 전환 이동
- `app/page.tsx`: 644줄 → 563줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/` HTTP 200 유지
- 다음 후보: Finder 결과 본문 렌더링

## 완료: Finder 결과 본문 분리

- 새 파일: `features/finder/FinderResults.tsx` (98줄)
- 빈 상태·카드·상세·엑셀·페이징 UI 이동
- `app/page.tsx`: 563줄 → 511줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/` HTTP 200 유지
- Finder 본체는 상태 조정·필터 드래프트·화면 조합 중심으로 축소

## 완료: 채팅 방 색인·표시 계산 분리

- 새 파일: `features/chat/room-display.ts`
- 계약·상품·삭제상품 색인과 방 제목·공급사 표시 이동
- `app/chat/page.tsx`: 435줄 → 372줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/chat` HTTP 200 유지

## 완료: 계약 목록 필터·정렬 분리

- 새 파일: `features/contract/contract-filter.ts`
- 계약 상태·월 필터, 정렬, 월 옵션 이동
- `app/contract/page.tsx`: 393줄 → 355줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/contract` HTTP 200 유지
- 다음 후보: 계약 정산 요약 계산 또는 회원 페이지

## 완료: 회원 관리 필터·정렬 분리

- 새 파일: `features/members/member-filter.ts`
- 사용자·파트너 필터 옵션, 필터, 정렬, 승인대기 집계 이동
- `app/members/page.tsx`: 409줄 → 368줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/members` HTTP 200 유지

## 완료: 설정·회원·계약·채팅 UI/UX 통합 배치

- `ProductPreferences`, `MembersList`, `SettlementSummary`, `ChatRoomList` 추가
- 네 페이지의 중복 목록·빈 상태·요약 표현을 feature 컴포넌트로 이동
- 설정 302줄, 회원 353줄, 계약 337줄, 채팅 337줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 네 페이지 HTTP 200, 개발 서버 유지
- 다음 큰 작업은 Firebase RTDB 어댑터 데이터 계층 정리

## 완료: Firebase RTDB 데이터 계층 정리

- `rtdb-records.ts`: 첨부 정규화·v3→v4 변환
- `rtdb-products.ts`: 상품 제외·원가 마스킹·실차 중복 제거
- `rtdb-adapter.ts`: 537줄 → 406줄
- 공개 API와 v3 read/v4 overlay write 정책 유지
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 주요 화면 6개 HTTP 200
- 남은 `any`는 Firebase snapshot 동적 경계 9건
- 다음 후보: 채팅 목록 필터·정렬 계산

## 완료: 채팅 목록 필터·정렬 분리

- 새 파일: `features/chat/room-filter.ts`
- 역할별 필터·정렬·드래프트 미리보기 집계 이동
- `app/chat/page.tsx`: 372줄 → 347줄
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/chat` HTTP 200 유지

## 완료: 정확 경로·운영 감사/일괄 변환 분리

- `lib/domain/vehicle-master-exact.ts`: 정확 경로 순수 엔진
- `lib/domain/vehicle-master-operations.ts`: 경로 감사·reconcile·전수 audit 엔진
- 콜백 주입으로 순환 의존성 방지
- 기존 공개 API 유지
- `vehicle-master-match.ts`: 915줄 → 805줄
- typecheck·전체 시뮬레이션·마스터 전수 검증·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지
- production build는 실행 중인 서버 보호를 위해 보류

## 완료: 공통 UI 오버레이 1차 분리

- 새 파일: `components/ui/overlays.tsx` (87줄)
- `Drawer`, `Modal` 이동
- `components/ui/index.tsx`: 782줄 → 731줄
- 기존 barrel export와 컴포넌트 API 유지
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지
- 다음 후보: `ListRow`·`ListBox`, 폼 입력 컴포넌트 묶음

## 완료: 공통 UI 리스트 2차 분리

- 새 파일: `components/ui/list.tsx` (45줄)
- `ListRow`, `ListBox` 이동
- `components/ui/index.tsx`: 731줄 → 706줄
- 기존 barrel export와 props·스타일 유지
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지
- 다음 후보: `Select`, `Input`, `Textarea`, `SearchInput`

## 완료: 공통 UI 폼 입력 3차 분리

- 새 파일: `components/ui/form-controls.tsx` (114줄)
- `Select`, `Input`, `Textarea`, `SearchInput` 이동
- `components/ui/index.tsx`: 706줄 → 633줄
- 기존 barrel export, props, 모바일·키보드 동작 유지
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지
- 다음 후보: `Btn`, `IconBtn`, `IconSeg`

## 완료: 공통 UI 버튼 4차 분리

- 새 파일: `components/ui/buttons.tsx` (111줄)
- `Btn`, `IconBtn`, `IconSeg` 이동
- `components/ui/index.tsx`: 633줄 → 554줄
- 기존 barrel export, props, 모바일·접근성 동작 유지
- leaf 모듈 직접 import로 순환 의존성 방지
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지
- 다음 후보: 공통 레이아웃 원자 묶음

## 완료: 공통 UI 레이아웃 5차 분리

- 새 파일: `components/ui/layout.tsx` (93줄)
- `PaneHead`, `PaneBody`, `CardGrid`, `VSplit` 이동
- `components/ui/index.tsx`: 554줄 → 494줄
- 기존 barrel export, props, 모바일·드래그 동작 유지
- typecheck·전체 시뮬레이션·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지
- 공통 UI 본체 500줄 미만 달성
- 다음 큰 작업: `vehicle-master-match.ts`의 타입·표시 유틸 경계부터 분리

## 완료: 차량 마스터 매칭 1차 분리 (타입)

- 새 파일: `lib/domain/vehicle-master-types.ts` (61줄)
- 순수 타입 7종 이동
- 기존 `vehicle-master-match.ts` type export 호환 유지
- 매칭 알고리즘 변경 없음
- typecheck·전체 시뮬레이션·마스터 전수 검증·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지
- 다음 후보: 연식·연료·제조사 표시/정규화 유틸

## 완료: 차량 마스터 매칭 2차 분리 (표시·정규화)

- 새 파일: `lib/domain/vehicle-master-format.ts` (66줄)
- 연식·연료·제조사 표시/정규화 함수 6종과 연료 별칭 이동
- `vehicle-master-match.ts`: 1,068줄 → 1,040줄
- 기존 공개 export 호환 유지
- typecheck·전체 시뮬레이션·마스터 전수 검증·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지
- 다음 후보: 스냅 추적·원본·이력 묶음

## 완료: 차량 마스터 매칭 3차 분리 (스냅 추적)

- 새 파일: `lib/domain/vehicle-master-snapshot.ts` (91줄)
- 추적 필드·라벨, 원본 캡처, diff, 이력 생성 이동
- `vehicle-master-match.ts`: 1,040줄 → 1,001줄
- `applySnap` 정책과 기존 공개 export 호환 유지
- typecheck·전체 시뮬레이션·마스터 전수 검증·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지
- 다음 후보: 차량 필터·마스터 목록 탐색 묶음

## 완료: 차량 마스터 매칭 4차 분리 (필터·탐색)

- 새 파일: `lib/domain/vehicle-master-filter.ts` (65줄)
- 5단 필터와 제조사·모델·세부모델 목록 탐색 이동
- `vehicle-master-match.ts`: 1,001줄 → 976줄
- 기존 공개 export와 표기·정렬 규칙 유지
- typecheck·전체 시뮬레이션·마스터 전수 검증·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지
- 다음 후보: 마스터 경로 감사·일괄 reconcile 경계

## 완료: 차량 마스터 매칭 5~6차 분리

- `lib/domain/vehicle-master-signals.ts` (48줄): 신호 키·수집·원본 복원
- `lib/domain/vehicle-master-options.ts`: 파워트레인·인승·실트림 선택 보조
- `vehicle-master-match.ts`: 976줄 → 915줄
- 기존 공개 export와 매칭 결과 유지
- typecheck·전체 시뮬레이션·마스터 전수 검증·diff 검사 PASS
- 개발 서버 `/inventory` HTTP 200 유지

## 완료: Product card atoms 3차 분리 (기간별 요금)

- 새 파일: `components/product-card-fares.tsx` (92줄)
- `PriceMini`, `PriceFare` 이동
- `components/product-card-atoms.tsx`: 929줄 → 843줄
- typecheck와 전체 시뮬레이션: PASS
- 개발 서버 `/inventory`: HTTP 200 유지
- production build는 서버 유지 요청으로 보류

## 실행 서버 규칙

- 개발 서버가 켜져 있는 동안 `npm.cmd run build`를 실행하지 않는다.
- `.next` 공유로 개발 서버가 500 상태가 될 수 있기 때문이다.
- 작업 중 검증은 typecheck, 시뮬레이션, HTTP 200 스모크로 수행한다.
- 최종 production build는 서버 중단을 허용받은 시점에 별도로 수행한다.

## 완료: Product card atoms 4차 분리 (차량 신원·제원)

- 새 파일: `components/product-card-identity.ts` (77줄)
- 제목·모바일 제목·상세 제원·카드 제원 문자열 이동
- `components/product-card-atoms.tsx`: 843줄 → 789줄
- typecheck와 전체 시뮬레이션: PASS
- 개발 서버 `/inventory`: HTTP 200 유지

## 완료: Product card atoms 5차 분리 (신원 UI)

- 새 파일: `components/product-card-identity-view.tsx` (31줄)
- 차량번호와 말줄임 제목 UI 이동
- 순수 문자열 계산과 UI 표현 경계 분리
- `components/product-card-atoms.tsx`: 789줄 → 764줄
- typecheck와 전체 시뮬레이션: PASS
- 개발 서버 `/inventory`: HTTP 200 유지

## 완료: Product card atoms 6차 분리 (뱃지 UI)

- 새 파일: `components/product-card-badge-view.tsx`
- `CardKind`, `CardRailBadges` 이동
- `components/product-card-atoms.tsx`: 764줄 → 725줄
- typecheck·전체 시뮬레이션 PASS
- 개발 서버 `/inventory`: HTTP 200 유지

## 완료: 클립보드 호환 처리 1차 통합

- 새 파일: `lib/clipboard.ts`
- 공통 `copyText`에 최신 API와 구형 fallback 집중
- `CopyBlock`, 계약서 링크, 재고 TSV 적용
- Cursor 작업 중인 product card 가격 파일과 충돌 없음
- typecheck·전체 시뮬레이션 PASS, 서버 HTTP 200

### 2차 적용 완료

- Finder, 상품 상세, 카드 더보기, 설정 공유 링크까지 공통화
- 직접 Clipboard API 호출은 `lib/clipboard.ts`에만 존재
- typecheck·전체 시뮬레이션 PASS, 서버 HTTP 200

## 완료: Product card 가격·혜택 원자 분리

- `components/product-card-pricing.tsx` (319줄)
- `components/product-card-perks.tsx` (158줄)
- `components/product-card-atoms.tsx`: 725줄 → 271줄
- pricing → perks → badges 단방향 의존성
- 기존 barrel export 호환 유지
- Cursor 결과 독립 검증 및 BOM 수정 완료
- typecheck·전체 시뮬레이션 PASS, 서버 HTTP 200

## 완료: Product card atoms 2차 분리 (뱃지)

- 새 파일: `components/product-card-badges.tsx` (124줄)
- 상태·상품구분·심사 뱃지와 tooltip·축약 표시 이동
- 내부 import와 기존 공개 경로 재수출을 분리해 순환 의존성 방지
- `components/product-card-atoms.tsx`: 1,037줄 → 929줄
- typecheck, build, 전체 시뮬레이션: PASS

## 완료: 전자서명 공개 링크 생명주기

- 공개 링크 기본 유효기간 7일, 규칙상 최대 30일 제한
- 링크 폐기와 만료 후 새 토큰 재발급 지원
- 계약 화면에 만료 안내·재발송·폐기·재발급 동작 추가
- 익명 읽기·서명 쓰기를 유효한 발송 링크로 제한
- 레거시 링크는 호환 읽기를 유지하고 인증 쓰기 때 만료 정보 보강
- 전자서명 규칙 시뮬레이션 23/23, 영업 권한 시뮬레이션 39/39 PASS
- Firebase Rules 실제 게시와 역할별 운영 스모크는 미수행

## 완료: 전자서명 토큰·조회 경계 강화

- Web Crypto 기반 192비트 토큰으로 추측 저항성 강화
- 폐기 상태와 폐기 시각을 모두 비활성 신호로 처리
- 공개 조회·로컬 fallback에 만료/폐기 재검사 적용
- 토큰 형식·고유성 회귀 검사를 포함해 전자서명 시뮬레이션 26/26 PASS

## 완료: 전자서명 승인 상태기계 잠금

- 도메인 승인 전제조건: 검토대기 + PNG 서명 + 필수 동의
- v4 계약 승인 전제조건: 동일 계약 공개 슬롯의 pending_review + 서명 + 동의
- 영업 측 약정발송 전제조건: 공개 슬롯 signed
- 직접 데이터 수정에 의한 제출 전 승인 우회 방지
- 전자서명 시뮬레이션 33/33, 영업자 시뮬레이션 39/39 PASS

## 완료: 전자서명 동의 증적 버전 고정

- 필수 동의 5개를 안정적인 ID와 고정 순서로 정규화
- `sign_consent_version = v1` 저장
- 도메인 제출과 RTDB 익명 쓰기에서 누락·변조 동의 거부
- 기존 한글 동의 문자열의 승인 호환 유지
- 전자서명 시뮬레이션 37/37, 영업자 시뮬레이션 39/39 PASS

## 완료: 전자서명 공개 제출 데이터 검증

- 성명·연락처·PNG 서명·크기 상한 도메인 검증
- RTDB 익명 서명을 PNG data URL로 제한
- 익명 제출 시각을 서버 기준 최근 5분 범위로 제한
- SVG·임의 문자열·과거 시각 증적 주입 방지
- 전자서명 시뮬레이션 43/43, 영업자 시뮬레이션 39/39 PASS

## 완료: 전자서명 증적 확정과 공개 슬롯 최소화

- 공개 제출의 전체 증적을 관리자 검토 객체에 병합
- 승인 시 계약 원본에 서명·동의·본인확인 증적 보존
- 승인 완료 후 공개 슬롯의 제출 개인정보·서명 삭제
- 공개 슬롯 정리 실패 시 후속 약정발송 진행 차단
- 전자서명 시뮬레이션 49/49, 영업자 시뮬레이션 39/39 PASS

## 완료: 전자서명 승인 복구 경로

- 서명완료 후 약정발송만 실패한 중간 상태 감지
- 계약 패널에 `약정 단계 복구` 동작 제공
- 증적 덮어쓰기 없이 공개 슬롯 확정·약정 단계 멱등 재시도
- 증적 누락·이미 완료 상태의 잘못된 복구 차단
- 전자서명 시뮬레이션 52/52, 영업자 시뮬레이션 39/39 PASS

## 완료: 전자서명 해지 보안 우선 순서

- 공개 서명 슬롯을 먼저 폐기하고 계약 원본을 후속 동기화
- 공개 폐기 실패 시 내부 상태 보존으로 재시도 가능
- 내부 동기화 실패 시에도 외부 링크 차단 유지
- 전자서명 시뮬레이션 55/55, 영업자 시뮬레이션 39/39 PASS

## 완료: 전자서명 공개 개인정보 최소화

- 신규 공개 슬롯에서 계약 고객 이름·전화번호 사전 복사 제거
- 반려 재개방 시 이전 제출 개인정보·서명·동의 삭제
- 계약 원본 내부 정보와 관리자 검토 흐름 유지
- 전자서명 시뮬레이션 57/57, 영업자 시뮬레이션 39/39 PASS

## 완료: 회원·파트너 목록 규격 통일

- 재고·문의·계약과 같은 아이콘 + 3줄 피드 행 적용
- 목록 첫 행 신규 등록, 검색 결과 조건 해제, 100명 단위 더보기 적용
- 사용자 역할·승인·활성·소속, 파트너 유형·수수료·코드·연락처 정보 밀도 통일
- V3/V4 파트너 유형 표기·필터 정규화
- 관리자 실데이터 사용자 151명·파트너 38명 브라우저 검증, typecheck PASS

## 완료: 회원·파트너 / 월별 정산 4프레임 통일

- 공통 기준: `목록 1 + 업무 패널 3 = 4프레임`
- `WorkPage.listHeader`를 추가해 사용자·파트너 전환과 월 선택을 목록 조건보다 위에 배치
- 회원 사용자: 기본정보 / 소속·권한 / 영업설정
- 회원 파트너: 기본정보 / 정산·운영 / 데이터연동
- 월별 정산: 월 필터 정산 목록 / 정산 상세 / 금액·지급 / 월 집계
- 월 집계는 선택 월 전체 기준, 검색·상태 필터는 목록에만 적용
- 공급사별·영업채널별 집계와 XLSX 가져오기·정산서 다운로드 유지
- VAT 정산서는 기존 편집 밀도를 보존하기 위해 전체 오버레이로 연결
- Chrome 실데이터 사용자 151명·파트너 38명·정산 1건 선택 및 VAT 진입/복귀 PASS
- typecheck·폰트·전체 12개 시뮬레이션·28개 라우트 production build PASS

## 완료: 4역할 실계정 격리·채팅 갱신 안정화

- 영업채널 관리자·직원, 공급사 관리자·직원 전용 QA 계정의 실제 로그인 검증
- 영업 개인/채널/공급사 범위와 타 조직 계약·채팅·재고 차단 확인
- 운영 RTDB 정산 private 허용/차단 쿼리 매트릭스 확인
- 채팅 초기 빈 안내 오표시 제거 및 명시적 로딩 상태 추가
- 방별 메시지 캐시를 in-flight dedupe로 제한하고 5초·포커스·이벤트 새로고침 추가
- 열린 영업자 대화에 공급사 신규 메시지가 무새로고침 반영되는지 실검증
- 감사로그 경로를 운영 Rules와 일치하는 루트 `audit_logs`로 복구
- 설정 로그인명 hydration mismatch 수정
- 실제 R1/R2 화면 검증은 QA 계약 완료·정산 생성 후 진행

## 완료: 계약 규격 외 요약 제거 및 모바일 아이콘 통일

- 계약 툴바 아래 임의 정산 요약(`대기·완료·환수·순수익`)과
  `features/contract/SettlementSummary.tsx` 제거
- 계약 화면을 `목록 1 + 업무 패널 3` 규격으로 복구
- 모바일 공통 뒤로가기·검색 초기화·패널 전환·CRUD·채팅 전송을 아이콘 버튼으로 통일
- 접근성 이름을 유지하고, 승인·상태 변경·내비게이션·카테고리 선택은 텍스트 라벨 보존
- Phase 12에 계약 요약 재삽입 및 모바일 공통 버튼 회귀 검사 추가
- 아이콘 전용 분기는 모바일에만 적용하고 데스크톱 텍스트 버튼은 보존
- typecheck·폰트 검사·전체 12개 시뮬레이션·28개 라우트 production build PASS
