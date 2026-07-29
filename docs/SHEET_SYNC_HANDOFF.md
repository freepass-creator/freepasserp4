# 공급사 시트 연동 — Claude 마무리용 핸드오프

> 2026-07-28 사용자 합의. **구현은 Claude 마무리.** Cursor는 설계·합의만 정리.
> 관련: `lib/domain/sheet-merge.ts` · `sheet-sync-all.ts` · `master-ingress.ts` · `sheet-import.ts` · `product.ts` · `docs/FILE_STORAGE_AND_DRIVE_BACKUP.md`

---

## 0. 한 줄

연동 = **실제 시트 데이터를 우리 재고로 만들고**, 같은 **차량번호**로 **상태·필드 보강**하며, 시트에서 사라진 차는 **삭제하지 않고 출고불가**. 사진은 **우리 워크스페이스 Drive 링크**(`photo_link`).

### UX (합의) — 자동 vs 버튼

| 무엇 | 방식 | 이유 |
|---|---|---|
| 차종마스터 JSON 로드 | 재고/SheetSync **화면 진입 시 자동** | 읽기만, 변환 전제 |
| 허브 → `partner.sheet_url` | **관리자 버튼**「허브 URL 동기」 | 주소록만, 매물 write 없음 |
| 매물 일괄 입고·갱신 | **관리자 버튼**「전체 변환 후 저장」(+ confirm) | 부재→출고불가·실패 가드 — 백그라운드 자동 금지 |
| 단일 시트/엑셀 | 관리자·공급사 **불러오기 → 미리보기 → 변환 저장** | 학습·검수 |

**크론/자동 스케줄은 P0 이후.** 넣을 때도 dry-run·건수 급감 가드 필수. 페이지 로드마다 silent sync 금지.

이미 UI: `components/SheetSync.tsx` (재고). 허브 동기: `lib/domain/sheet-hub-sync.ts`.

### 시트 상태 → 규격 (2026-07-28)
`canonSheetVehicleStatus` (`sheet-import.ts`): 보류·불가→`출고불가`, 계약중→`계약중`, 판매중·할인판매·빈값→`출고가능`.  
원문은 `status_label_raw`. 오토플러스 본탭 gid=`284963459`(판매차량리스트), headerRow≈2.  
dry-run: `npx tsx scripts/count-autoplus-ingress.mts` → `data/sheet-ingress/RP023-autoplus.json`

---

## 1. 사용자 요구 (원문 취지)

1. 기존 매물 — 상태가 바뀌었는지 연동.
2. 신규 매물 — 무엇인지 확인 후 재고 등록.
3. 같은 차량번호인데 데이터가 업데이트되면 반영  
   (예: 차종만 있다가 색·주행거리 추가).
4. 시트에 없거나 출고불가면 **지우지 말고 출고불가**.
5. 신규는 Firebase(v4 오버레이)에 put.
6. 옵션 — 띄어쓰기 원자화 + 오타 감안(차종·색 학습 패턴 재사용).
7. 사진 — 시트/우리 Drive 링크 사용. 외부 URL만 우리 Drive에 저장 후 링크.
8. 허브 시트는 **주소록**이지 매물 SSOT 아님.

허브: https://docs.google.com/spreadsheets/d/1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY  
열: `공급사명 | 공급사코드 | 시트주소`

---

## 2. 지금 코드 vs 목표

| 항목 | 지금 | 목표 |
|---|---|---|
| 신규 차번 | `planProductUpsert` create ✓ | 동일 + 옵션/마스터 스냅 |
| 기존 차번 | soft-merge 전체 필드 ✓ | **유지** (빈칸 스킵, 값 있으면 색·주행 등 반영) |
| 차량상태 | soft-merge (엔진 락 시 스킵) ✓ | 동일 |
| 시트에서 사라짐 | **출고불가** patch (삭제 금지) ✓ | 동일 · fetch실패·급감 가드 |
| fetch 실패·급감 | 부재 처리 없음 | **그 공급사 부재→출고불가 금지** |
| 옵션 원자화 | `,` `/` 컷만 | 공백 원자 + alias + sim |
| 사진 | `photo_link` 매핑 있음 | Drive 링크 soft-merge. 바이트 일괄 복제 없음 |
| 외부 사진→Drive | 미구현 | **연동 본체와 분리** P1/P2 |

식별: `product_code = {providerCode}_{car}` (`sheet-import`, 차번 공백 제거).  
매칭 축: `provider_company_code` + 정규화 `car_number`.

---

## 3. 연동 한 방 순서 (P0)

```
허브/partner.sheet_url → 공급사별 fetch (성공분만)
  → importSheetTable (+ 옵션 원자화 훅)
  → snapToMaster / applyColors / prepareMasterIngress
  → commit:
       · 신규 키 → create
       · 기존 키 → softMergeProduct → patch
       · (fetch OK · 건수 가드 통과 시)
         같은 provider 재고 − 이번 유입 차번 키셋
         − locked_by_contract 없음 − 아직 출고불가 아님
         → vehicle_status: '출고불가'
  → 리포트: created / updated / status_changed / absent_blocked / skipped_locked / review / errors
```

저장 경유: **`commitSupplierProducts`만** (HANDOFF·master-ingress SSOT).  
v3 write 금지. v4 오버레이만.

### 가드 (필수)

- `locked_by_contract` 있으면 `vehicle_status` 덮지 않음 (현 soft-merge와 동일).
- 시트 fetch 실패 / imported≈0 / 직전 대비 급감 → **absent 분기 스킵** + 경고.
- 시트 차번 중복 → 1행만, 나머지 `dup` 리포트.
- 상태값 `VEHICLE_STATES` 밖 → 상태 미반영 + `bad_status`.

### 의도적 비범위 (P0)

- Firebase/`_deleted`로 매물 삭제
- 기존 매물 전필드 강제 덮어쓰기(빈 시트로 수기 지움) — soft-merge 유지
- 연동 중 Drive 파일 바이트 다운로드·업로드
- v3 공용 source sync 부활

---

## 4. 옵션 원자화 (P0~P1)

패턴 재사용:

- `unpackVehicleSignals` / 공백 토큰
- `COLOR_ALIAS` · `MODEL_ALIAS`
- `vehicle-master-match` `sim`
- `partner.mapping_profile` 형제 → `option_alias` (공급사별)

파이프:

```
원문 → , / 1차 컷
  → 덩어리별: 긴 사전 매칭 우선 + 남은 공백 토큰
  → exact → ALIAS → 포함 → sim≥θ
  → options(표시 ,조인) · fp_options(표준 ID)
  → 미매칭 = 원문 유지 + 검수 플래그
```

SSOT 후보: `parseProductOptions` / `normalizeProductOptionsText` (`lib/domain/product.ts`).  
시트 입고 경로에서만 정규화해도 되고, normalize를 공용으로 승격해도 됨 — **페이지 손롤 금지**.

---

## 5. 사진 정책 (합의)

| 출처 | 동작 |
|---|---|
| 시트 · 우리 워크스페이스 Drive | `photo_link` soft-merge만. 표시=`extract-photos`+`/api/img` |
| 외부 URL | **별도 배치**: 우리 Drive로 복사 → `photo_link`를 Drive로 교체. 실패해도 매물 커밋은 진행 |
| ERP 수기 업로드 | 기존: Storage → `photos`/`image_urls` + (가능 시) Drive 백업 — `FILE_STORAGE_AND_DRIVE_BACKUP.md` |

주의:

- Drive 폴더 **매물(차번)당 1폴더** — `shared_photo` 이슈 방지 (`data-check`).
- Cursor/에이전트는 Drive MCP 없음. OAuth env는 이미 운영 준비됨  
  (`GOOGLE_DRIVE_*`, 백업 루트 `FreepassERP4 자동백업`).  
  상품 사진용 **워크스페이스 루트 폴더 ID**는 운영자가 지정하면 됨(백업 루트와 분리 가능).

P0에서 Drive 쓰기 코드 새로 안 짜도 됨. **링크 연동만**.

---

## 6. 건드릴 파일 (예상)

| 파일 | 작업 |
|---|---|
| `lib/domain/sheet-merge.ts` | `planProductUpsert` / commit에 **absent→출고불가** + 리포트 타입 |
| `lib/domain/sheet-sync-all.ts` | fetch 성공 가드 후 absent reconcile · 리포트 집계 |
| `lib/domain/master-ingress.ts` | commit 시그니처/리포트 전달 (필요 시) |
| `lib/domain/sheet-import.ts` | 옵션 normalize 훅 · `photo_link` 유지 |
| `lib/domain/product.ts` | 옵션 원자화 SSOT |
| `lib/domain/color-master.ts` 패턴 | option snap 모듈 신설 시 복제 구조 |
| `components/SheetSync.tsx` | 리포트 UI (원자만, 새 raw 컨트롤 금지) |

허브→`partner.sheet_url` 동기화는 **별도 dry-run** 가능. 매물 파싱은 허브에서 하지 말 것.

---

## 7. 완료 조건

- [ ] 신규 차번 → v4 create, 마스터 스냅·검수 플래그
- [ ] 기존 차번 → soft-merge로 색·주행 등 보강 + 상태 연동
- [x] 시트 부재 → 출고불가 (삭제 없음), 엔진 락·fetch 실패·급감 시 스킵
- [ ] 옵션 `,`/`/` + 공백 원자 + alias/sim (최소 카탈로그)
- [ ] `photo_link` soft-merge, 연동 중 바이트 복제 없음
- [ ] `npx tsc --noEmit` 통과
- [ ] dry-run 리포트로 공급사 1곳 이상 검증

---

## 8. Claude에게

1. 구현 전 이 문서 + `CLAUDE.md` + 위 파일 **재독**.
2. 범위 확대(Drive 외부 복사·허브 ETL·UI 개편)는 P0 완료 후 별도.
3. 엔진 우회 금지 — `vehicle_status`의 계약락은 settlement-engine 소관.
4. 잘 되는 soft-merge·ingress 경로를 갈아엎지 말고 **absent 갈래만 추가**하는 쪽이 안전.
