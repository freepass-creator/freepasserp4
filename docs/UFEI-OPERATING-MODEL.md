# FreePassERP.com v1 — U/F/E/I Operating Model

## 목적

FreePassERP.com v1의 남은 고도화를 네 개의 고정 작업선으로 병렬화하되, 정본은 항상 `main` 하나로 유지한다.
이 저장소의 제품 범위는 **White Label 공개 상품 조회/검색 + FreePass Data consumer**다.

## 고정 브랜치

| Lane | Branch | 책임 |
|---|---|---|
| U-01 | `work/freepass/u-01-ui-ux` | 공개 상품 목록/상세, 검색·필터 UX, 반응형, 디자인 토큰, 접근성, actual-route Visual QA |
| F-01 | `work/freepass/f-01-function` | 검색/필터 동작, URL/route 규칙, 상태 유지, 채널 허용 기능, 오류·빈화면·fallback 기능 규칙 |
| E-01 | `work/freepass/e-01-engine` | White Label 내부의 순수 파생/정규화/표시 엔진, deterministic 변환, 검색·필터 derivation, 회귀 테스트 |
| I-01 | `work/freepass/i-01-integration` | FreePass Data consumer 경계, API/cache/freshness, Firestore adapter, auth/deploy 연결, legacy bridge 종료 준비 |

## 정본과 금지선

- `main`만 배포/운영 정본이다.
- U/F/E/I는 작업선이며 운영 데이터를 직접 쓰지 않는다.
- 외부 쓰기·production sync·F01/F86 발행은 **main에서만** 허용한다.
- FreePass Data가 상품·차량·가격·ID의 권위다. 이 저장소에 두 번째 master/ID/가격 정본을 만들지 않는다.
- RTDB 신규 사용·재활성화 금지.
- F01/F86 판매시트 개별 기능, 견적기, 내부 ERP 로그인/업무화면, 접수/정산, 차종마스터/원천수집은 신규 개발 범위가 아니다.
- 채널별 별도 화면을 만들지 않는다. 차이는 `lib/whitelabel.ts` 허용 필드로만 표현한다.

## 충돌 방지

1. 같은 파일을 두 lane이 동시에 고치지 않는다.
2. 공용 경계 파일은 I-01 우선, 공용 UI primitive/token은 U-01 우선이다.
3. 기능 규칙은 F-01, 순수 파생 알고리즘은 E-01이 owner다.
4. ownership이 겹치면 구현 전에 main의 이 문서를 갱신하거나 한 lane으로 넘긴다.
5. 각 lane은 PR을 main으로 올리고 CI/Canon Guard가 초록인 것만 병합한다.
6. 병합 직후 해당 lane은 최신 main으로 다시 맞춘 뒤 다음 작업을 시작한다.
7. 임시 5번째 개발 브랜치, v2 대체선, duplicate engine/adapter는 만들지 않는다.

## 병합 순서

기본 순서는 **I → E → F → U**다.
단, 서로 독립된 변경은 순서를 강제하지 않는다. 공용 계약 변경이 있으면 I가 먼저 병합되고 나머지가 최신 main을 받아 이어간다.

## 완료 정의

- typecheck / CI / Canon Guard 통과
- 운영 쓰기 없음(U/F/E/I branch)
- FreePass Data consumer 경계 유지
- White Label actual route에서 기능/디자인 회귀 없음
- 병합 후 main이 유일한 정본
