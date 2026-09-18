# ChatGPT → Claude SSOT 감사 진입점 — audit (54) override

> 구현 Owner는 Claude 단일 SSOT 세션이다. ChatGPT는 독립 감사·증거 기록만 한다. application/business logic은 이 감사에서 수정하지 않았다.

## 최우선 판정

### 1) NO-GO/HOLD — 자동 writer 전체 재개 전에 계약락 dual-writer를 단일화

현재 canonical ERP5 refresh와 30분 `contract-status`가 **같은 ERP5 `products.locked_by_contract`를 서로 다른 ownership marker로 쓴다.**

#### canonical production engine

- current workflow: `.github/workflows/erp5-ssot-refresh.yml`
- current production pin: `cf940df642edf315adbc6da2b4134fbad53da160`
- 실행: `scripts/sync-vehicle-lock-from-ledger.mts --apply`
- marker: `LEDGER`
- `접수` → Atom lock/status
- `취소` → 현재 marker가 `LEDGER`일 때만 unlock

#### 별도 30분 writer

- workflow: `.github/workflows/contract-status.yml`
- 예약지도: **켜짐**, `*/30 * * * *`
- 실행: `scripts/mark-contract-in-listings.mts --apply`
- marker: `정산원장`
- unlock도 현재 marker가 `정산원장`인 경우만
- Atom 외에 공급사 시트 `상태` + F01 `배차상태`까지 직접 mutation

두 workflow가 `erp5-inventory-publish` concurrency group을 공유하므로 simultaneous write는 직렬화되지만 **ownership/lifecycle 충돌은 그대로**다. marker 문자열만 맞추지 말고 계약상태 owner, 접수/취소/인도완료 lifecycle, F01 임시표시 책임을 한 경로로 정리한다.

**자동 schedule을 넓게 다시 켜기 전에 이 항목을 먼저 닫는다.**

## 2) HOLD — settlement-sync는 아직 legacy `정산` 탭 writer

`.github/workflows/settlement-sync.yml`은 예약지도상 켜짐이며:

1. `sync-intake-to-ledger.mts`
2. `sync-contract-from-ledger.mts`
3. format/unify

순서로 돈다.

하지만 current ledger canonical tabs는:

- `접수`
- `취소`
- `분납실적`
- `완납실적`
- `청구`

이고 `SETTLEMENT_LEDGER_TAB='정산'`은 옛 도구 호환용이다. legacy `sync-contract-from-ledger.mts`는 여전히 그 `정산` 탭을 읽고 공급사 시트를 직접 쓴다. 과거 scheduled run에서 실제 missing-`정산` failure도 확인됐다.

**부분반영 위험:** intake→ledger 1단계는 성공한 뒤 legacy contract step이 실패할 수 있다. canonical Atom-lock path와 ownership을 맞추고 retire/rewire한다.

## 3) HOLD — “예약지도에 꺼짐”은 runtime proof가 아님

`docs/예약작업-지도.md`:

- `sales-erp-hourly.yml` = 꺼짐
- `mirror-sync.yml` = 꺼짐

하지만 YAML cron/`--apply` 경로는 repo에 남아 있다.

`scripts/check-schedule-map.mts`는 map↔YAML cron 문자열만 비교하며 **GitHub Actions UI enabled/disabled 상태는 검증하지 않는다.**

따라서 자동운영 전 실제 workflow runtime state를 확인한다. 특히 `sales-erp-hourly`는 재활성화되면 legacy `hourly-sync.mts` 체인(mirror → F01/special tabs → ERP/RTDB/Firestore mirror → main publish)을 다시 실행할 수 있다.

## 4) RESOLVED(code/config) — F86 freshness checker / Firebase boundary

PR #412 merge commit:

- `dbba38212a0f026c593733dc7ca87bfebc19bc6b`

으로 다음은 코드/거버넌스 수준에서 해소됐다.

- production pin → `cf940df642edf315adbc6da2b4134fbad53da160`
- `VALIDATED_ENGINES` allowlist도 같은 SHA
- PR #411 F86 freshness checker fix 포함
- F86 publisher/auditor가 `f86TabCarriesMark` 공유
- root `.firebaserc` default=`freepasserp5`이면 CI fail-closed
- PR #412 premerge Source Contract / generic CI success

따라서 audit (51)의 “production pin 14892951 / PR #411 draft/open” 설명은 폐기한다.

## 5) OPEN(runtime proof) — 새 pin + scheduled delivery

아직 닫지 않는다.

- `cf940df6...`을 실제 checkout한 scheduled/full-apply **전체 green** 증거
- 2026-09-18 오후 repository-wide `event=schedule` delivery gap 복구
- `mirror-sync` / `sales-erp-hourly` 실제 runtime disabled 증거

수동 dry-run/push CI는 scheduled-event 복구 증거가 아니다.

## 6) 자동화 재개 gate

Claude 구현 Owner는 아래 순서로 닫는다.

1. **contract lock writer 1개** — `LEDGER` vs `정산원장` dual ownership 제거.
2. `settlement-sync` legacy `정산` writer retire/rewire.
3. legacy `sales-erp-hourly` / `mirror-sync` runtime disabled 확인 또는 fail-closed retirement.
4. production pin `cf940df6...` controlled full run:
   - source preflight
   - settlement/contract lock
   - 24-source ingest
   - fixed snapshot
   - F01 publish
   - F86 backup/publish
   - F86 freshness
   - Atom↔F01↔F86 cross parity
   - photo-link audit
   전부 green.
5. 이후 실제 `event=schedule` 연속 회차가 같은 검사로 green인지 확인한 뒤 자동운영 GO를 판단.

## 기존 HOLD 유지

직접 해소 증거가 없는 항목:

- RP023 canonical RebornCar vs legacy mirror old Google Sheet
- RP031 API/DOM feeder provenance / canonical migration
- main `deposit-policy.ts` vs production special-tab deposit-rule single-definition 미완료
- Sonogong/AutoPlus deposit recurrence/lineage
- vehicle-price source→Atom lineage
- sales-tab naming migration
- newest-Atom freshness semantics

## 기준

- current main audit log: `docs/AI-SSOT-AUDIT-LOG.md` → **2026-09-18(54)**
- 상세 근거: `docs/ai-ssot-audit/2026-09-18-chatgpt-audit54-preautomation-dual-writer-hold.md`
- current production pin: `cf940df642edf315adbc6da2b4134fbad53da160`
- PR #412 merge: `dbba38212a0f026c593733dc7ca87bfebc19bc6b`

**자동운영은 위 gate가 닫히기 전에는 넓게 재개하지 않는다.**
