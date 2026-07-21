# 규격통일 핸드오프 (Claude ↔ Cursor)

공용 규격 = **`CLAUDE.md`**. 둘 다 이거 따름.
**철칙: 같은 파일 동시편집 금지. 편집 전 재확인 → 편집 → `npx tsc --noEmit`(0 확인).**

---
## 전략 (사장님 결정 2026-07-18)

1. **외부시트 = 공급사마다 고유 시트.** v3 공용 종합/오토플러스 `source` enum 동기화는 **이식하지 않음**.
2. v4 기본 모델(이미 방향 맞음): `partner.sheet_url` + `mapping_profile` + `SheetSync`/`sheet-import` → 공급사별 학습.
3. **나머지 v3 운영기능은 v4 구조로 이식** (원자·`lib/domain`·`getStore`·엔진). v3 JS/HTML 덤프 금지.

---
## 구조 정리 — Cursor 진행

### ✅ Phase 1 — Messaging SSOT
### ✅ Phase 2 — Product 패밀리
### ✅ Phase 3 — 갓페이지 추출 (DONE_VALS→`isDone` SSOT · MasterFitSummary · 원자 adopt)
### ⏭ Phase 4 — Auth + store 단일화 (타 레인)
### ✅ Phase 5 — UI 사전 adopt or delete (레거시 Identity/SpecLine/PriceRows 등 삭제 · Chat/Sign/Finder 원자화)

---
## v3→v4 기능 이식 로드맵 (시트 전제 반영)

### ✅ Phase A — 공급사별 시트 아키텍처 강화
- `lib/domain/sheet-merge.ts` — softMerge / planProductUpsert / `commitSheetProducts` (빈칸→수기 덮어쓰기 금지, price 기간 병합)
- `lib/domain/sheet-adapters.ts` — generic|autoplus 레지스트리, `partnerSheetOpts`
- partner 필드: `adapter_id` · `header_row` · `sheet_tab`=gid
- `SheetSync` — 어댑터·헤더행·gid UI, 커밋=soft-merge upsert, PillTabs
- sim: `npx tsx scripts/sim-sheet-merge.mts` (10/10)
- **안 함:** v3 공용 external-sheet sync

### ✅ Phase B — 계약발송 허브
- 템플릿: `public/contract-template/*.html` (v3 embed API 재사용)
- `lib/domain/contract-send.ts` — buildPayload / draft / send→sign.ts
- `ContractSend.tsx` — iframe + 임시저장·PDF·발송
- `/contract` WorkPage 패널 **발송** 마운트
- 엔티티: `contract_draft`, `sign_draft_at`

### ✅ Phase C — 월별 관리자 정산 (VAT 정산서)
- `lib/domain/admin-settlement.ts` — BLOCKS·VAT10%·정산완료 불러오기
- `AdminSettlementSheet` + `/settlement` 탭 **VAT 정산서**
- 엔티티 `admin_settlement` (건별 settlement와 분리)

### ✅ 손님 공개 연결 (공유·서명)
- Auth: `/q` `/catalog` `/sign` 면제 (`public-access.ts`)
- Store: 공개면에서 RTDB 읽기 (`getSession || isPublicAccess`)
- Rules: `products`/`policies`/`v4/products|policies` `.read: true`
- 서명: `contract_sign/{token}` 공개 슬롯 읽기·제출 (`sign.ts`)
- **배포 필요:** `firebase deploy --only database` (rules)

### ⏭ Phase D — 알림 + 관리자소통
### ⏭ Phase E — 회원 승인·스코프
### ⏭ Phase F — 카탈로그·OCR·P2

---
## 메모 — 모바일 하단바 (다음에 모바일 레인에서)

**결정 (2026-07-18)**
1. **하단탭/하단바 = 상시.** 모바일에서 숨기거나 스크롤에 사라지게 하지 않음. 네이티브 앱처럼 항상 고정.
2. **홈(파인더 `/`)에도 하단바 메뉴가 있어야 함.** 지금은 `Page`/`BottomNav`가 홈에 안 붙어 있거나(이전·홈만), 홈 전용 메뉴(재고·계약문의·정산·더보기 등)가 없음 → TopBar 드롭다운만으로는 부족.

**구현 방향 (할 때)**
- `BottomNav`를 **탭바 SSOT**로 확장: 홈 / 계약문의 / 재고(역할별) / 정산·더보기 등 주요 레인.
- 홈 화면(`app/page.tsx` finder)도 모바일에서 하단바 **상시 마운트** + `fp-main-pad` 하단 패딩 확보.
- 웹은 기존 콕핏(TopBar·사이드) 유지, **모바일만** 하단 탭 강조(`useIsMobile`).
- 규격: 터치 40+ · `R` · `C.*` · 햅틱(`haptic.nav`) · safe-area.

**하지 말 것**
- 홈만 하단바 없음 / 스크롤 시 자동 숨김 / 페이지마다 다른 하단 높이.

---
갱신: Phase3·5 규격통일 + 영업자 막힘 개선(2026-07-19: session.code=user_code, RTDB rooms/messages 스코프 조회, /q?a= 매칭, 발송 링크 UX). 다음 = rules 배포 · 알림톡 Phase D · 모바일 하단탭 · Phase4 auth/store(타 레인).
