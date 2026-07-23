# 야간 자율작업 결과 (Cursor)

> 브랜치 `fix/rls-tenant-scoping`. **main 머지/push/규칙 게시 없음.** typecheck 통과 기준.

## Tier 1 — 성능

### [DONE] P1 · excelMonths/excelRows 조건부
- **커밋:** `f02f087`
- **변경:** `app/page.tsx` — `effView==='excel'`일 때만 `excelMonths`/`excelRows` 계산, 아니면 `[]`
- **동작보존:** 엑셀 뷰 진입 시 동일 계산; 카드/리스트는 엑셀 전용값을 쓰지 않음(빈배열 안전)
- **불확실:** 없음

### [DONE] P2 · presentFilterOptions 단일패스
- **커밋:** `f045bb8`
- **변경:** `lib/domain/product-filters.ts` — listed 1회 순회, priceList 매물당 1회, 밴드/enum/혜택 동시 누적
- **동작보존:** 밴드 `lo < x ≤ hi`, 매물당 밴드 +1(some), ptype 4분류 항상 노출, 빈 칩 필터 동일
- **불확실:** 없음

### [DONE] P3 · isFav/isPassed Set 캐시
- **커밋:** `c06c33b`
- **변경:** `lib/product-interest.ts`, `lib/product-pass.ts`
- **동작보존:** write 시 Set 동기·storage 이벤트로 무효화·재파싱; FavHeart/ProductMoreMenu API 동일
- **불확실:** 없음

### [DONE] P4 · getMessages(roomId) 스코프
- **커밋:** `efc761d` (+ store/adapter `4efbfb9`)
- **변경:** `lib/domain/messaging.ts`(`getMessages`), `lib/store.ts`(`listMessagesForRoom`), `lib/firebase/rtdb-adapter.ts`, `components/ChatThread.tsx`(전송 후 로컬 append)
- **동작보존:** 방 메시지 집합·정렬 동일; 전송 직후 서버 재조회 생략·rec append
- **불확실:** roomsWithUnread의 전량 message list는 별건(미손)

### [DONE] P5 · applyStepCheck 계약 list 1회 + 캐시 패치
- **커밋:** `4efbfb9`
- **변경:** `lib/domain/settlement-engine.ts`, `lib/store.ts`(`patchListCache`, update 시 전량 invalidate→부분패치)
- **동작보존:** rival/dup/락 판정 로직 동일(공유 list + 패치 반영본)
- **불확실:** update 후 타 클라이언트 변경은 다음 풀 refresh까지 반영 안 됨(기존 invalidate 대비 트레이드오프·의도)

### [DONE] P6 · keyed get/save dedup
- **커밋:** `4efbfb9`
- **변경:** `lib/firebase/rtdb-adapter.ts` — product/policy/partner/user keyed-read; save dedup은 keyed get
- **동작보존:** 스코프 엔티티(contract/room/…)는 merged 폴백 유지(규칙 쿼리 스코프)
- **불확실:** product keyed get 시 partners 캐시 없으면 partnersForNames 호출 — 이름 누락 시 코드만(기존과 유사)

### [DONE] P7 · inventory selectP 캐시 부분패치
- **커밋:** `4efbfb9`
- **변경:** `app/inventory/page.tsx` — 자동보정 저장 후 `load()` 대신 `patchListCache`+`setRows` 행 패치
- **동작보존:** 폼·목록 표시 동일; 토스트 유지
- **불확실:** provider_name 등 withProviderNames 재부착은 패치에 없음(기존 행 값 유지)

### [SKIP] P8 · img 리사이즈
- **사유:** sharp 의존·빌드 영향 확인 필요. 애매 → 스킵(아침 판단)

### [SKIP] P9 · 폰트 self-host
- **사유:** 시각회귀 위험. 최소 preconnect만도 레이아웃 영향 → 스킵 권장. 접근: Pretendard `next/font/local` + Exo2 preload 논블로킹(별도 PR)

### [접근안] P10 · 모바일 피드 가상화
- **권장:** `virtua` 또는 `@tanstack/react-virtual`로 `shown` RowCard windowing; 이미지 `loading=lazy`+`PAGE` 유지.
- **저위험 대안:** PAGE_HARD(예: 60) + 무한스크롤만(라이브러리 無).
- **구현 보류** — 구조변경 크므로 아침 리뷰 후.

---

## Tier 2 — 정합/보안

### [DONE] C1 · 채팅 취소 필터
- **커밋:** `bcf1437`
- **변경:** `app/chat/page.tsx` — `cancelledIndex`/`cancelledOf` 분리
- **동작보존:** 문의/완료/all 불변; 취소만 취소계약 매칭

### [DONE] C2 · inquiries read 스코프 (규칙 편집만)
- **커밋:** `74776a3`
- **변경:** `database.rules.json` inquiries `.read` → admin \|\| agent_code=user_code \|\| agent_code=uid
- **앱:** inquiries 조회 코드 거의 없음(게스트 write 중심). 게시 전엔 latent.
- **불확실:** 앱이 전량 get 하면 게시 후 깨짐 — 게시 전 조회 경로 점검 권장

### [DONE] C3 · 채널 재키잉 고아 폴백 (b 권장)
- **커밋:** `74776a3` (+ app `readSettlementsScoped` in `4efbfb9`)
- **변경:** rules settlements/quote에 `agent_code` 쿼리 폴백 + indexOn; `readSettlementsScoped`에 agent_code 병합 조회
- **게시 금지** 유지

### [접근안] C4 · 계약완료 3-write 원자화
- **현상:** `계약완료` + `출고불가` 후 `createSettlement` 실패 시 정산 누락
- **안 A:** createSettlement 먼저(멱등) → 성공 시에만 status/락 (역순·실패 시 미완료 유지)
- **안 B:** 실패 시 롤백(status 되돌리기) + toast/관리자 알림
- **안 C:** lazy-create(열람 시 ST_ 없으면 생성) — 영업자 본인 완료건 허용
- **구현 보류** — 로직 민감, 아침 리뷰

### [접근안] C5 · v4/contracts 필드 actor validate
- **대상:** provider_* 스텝 필드에 `.validate` = provider\|\|admin \|\| (기존값 유지)
- **위험:** approveSign system 경로·에이전트 약정완료 키명 예외와 충돌 가능
- **구현 보류** — 필드별 표 + 시뮬 후 규칙 편집

---

## Tier 3 — 설계안만

### [설계안] D1 · 상업기밀 노드분리
1. `v4/partners_public/{code}` = `{ name }` (전 auth read)  
2. `v4/partners_private/{code}` = `{ fee_rate, … }` (admin + 해당 provider)  
3. `v4/users_private/{uid}` = `{ agent_payout_rate, email, phone }` (admin + 본인)  
4. `partnersForNames` → public 이름맵; 없으면 기존 partners graceful fallback(게시 전 안 깨짐)  
5. `resolveRates` → private만 (admin 컨텍스트/본인)  
6. dryRun 이관 스크립트만(실행 금지)  
**구현 보류**

### [설계안] D2 · 트윈·락 스코프
- rival/락을 역할스코프 list가 아니라 **관리자급 무스코프** 또는 `product.locked_by_contract` 트랜잭션으로  
- 이중 product_code는 `vehicleIdentity`(실번호판/VIN)로 가드  
**구현 보류** — 엔진 핵심

---

## 요약
- 구현·커밋: P1–P7, C1–C3
- 스킵: P8, P9
- 접근안만: P10, C4, C5, D1, D2
- typecheck: 통과
