# PLAN — 공급사 시트 → 우리 원자 (가격 포함) 유입 + 저장 전 diff 미리보기

작성: Claude Code · 2026-07-28 · 대상 브랜치: main (sheet-sync WIP 위)
관련: `lib/domain/sheet-import.ts` · `sheet-merge.ts` · `sheet-diff.ts`(신규, 내가 함) · `master-ingress.ts` · `components/SheetSync.tsx` · `lib/domain/product.ts`(price 원자) · `docs/SHEET_SYNC_HANDOFF.md`

## 1. 원래 요구사항 (사용자 원문 취지)
1. 외부 공급사 시트를 우리 재고(원자)로 가져온다.
2. **대여료(월렌트)는 공급사 시트에서 결정** → 시트에서 가격 원자를 수집해야 한다.
3. 저장 **전에** "기존 대비 신규 몇 / 상태변경 몇 / 내용수정 몇 / 부재(출고불가) 몇"을 **먼저 확인**하고 동기화.
4. 시트에 없거나 출고불가면 삭제하지 말고 **출고불가**.
5. 공급사 양식을 **원자 수집이 쉬운 표준**으로 정리(권장 배포).

## 2. 현재 코드 조사 (사실)
- 총 유입: **1,603대** (17 공급사, `data/sheet-ingress/hub-all-ingress.json`). 차종마스터 확신 high 1341 / med 134 / low 128(수입차 위주).
- 현재 ingress가 수집하는 원자: `car_number · vehicle_status(+status_label_raw) · maker · model · trim_name · ext_color · fuel_type` + `_snap_confidence`. **가격·연식·주행·배기량·우대·옵션 미수집.**
- 우리 가격 원자(`product.ts`): `p.price = Record<month, { rent, deposit, fee }>` (표준 개월 1·12·24·36·48·60), `normalizeWonPair`가 만원단위 정규화.
- 공급사 시트 양식 편차 큼:
  - **아이카(RP004, 1307대) = 골드 스탠다드.** 헤더 명시: `1개월·6개월·12개월·24개월·36개월·48개월·60개월`(개월별 대여료) · `단기보증·장기보증` · `Km·최초등록·배기량·트림·옵션·분납·21세·23세`.
  - **오토플러스(RP023) = 라벨 없는 4개 가격 열** + 등록일·주행이 헤더 없이 존재 → 개월 매핑 불가.
- `summarizeSheetDiff`(내가 이미 작성·sim 9/9 PASS): 신규/상태변경/내용수정/부재/무변경 집계 + 항목 상세. **가격은 아직 diff에 반영 안 됨**(가격 원자 자체가 미수집이라).

## 3. 영향 파일
- `lib/domain/sheet-import.ts` — 개월별 가격·부가필드 파서 추가 (표준 헤더 인식).
- `lib/domain/supplier-column-map.ts` (신규) — 공급사별 열 매핑 프로필(비표준 어댑터).
- `lib/domain/sheet-diff.ts` — 가격 변동을 diff 상세에 포함(기존 content에 잡히나 "대여료 변동" 라벨).
- `components/SheetSync.tsx` — diff 배너(가격변동 포함) + 표준 템플릿 다운로드 버튼. **(Cursor)**
- `scripts/sim-sheet-price.mts` (신규) — 가격 파서 검증.

## 4. 대안·트레이드오프
- **A. 표준 헤더 파서 + 공급사 어댑터(권장).** 표준(아이카식) 헤더는 자동 파싱, 비표준은 공급사별 열 프로필. 장점: 표준 공급사 즉시 동작, 비표준도 커버. 단점: 어댑터 유지비.
- **B. 전부 표준 강제.** 모든 공급사에 표준 양식 요구. 장점: 코드 단순. 단점: 현실적으로 즉시 전환 불가(오토플러스 등 기존 운영).
- **C. AI로 열 자동추론.** 과함·비결정적. 기각.
- → **A 채택** (표준 우선 + 예외 어댑터).

## 5. 구현 순서 (역할 표시)
1. **[Claude] 개월별 가격 파서** — 표준 헤더(`N개월` 열들 + 단기/장기보증)에서 `price:{month:{rent,deposit}}` 생성. "-"·빈값 스킵, `normalizeWonPair` 적용. + 부가필드(연식=최초등록, 주행=Km, 배기량, 트림, 옵션, 우대=분납/21·23세). 데이터 정합 = 내 도메인.
2. **[Claude] 공급사 어댑터 스키마** — `supplier-column-map.ts`: `providerCode → { headerRow, gid, cols: {rent_by_month, deposit_short, deposit_long, km, year, ...} }`. 표준 미매칭 공급사만 등록(오토플러스 4열 개월 확정 필요 → 결정사항).
3. **[Claude] sim-sheet-price** — 표준(아이카)·비표준(오토플러스) 각 1건 → 기대 price 원자 검증.
4. **[Cursor] SheetSync UI** — `summarizeSheetDiff` 배너(신규/상태/내용/부재/무변경, 가격변동 강조) + "표준 템플릿 다운로드" + 각 카운트 클릭 상세. (별도 커서 오더로 전달)
5. **[Codex] 전수검증** — 요구 대비 diff·가격 매핑 정확성, 회귀(sim 전체), 원가 필드가 private 노드로 가는지(products_private) 확인.

## 6. 테스트 계획
- `npx tsx scripts/sim-sheet-price.mts` (표준·비표준 각 기대 price)
- `npx tsx scripts/sim-sheet-diff.mts` (기존 9/9 유지)
- `npx tsc --noEmit` · `npm run check:fonts`
- 실데이터 dry-run: 아이카·오토플러스 시트 → 가격 포함 원자 카운트가 hub-all-ingress와 정합.

## 7. 완료 조건
- 표준(아이카) 시트에서 **개월별 대여료·보증금·연식·주행·배기·우대**가 원자로 수집됨.
- 비표준(오토플러스)도 어댑터로 가격 수집(또는 표준전환 결정).
- SheetSync에서 저장 전 diff(가격변동 포함) 확인 → 승인 후 commit.
- 원가성 필드(소비자가격 등)는 `products_private` 규칙 준수.

## 8. 가정 · 사용자 결정 필요
- **보증금 매핑:** 단기보증 → 단기 개월(1·6), 장기보증 → 장기(12+)? 아니면 전 기간 공통 2단계? **(결정 필요)**
- **오토플러스 무라벨 4개 가격 열의 개월** = ? (예: 12/24/36/48) **(결정 필요 — 공급사 확인)**
- **소비자가격·차량가액** = 원가 → `products_private`로만? (기존 정책과 정합)
- 표준 템플릿을 공급사에 배포·전환 요청할지(운영 결정).

## 9. 롤백
- 가격 파서는 **추가만**(기존 identity 매핑 불변) → 문제 시 파서 호출부만 제거. diff·commit 로직은 안 건드림. 규칙 게시 없음(코드만).

---
*역할: Claude=설계(이 문서)+가격 파서 데이터코어 / Cursor=SheetSync UI 노가다 / Codex=전수검증. 검증 기준=위 §1 원래 요구사항.*
