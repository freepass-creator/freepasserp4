# FreePassERP.com v1 · Stability Lock

최종: 2026-09-26  
상태: **CURRENT / 안정화 규격 잠금**

## 목적

FreePassERP.com v1은 더 이상 구조를 탐색하는 단계가 아니다.  
**현재 제품 정의를 기준선으로 고정하고, 이후 변경은 오류 수정·정합성·성능·접근성 개선만 허용한다.**

정본 UI/제품 정의는 `docs/ERP4-MAIN-UI-STANDARD.md`이며, **현재 쓰는 면/안 쓰는 면은 `docs/ERP4-MAIN-SURFACE-LOCK.md`**가 잠근다. 이 문서는 그 정본에서 **바뀌면 안 되는 경계**를 요약한다.

## 잠금 항목

### LOCK-01 · 제품/인증 분리

- `freepasserp.com` FreePassERP.com v1 = 공개 Product Browse.
- 로그인·회원가입·세션은 FreePassERP.com v1 기능이 아니다.
- 공개 상품 요청은 `AuthProvider`를 마운트하지 않는다.
- 대표 ERP 도메인(`freepasserp.com`·`www`)의 `/login`과 은퇴한 업무 진입점은 canonical 공개 상품 홈으로 정리한다. 공개 상품·공유·전자계약 URL은 보존한다.
- 로그인 구현을 저장소에 남기는 것은 허용하지만 별도/레거시 업무 인증 기능으로만 취급한다.

### LOCK-02 · FreePass Catalog 공개 데이터 경계

- 공개 목록·상세·갱신시각은 모두 `lib/server/freepass-catalog.ts`의 **FreePass Catalog Consumer Boundary**를 통과한다.
- 현재 구현은 검증된 ERP5 reader에 위임하지만, FreePass Data parity/cutover 시 저장소 세대 변경은 이 경계 한 곳에서만 수행한다.
- 공개 화면은 레거시 RTDB/store 또는 별도 ERP4 상태기록으로 fallback하지 않는다.
- 목록은 guest sanitize를 거치고, 상세용 다중 사진 등 불필요한 필드는 list slim 단계에서 제거한다.
- FreePass Data shadow 관측은 고객 응답 critical path를 막지 않는다.
- 웹·모바일은 같은 상품 원장과 같은 query domain을 사용한다.

### LOCK-03 · 디자인 규격

현재 핵심 토큰:

| 항목 | 웹 | 모바일 |
|---|---:|---:|
| 상단바 높이 | 56 | 48 |
| 상단 제목 | 18 | 18 |
| 동반표기 | 12 | 12 |
| 기본 컨트롤 | 44 | 44 |
| 빠른조건 칩 | 26 | 32 |
| 아이콘 버튼 | 36 | 40 |

- radius: 표시 8 / 컨트롤 10 / 카드 12.
- spacing: 4 / 8 / 12 / 16 / 24 / 32 / 48.
- 목록→상세 상단 제목은 같은 크기·굵기·자간·줄높이를 사용한다.
- 상단바 아래 구분선은 두지 않는다.
- 웹 필터 기둥은 260px.
- 목록 카드 사진은 16:10, 상세 사진은 4:3 규칙을 유지한다.
- 한 화면에서 새 임의 px·색·radius를 만들지 않는다.

### LOCK-04 · 검색/필터/정렬 + 가격행 정합성

- 검색·필터·정렬 상태는 URL과 동기화한다.
- 기본 정렬은 `popular`.
- 같은 축 안은 OR, 축끼리는 AND.
- **계약기간·월 대여료·보증금은 같은 `price[term]` 행에서 동시에 판정한다.**
- 필터·facet 숫자·정렬·카드 대표가격이 모두 같은 가격행 후보를 사용한다.
- 목록이 `liveQuery`로 계산되면 카드 가격도 `liveQuery.sel`을 사용한다.
- 필터 숫자와 실제 목록은 같은 query engine을 사용한다.
- 웹/모바일이 별도 필터 로직을 만들지 않는다.
- 빠른조건 구성은 `lib/whitelabel.ts` 한 곳에서 정하고, Firestore `shop_quick` 같은 runtime override를 활성 UI 정본으로 사용하지 않는다.
- 세부 정본: `docs/ERP4-PRICE-ROW-CONTRACT.md`.

### LOCK-05 · 성능 기준

- 첫 화면은 서버에서 6개 카드를 먼저 제공해 사진 요청을 즉시 시작한다.
- 목록 API는 상세 갤러리용 전체 사진 배열을 싣지 않는다.
- 목록 query는 줄마다 비싼 값을 반복 계산하지 않는다.
- 사진/필터/정렬 성능 기준은 기존 `check:speed`를 함께 따른다.

## 변경 허용

다음은 구조를 바꾸지 않는 범위에서 계속 개선한다.

- 실제 오류 수정
- 잘못된 상품/가격/보증금 정합성 수정
- 성능 개선
- 접근성 개선
- 모바일 safe-area/키보드/스크롤 오류
- 이미지 로딩 및 실패 처리
- 빈 결과/오류/로딩 상태
- 현재 토큰 체계 안에서의 밀도 미세조정

## 변경 금지

사용자 승인 없이 다음을 하지 않는다.

- 로그인/업무 ERP를 FreePassERP.com v1에 다시 연결
- 공개 데이터 경계를 우회해 ERP5/RTDB/별도 상태 원장을 화면에서 직접 읽기
- 목록과 상세를 서로 다른 디자인 체계로 분리
- 웹/모바일에 별도 비즈니스 로직 생성
- 필터·가격·보증금을 서로 다른 기간 행에서 조합
- UI 토큰을 우회하는 임의 수치 추가
- 기존 Product Browse IA를 새 대시보드/업무 홈으로 변경

## 기계 잠금

`npm run check:erp4-main`

이 검사는 CI 필수 게이트다. 세부 검사는 기존 아래 게이트가 함께 맡는다.

- `check:design`
- `check:deposit`
- `check:speed`
- `check:guest`
- `check:shop-data-parity`
- `check:tokens`
- `check:ui`

## 현재 잠긴 항목

- 인증 완전 분리: main에 반영 완료.
- 기간·월대여료·보증금 동일 가격행 판정: 코드 + 회귀검사로 잠금.
- 실제 운영 데스크톱/모바일 화면 캡처 기반 시각 감사는 별도 검증 항목으로 유지한다.

이후 작업은 **제품 구조 변경이 아니라 현재 구조의 안정화 작업**으로 취급한다.
