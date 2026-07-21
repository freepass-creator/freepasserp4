# v3→v4 함정 이식 백로그 (parity backlog)

v3(freepasserp3)에서 전투로 검증해 잡은 함정 중 v4 재건축에서 **유실/회귀**된 것. 대부분 **실 공급사 시트 임포트·차종매칭·드라이브 사진** 레인이라 seed 프리뷰엔 안 보이나 실데이터 붙는 순간 터짐. (감사: 50개 채굴 / 정상 15 / 문제 34)

범례: 🔴 high · 🟡 med · ✅ 고침 · ⚠️ 오탐

---

## ✅ 완료 (v3 원본 대조·이식, tsc 0)
- **드라이브 사진 동시성 큐(MAX 6)** — 429 붕괴 방지. `product-photos.ts` _run 큐.
- **종합표 TSV 셀 정화(탭·개행→공백)** — `jonghap.ts` buildJonghapTsv clean.
- **대여료 이상치 3중 방어(하한10만·상한2천만·역전5%)** — `product.ts` priceList read-time.
- **오토플러스 보증금 배율(수입3·국산2)** — `sheet-import.ts` parsePriceColumns + isImportBrand. 기간 컬럼 감지 + 보증금 컬럼 or 배율 파생.
- **번호없는 신차 구제(100신XXXX 멱등 임시번호+신차렌트)** — `sheet-import.ts`. skip→임시번호(공급사+신원 해시).
- **EV 무음 오스냅 방지(가솔린 G80→일렉트리파이드 차단)** — `vehicle-master-match.ts` isEvOnly 강배제(-6) + evHint.
- **계약완료 중복완료 가드** — `settlement-engine.ts` applyStepCheck: 같은 차량 이미 완료 계약 있으면 쓰기 전 throw(이중판매 차단) + ContractPanel setCheck catch·toast.
- **트림 하이브리드→가솔린 회귀픽스** — `vehicle-master-match.ts` variant 선택 시 연료 명확히 다르면 -3(배기량 우연일치 무력화).

## ⚠️ 오탐(무시)
- **종합표 6개월 컬럼 삭제** — 사장님 "시트 1/12/24/36/48/60 재구축" 결정으로 의도적. 회귀 아님.

---

## ① 돈 필드 (최우선)
- 🔴 **오토플러스 보증금 배율(수입3·국산2)** — v4 `sheet-import.ts`가 가격 컬럼 자체를 안 매핑 → 대여료·보증금 통째 빔. v3 parseAutoplusRow(depMult=수입3/국산2, 기간_주행 복합키) + IMPORT_BRAND_KEYWORDS 이식 필요. 배율·브랜드목록은 lib/domain 정책상수 SSOT로.
- 🔴 **대여료 이상치 3중 방어** — 상한(>2천만)·하한(<10만)·단기<장기 역전 제거. v4 normalizeWonPair는 단위정규화만, 이상치 없음.
- 🔴 **시트 보증금 모델** — 단기/장기 그룹 확산 + 배수.
- 🟡 **복합 가격키 '표준키 우선→변형 최저 접기'** — '24_3만'(기간×주행) 변형키 처리. (v4 priceList는 이미 일부 접음 — 검증 필요)

## ② 차종 무음 오스냅 (매칭)
- 🔴 **연료 미상+EV힌트 없음 → EV전용 세대 배제** — 가솔린 G80→일렉트리파이드 G80 'high' 자동 덮어쓰기. `vehicle-master-match.ts` isEvOnly/rawEvHint 이식.
- 🔴 **트림 매칭 회귀픽스(하이브리드→가솔린 방지)** — fuel/가격 가중, 조기 skip 금지.
- 🟡 **쿠페/카브리올레 배리언트 패널티(-40)** — GV80→GV80쿠페 오매칭 차단.
- 🟡 **모델명→제조사 4자 게이트**(짧은코드 충돌), **제조사 오입력 교정**(모델→제조사 override).
- 🟡 **연식→세대 매칭**(등록일 우선·YYYY-MM·범위밖 -50), **세대코드 매칭**(영문=경계/숫자=substring).
- 🟡 **트림 정제 파이프라인**(파워트레인 분리·괄호/섀시코드/MY/노이즈 제거, 1,775건 학습), **엔카 title→sub_model 변환**.
- 🟡 **연료 분리 매칭 + 전멸 안전망 + alias fall-through**.

## ③ 인제스천 무결성
- 🔴 **번호없는 신차 skip → 신차 통째 누락 재발** — 100신XXXX 임시번호·is_pending_plate 미이식. `sheet-import.ts:111` skip 제거+구제.
- 🔴 **계약완료 원자 멀티패스** — 계약+차량+정산 순차 write, 동일차량 중복완료 가드 부재.
- 🟡 **재동기화 수기보정 보존 / 사진·필드 blank-overwrite 금지**.
- 🟡 **차량상태 정규화**(prefix 우선·숨김행/탭 출고불가·상태컬럼 별칭), **상품구분 3분류 캐논화**(재구독 masking 순서).
- 🟡 **자동 동기화 반영**(수기보존·소프트드롭·스키마격리), **공급사 식별**(공급코드 우선·차고지 역토큰).
- 🟡 **CSV 따옴표 내 개행/콤마 상태머신 파서**, **Sheets values/grid 2호출 quirk·스마트칩 URL**.
- 🟡 **정책 enrich**(stale _policy 능동제거·O(N)인덱스·보험 3단 fallback), **연식 2자리 피벗 단일화**.

## ④ 정규화·SSOT·기타
- 🟡 **옵션 파싱**(브래킷 보호·구분자·공백 무분할·긴키우선).
- 🟡 **심사기준 정규화**(2분류·무관우선·정책우선), **needsReview 판정 통합**.
- 🟡 **무보증 = 명시 deposit_free 플래그**(가격0 추론 폐기 — v4는 every 게이트로 부분 방어 중, 명시 플래그 우선 검증).
- 🟡 **정산 멱등키 ST_{code} + 조건부 트랜잭션**(수수료 이중지급), **정산상태 SSOT 상수 비교**(환수 0원 재발).
- 🟡 **취소 환수 동기 액션 이관**(과거 환수 100% 누락 회귀 — v4 cancelContract로 일부 대응, 검증).
- 🟡 **roleLabel/역할 스코프 단일소스**(members 로컬 중복 — 규격통일서 식별), **금액 *_snapshot canonical**.
- 🟡 **사진**: /api/img 프록시(CORS·핫링크·octet-stream), 이미지 dedup 호스트분기, 스크래핑 필터(로고제외·http→https), 드라이브 HTML 2단 fallback.
- 🟡 **엑셀 내보내기 고정틀·네이티브필터·9pt·하이퍼링크**.
- 🟡 **auto-status 데드코드 함정**(상태 단일writer=액션핸들러지 반응형와처 아님).
