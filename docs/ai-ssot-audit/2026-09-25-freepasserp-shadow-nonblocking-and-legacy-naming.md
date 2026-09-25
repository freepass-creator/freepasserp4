# FreePassERP.com hourly audit — 2026-09-25

상태: **FIX PREPARED / CUTOVER HOLD**

## 이번 점검 범위

공통 White Label 본체만 점검했다. F01/F86 등 개별 채널 운영·노출·동기화는 범위에서 제외했다.

## 발견 1 — FreePass Data shadow가 손님 응답을 늦출 수 있음

현재 공개 카탈로그의 customer-visible source는 ERP5이고, FreePass Data Catalog V1은 shadow parity 관측만 수행한다.

기존 구현은 `loadGuestListing()`에서 `await observeFreepassDataShadow(products)`를 호출했다. shadow endpoint가 느리거나 timeout에 가까워지면 값은 바뀌지 않아도 고객 응답 지연이 생길 수 있었다.

### 조치

- Next.js `after()`로 FreePass Data shadow 관측을 응답 완료 뒤 실행하도록 변경.
- `check:erp4-main`에 회귀검사를 추가해 `await observeFreepassDataShadow(...)`가 customer path에 다시 들어오면 실패하도록 잠금.
- 데이터 authority는 변경하지 않음.
- RTDB fallback을 추가하지 않음.

## 발견 2 — FreePassERP.com 명칭 전환은 아직 부분적

현행 코드/정본 문서/CI 잠금에 `ERP4 MAIN`이라는 현재형 명칭이 다수 남아 있다. 이는 제품의 새 정의인 **FreePassERP.com 공통 White Label 프론트엔드**와 어긋나는 Legacy naming residue다.

이번 수정에서는 런타임 진입점 주석부터 `FreePassERP.com`으로 바로잡았다. 다만 정본 문서 파일명·검사명은 다른 CI/문서 참조와 얽혀 있으므로 한 번에 무리하게 rename하지 않고, 후속 라운드에서 **현재형 표기만 FreePassERP.com으로 교체하고 역사 문맥의 ERP4는 보존**하는 방식으로 정리한다.

## 현재 데이터 경계

- ACTIVE customer read: ERP5 canonical catalog
- TARGET consumer: FreePass Data `erp-public` projection
- FreePass Data 상태: SHADOW_READ
- cutover 조건: 계약에 정의된 parity 검증 완료 후 별도 전환
- fallback: NONE
- RTDB: 신규 사용 금지

사용자 지시대로 FreePassERP.com은 장기적으로 프리패스 데이터를 소비하는 얇은 구현체가 되어야 한다. 현재는 그 전환 전 shadow 단계이므로, parity evidence 없이 source를 강제로 바꾸지 않는다.

## 다음 점검

1. FreePass Data parity dimensions를 기계검사 가능한 consumer contract로 좁힌다.
2. FreePassERP.com 현재형 문서·로그·검사 메시지에서 ERP4 명칭을 단계적으로 걷어낸다.
3. 공통 White Label 화면에서 Firestore 내부 필드 직접 의존이 남아 있는지 adapter 경계를 전수검사한다.
4. UI 규격은 기존 검증된 Product Browse IA를 유지하면서 모바일/웹의 실제 drift만 수정한다.
