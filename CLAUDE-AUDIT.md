# ChatGPT → Claude SSOT 감사 진입점 — audit (57) override

> 구현 Owner는 Claude 단일 SSOT 세션이다. ChatGPT는 독립 감사·증거 기록만 한다. application/business logic은 이 감사에서 수정하지 않았다.

## 1) RESOLVED(code/main) — downstream read split-brain

PR #414가 main에 merge됐다.

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

## 4) PARTIAL RESOLVED / HOLD — scheduled-event delivery / cadence

Audit (56)의 **“2026-09-18 12:53 KST 이후 scheduled event가 없다”**는 문장은 이제 stale다.

새 repository-wide `event=schedule`이 실제 도착했다.

- run **`35347508078`**
- created **2026-09-18 21:58:18 KST**
- workflow `ERP5 SSOT 원천 최신화(매시간)`
- conclusion **success**
- 실제 checkout production pin **`cf940df642edf315adbc6da2b4134fbad53da160`**

이 회차는 source preflight 24/24 → ledger lock → ingest apply 24/24 → snapshot → public verify → F01 → F86 backup/publish → freshness → Atom/F01/F86 parity → photo-link까지 전부 green이었다.

따라서 **scheduled delivery 0건 상태는 해소/부분해소**, production pin의 **scheduled full-run green은 확인 완료**다.

다만 current cron은 월~토 KST `09:17~19:17`인데 이 event는 **21:58 KST**에 생성됐다. 마지막 선언 슬롯 19:17보다 약 2시간 41분 늦고, post-gap scheduled success도 아직 이 1회뿐이다. **`:17` 전략의 cadence/punctuality 정상화와 자동운영 GO는 계속 HOLD**다. declared window에서 연속 `event=schedule` 회차가 실제 생성·성공해야 닫는다.

또한 `docs/예약작업-지도.md`는 `sales-erp-hourly` / `mirror-sync`를 꺼짐으로 적지만 두 YAML에는 cron + scheduled `--apply` 경로가 남아 있다. map checker는 GitHub UI enabled/disabled state를 검증하지 않으므로 runtime state를 별도로 확인한다.

## 5) RESOLVED(code/config + scheduled runtime proof) — F86 checker / canonical publication boundary

PR #412 + production pin `cf940df...` 기준:

- F86 publisher/auditor가 `f86TabCarriesMark` 공유
- 하허호 종합만 `MM.DD HH:MM`, 회사탭은 `회사 · N대`
- cell/plate/header/tab-order 대조 유지
- root generic Firebase config가 canonical freepasserp5를 가리키면 CI fail-closed

이제 run `35347508078`에서 scheduled runtime proof도 생겼다.

- F86 **19탭 / 671대** publish success
- freshness `종합 09.18 22:09 · 388대` → **1분 전 / 허용 120분**
- F86 Atom audit **43,925 cells / mismatch 0**
- Atom↔F01 / F01↔F86 missing·extra·value diff 모두 0
- photo-link mismatch 0

따라서 audit (35)의 old freshness false-positive는 **code/config뿐 아니라 실제 scheduled production run에서도 해소됨**이다. 이 checker를 다시 구현하지 않는다.

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
4. declared schedule window에서 실제 `event=schedule` 연속 회차 green을 확인한 뒤 cadence/timeliness·자동운영 GO 판단.
5. `/inventory`는 ERP5 authenticated write boundary 설계가 끝나면 read/write 함께 이관.

## 기준

- audited application HEAD: `5f6a144b89e0638527e6f73cedc3560a3a36677d`
- current audit log: `docs/AI-SSOT-AUDIT-LOG.md` → **2026-09-18(57)**
- 상세 근거: `docs/ai-ssot-audit/2026-09-18-chatgpt-audit57-scheduled-green-cadence-hold.md`
- scheduled production evidence: run **`35347508078`**
- production pin: **`cf940df642edf315adbc6da2b4134fbad53da160`**

**application code/business logic은 이 감사에서 수정하지 않는다.**