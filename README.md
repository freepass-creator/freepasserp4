# 프리패스 ERP v4

저신용·무심사 니치 렌터카 **중개(brokerage)** ERP. v3(바닐라 SPA)의 손롤 라우터·페이지 파편화를 걷어내고, **jpkerp6에서 검증한 원자화 아키텍처**를 프리패스 도메인으로 재건축한 버전.

> v3는 라이브(Vercel) 무중단 유지. v4는 **로컬 우선**으로 구축 → 안정화 후 원격/마이그레이션.

## 실행 (로컬)
```bash
npm install
npm run dev          # http://localhost:4004
```
Firebase 미설정이면 `lib/store.ts`가 자동으로 **LocalAdapter(localStorage)** 폴백 → 바로 굴러감. 첫 실행 시 샘플 계약(`lib/seed.ts`) 주입.

## 아키텍처 = 5층 원자화 (페이지에 JSX·계산을 안 짠다)

| 층 | 위치 | 역할 |
|---|---|---|
| ① 엔티티 SSOT | `lib/intake/entities.ts` | `ENTITIES` 하나가 직접입력·엑셀·OCR 3방식 폼을 동시 생성. `ocrFrom`/`manual`/`idFrom`. |
| ② 저장 원자 | `lib/store.ts` | 단일 `StoreAdapter`(Local/Firestore/Dispatch). 자연키 dedup·soft-delete·회사격리(companyId). |
| ③ UI 원자 | `components/ui/index.tsx` | `ObjCard`(목록 단일원자 56px)·`Sec`·`Cards`·`Metric`·`Badge`·`DataTable`(모바일=카드)·`Modal`·`FormGrid`. |
| ④ 섹션(콕핏) | `app/page.tsx` | 상태가 던지는 질문으로 분류 — 심사대기·발송대기·운행중·환수구간·채권. |
| ⑤ 도메인 엔진 | `lib/domain/*` | 순수함수. `marginFee`=공급사수수료−영업자수수료, `clawbackWatch`(무보증 3·6개월 환수). |

**jpkerp(직영)과 다른 축**: 차량=매입/감가/매각이 아니라 **공급사·공급가·마진**. 계약=미수 중심이 아니라 **상품유형·심사·영업자·커미션·환수**. `partner`(영업자)·`supplier`(공급사)는 직영엔 없는 2-sided 엔티티.

## 설계 철칙 (v4 non-negotiable)
1. **원자·카드로만** — 새 목록/상세는 `ObjCard`+`Sec` 재사용. 손롤 카드/인라인 금지.
2. **웹·모바일 통일** — 원자가 반응형을 내장(`useIsMobile`). 한쪽 전용은 명시 합의 시만.
3. **오류 구조적 방지** — 라우트 파일 named export 금지, dev/build 격리, 문자열 날짜비교 지양(파생은 엔진에서), silent truncation 시 잔여 표기.

## 현재 상태
- [x] 골격·인프라·엔티티 SSOT·홈 콕핏(계약 슬라이스)
- [ ] 계약 상세(Drawer)·심사/발송/서명 액션·커미션 정산·환수 트래킹
- [ ] 차량(매물)·영업자·공급사 슬라이스
- [ ] OCR intake(계약서·면허·등록증)·엑셀 임포트
- [ ] v3 → v4 마이그레이션 어댑터
- [ ] 프리패스 전용 Firebase 연결(원격)
