# ChatGPT → Claude SSOT 감사 진입점 — audit (56) override

> 구현 Owner는 Claude 단일 SSOT 세션이다. ChatGPT는 독립 감사·증거 기록만 한다. application/business logic은 이 감사에서 수정하지 않았다.

## 1) RESOLVED(code/main) — downstream read split-brain

Audit (55)에서 staged였던 PR #414가 main에 merge됐다.

- merge commit: **`817865d732b92b284c1db78a183325c6bfb12a1f`**
- PR head CI: **`35343147167` success**
- merge-main CI: **`35343414676` success**

main의 authenticated `/api/products`, Finder, `/m/[code]`, F01 상세링크 매핑, 영업자 내부정보 policy/partner, read-only ops inventory는 canonical **freepasserp5**를 읽는다. ERP4 Firebase Auth는 인증 경계로 남고, ERP5 product read 실패를 ERP4 상품값으로 silent fallback하지 않는다.

**이 항목은 다시 구현하지 않는다.**

### `/inventory`는 별도 HOLD

편집 `/inventory`는 아직 ERP4 read/write 한 묶음이다. ERP5 authenticated write API + 권한 + audit log + field ownership/CAS가 생길 때 read/write를 함께 전환한다. 읽기만 ERP5로 옮기지 않는다.

## 2) NO-GO/HOLD — 계약락 dual writer

같은 ERP5 `products.locked_by_contract`를 두 owner가 쓴다.

### canonical production engine

- `.github/workflows/erp5-ssot-refresh.yml`
- production pin: **`cf940df642edf315adbc6da2b4134fbad53da160`**
- `scripts/sync-vehicle-lock-from-ledger.mts --apply`
- marker: **`LEDGER`**
- 접수 lock / 취소 시 자기 `LEDGER` lock만 해제

### 별도 30분 writer

- `.github/workflows/contract-status.yml`
- YAML cron `*/30 * * * *`
- `scripts/mark-contract-in-listings.mts --apply`
- marker: **`정산원장`**
- 같은 ERP5 Atom + 공급사 시트 상태 + F01 배차상태를 직접 mutation
- 자기 `정산원장` lock을 별도로 해제

같은 `erp5-inventory-publish` concurrency group은 simultaneous write만 직렬화한다. ownership/lifecycle 충돌은 해결하지 않는다. **자동 writer를 넓게 재개하기 전에 contract lock owner를 1개로 만든다.**

## 3) HOLD — settlement-sync legacy `정산` writer

`.github/workflows/settlement-sync.yml`은 YAML상 예약 쓰기 경로가 있고:

1. `sync-intake-to-ledger.mts`
2. `sync-contract-from-ledger.mts`
3. format/unify

순서다.

current canonical ledger tabs는 `접수 / 취소 / 분납실적 / 완납실적 / 청구`다. `SETTLEMENT_LEDGER_TAB='정산'`은 옛 도구 호환 alias인데 `sync-contract-from-ledger.mts`가 아직 이 alias를 읽고 공급사 시트를 직접 쓴다. intake 1단계 성공 뒤 legacy 2단계 실패/오염 가능성이 있으므로 retire/rewire한다.

## 4) HOLD — scheduled-event delivery / runtime enabled proof

2026-09-18 **21:23 KST** 재확인 기준 repository-wide 최신 `event=schedule`은 여전히:

- run **`35304903901`**
- **12:53:42 KST**
- ERP5 SSOT workflow
- conclusion failure

이다. 이후 scheduled event가 없다. ERP5 `:17` 전략은 실제 17:17/18:17/19:17 event가 생성되지 않아 recovery proof가 없다. push/manual CI는 schedule 복구 증거가 아니다.

`docs/예약작업-지도.md`는 `sales-erp-hourly` / `mirror-sync`를 꺼짐으로 적지만 두 YAML에는 cron + scheduled `--apply` 경로가 남아 있다. map checker는 GitHub UI enabled/disabled state를 검증하지 않으므로 runtime state를 별도로 확인한다.

## 5) RESOLVED(code/config) — F86 checker / Firebase canonical boundary

PR #412 + production pin `cf940df...` 기준:

- F86 publisher/auditor가 `f86TabCarriesMark` 공유
- 하허호 종합만 `MM.DD HH:MM`, 회사탭은 `회사 · N대`
- cell/plate/header/tab-order 대조 유지
- root generic Firebase config가 canonical freepasserp5를 가리키면 CI fail-closed

이 부분은 code/config RESOLVED다. 다만 새 pin의 scheduled full-apply green은 schedule delivery와 함께 runtime OPEN이다.

## 6) 기존 HOLD 유지

직접 해소 증거가 없는 항목:

- RP023 canonical RebornCar vs legacy mirror old Google Sheet
- RP031 API/DOM feeder provenance / canonical migration
- main `deposit-policy.ts` vs production special-tab deposit-rule single-definition
- Sonogong/AutoPlus deposit recurrence/lineage
- vehicle-price source→Atom lineage
- sales-tab naming migration
- newest-Atom freshness semantics

## 7) Claude 구현 Owner 다음 순서

1. contract lock writer/marker ownership 1개로 통합.
2. `settlement-sync` legacy `정산` writer retire/rewire.
3. `sales-erp-hourly` / `mirror-sync` 실제 runtime disabled 확인 또는 fail-closed retirement.
4. production pin `cf940df...` controlled full run에서 source preflight → lock → ingest → snapshot → F01 → F86 → freshness → cross parity → photo-link 전부 green.
5. 실제 `event=schedule` 연속 회차 green 확인 후 자동운영 GO 판단.
6. `/inventory`는 ERP5 authenticated write boundary 설계가 끝나면 read/write 함께 이관.

## 기준

- current audit log: `docs/AI-SSOT-AUDIT-LOG.md` → **2026-09-18(56)**
- 상세 근거: `docs/ai-ssot-audit/2026-09-18-chatgpt-audit56-pr414-merged-runtime-hold.md`
- PR #414 merge: `817865d732b92b284c1db78a183325c6bfb12a1f`
- production pin: `cf940df642edf315adbc6da2b4134fbad53da160`

**application code/business logic은 이 감사에서 수정하지 않는다.**
