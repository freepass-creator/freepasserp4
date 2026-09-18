# 2026-09-18 ChatGPT audit (54) — 자동운영 재개 전 writer/contract-lock 정합성 검수

## 판정

**전체 자동 writer 재개: NO-GO / HOLD.**

F01/F86 publisher 자체의 최신 checker 문제는 코드 수준에서 개선됐지만, 현재 저장소에는 **ERP5 계약락을 두 자동 경로가 서로 다른 ownership marker와 lifecycle로 쓰는 충돌**이 남아 있다. 또한 정산 legacy scheduled path와 GitHub UI enable/disable 비가시성까지 정리되지 않아, cron 전달만 복구한다고 자동운영을 켜면 안 된다.

## 1. 신규 핵심 충돌 — ERP5 `locked_by_contract` dual writer

### canonical production path

Current main `.github/workflows/erp5-ssot-refresh.yml`은 production engine을:

- `cf940df642edf315adbc6da2b4134fbad53da160`

으로 pin하고, schedule/`apply=true` 회차에서:

- `scripts/sync-vehicle-lock-from-ledger.mts --apply`

를 실행한다.

해당 production engine 스크립트는 정산원장 `접수` / `취소`를 읽고 ERP5 Firestore `products`에 직접 쓰며:

- lock marker = `locked_by_contract: 'LEDGER'`
- 접수 = lock + `resolveStatus(... locked:'LEDGER')`
- 취소 = **현재 marker가 정확히 `LEDGER`일 때만** unlock

한다.

### 별도 30분 writer

Current main `.github/workflows/contract-status.yml`은 `*/30 * * * *` cron을 가진 writer이고 예약지도에는 **켜짐**으로 적혀 있다. 이 workflow는:

- `scripts/mark-contract-in-listings.mts --apply`

를 실행한다.

이 스크립트는 동일 ERP5 Firestore `products`를 직접 수정하면서:

- lock marker = `locked_by_contract: '정산원장'`
- 상태 reason도 `정산원장`
- unlock은 **현재 marker가 정확히 `정산원장`일 때만** 수행

한다.

동시에 공급사 시트 `상태`와 F01 `배차상태`도 직접 수정한다.

### 왜 concurrency로 해결되지 않는가

두 workflow는 `erp5-inventory-publish` concurrency group을 공유하므로 **동시에** 쓰는 것은 직렬화된다. 그러나 이는 ownership 충돌을 해결하지 않는다.

- production engine과 30분 writer가 같은 필드에 서로 다른 marker를 쓴다.
- 각 unlock 경로는 자기 marker만 인식한다.
- 한 writer가 만든 상태/락을 다른 writer가 다음 회차에 다른 marker로 바꿀 수 있다.
- 취소 직후 어느 writer가 먼저 도는지에 따라 원천상태 복귀 시점/방식이 달라질 수 있다.
- 30분 writer는 Atom뿐 아니라 공급사 시트/F01까지 직접 수정하므로, canonical Atom→snapshot→F01/F86 publish 계열과 별도의 same-output mutation path가 된다.

따라서 자동운영 재개 전에 **계약상태/계약락 owner를 한 경로로 단일화**해야 한다. marker 문자열만 같게 만드는 것으로 끝내지 말고, 접수/취소/인도완료 lifecycle과 F01 임시표시 책임까지 한 계약으로 정리해야 한다.

## 2. 기존 blocker 재확인 — settlement-sync는 아직 legacy `정산` 탭 writer

Current `.github/workflows/settlement-sync.yml`은 예약지도에서 **켜짐**이며 다음을 호출한다.

1. `scripts/sync-intake-to-ledger.mts --apply`
2. `scripts/sync-contract-from-ledger.mts --apply`
3. ledger format/unify

그러나 current `lib/domain/settlement-ledger.ts`의 canonical 탭은:

- `접수`
- `취소`
- `분납실적`
- `완납실적`
- `청구`

이고, `SETTLEMENT_LEDGER_TAB = '정산'`은 **옛 도구 호환용**으로만 남아 있다.

`sync-contract-from-ledger.mts`는 여전히 이 legacy `정산` 탭을 읽고 공급사 시트를 직접 바꾸는 구형 경로다. 과거 scheduled run에서도 `정산` 탭 부재로 실제 failure가 확인됐다.

따라서 schedule delivery가 살아나더라도 이 workflow는 current ledger contract와 그대로 맞지 않는다. 특히 1단계 intake write 뒤 2단계에서 죽는 **부분반영** 가능성까지 고려해야 한다.

## 3. schedule map CI의 한계 — UI enabled/disabled 상태는 검사하지 못함

`docs/예약작업-지도.md`는:

- `sales-erp-hourly.yml` = 꺼짐
- `mirror-sync.yml` = 꺼짐

으로 적고 있다.

그러나 두 YAML에는 cron과 schedule `--apply` 경로가 그대로 존재한다.

`scripts/check-schedule-map.mts`는 실제 YAML cron과 예약지도에 적힌 cron 문자열의 존재만 대조한다. **GitHub Actions UI의 workflow enabled/disabled 상태는 읽거나 검증하지 않는다.**

따라서 CI green만으로 legacy writer가 실제로 꺼져 있다고 증명할 수 없다. 자동운영 재개 전 GitHub Actions runtime 상태를 별도로 확인해야 한다.

특히 `sales-erp-hourly`를 잘못 재활성화하면 current `scripts/hourly-sync.mts`가 다음 legacy chain을 다시 실행할 수 있다.

- `sync-mirror-all.mts`
- `publish-origin-tab.mts` (F01 + 손오공/픽업/오플 특수탭)
- `run-sheet-daily-sync-local.mts`
- RTDB→Firestore mirror 계열
- `make-sample-sheet-google.mts --main`

이는 canonical ERP5 single-writer 방향과 맞지 않는다.

## 4. code/config 수준에서 해소된 것

PR #412 merge commit:

- `dbba38212a0f026c593733dc7ca87bfebc19bc6b`

으로 다음은 개선됐다.

- production engine pin → `cf940df642edf315adbc6da2b4134fbad53da160`
- `VALIDATED_ENGINES` allowlist도 같은 SHA로 전진
- PR #411 F86 freshness checker contract fix가 production pin에 포함
- F86 publisher/auditor가 동일한 `f86TabCarriesMark` 규칙 사용
- root `.firebaserc` default가 `freepasserp5`가 되면 CI fail-closed
- PR #412 premerge Source Contract / generic CI success

따라서 예전 F86 “회사 탭에도 timestamp가 있어야 한다” false-positive는 **코드 수준 해소**로 볼 수 있다.

## 5. 아직 runtime proof가 없는 것

- 새 production pin `cf940df6...`을 실제 checkout한 **scheduled/full-apply green** 증거
- 2026-09-18 오후 관측된 repository-wide schedule delivery gap의 복구
- GitHub UI상 `mirror-sync` / `sales-erp-hourly` 실제 disabled 상태
- contract-status / settlement-sync ownership 정리 후의 end-to-end 접수→락→ingest→snapshot→F01/F86 parity

수동 dry-run/push CI는 scheduled-event 복구 증거로 대체하지 않는다.

## 6. 기존 SSOT HOLD 유지

이번 감사에서 직접 해소 증거가 없는 항목은 유지한다.

- RP023 canonical RebornCar vs legacy mirror old Google Sheet source
- RP031 API/DOM feeder provenance 및 canonical migration HOLD
- main `deposit-policy.ts`와 production special-tab 보증금 계약의 단일정의 미완료
- Sonogong/AutoPlus special-tab deposit-rule lineage
- vehicle-price source→Atom lineage
- sales-tab naming migration / newest-Atom freshness 관련 기존 HOLD

## 자동화 재개 gate

자동 schedule을 넓게 살리기 전 최소 조건:

1. **contract lock writer 1개** — `LEDGER` vs `정산원장` dual ownership 제거.
2. `settlement-sync`의 legacy `정산` writer retire/rewire.
3. `sales-erp-hourly`, `mirror-sync`의 실제 GitHub UI disabled 상태 확인 또는 repository-level fail-closed retirement.
4. 새 production pin으로 controlled run 1회:
   - source preflight
   - Atom lock
   - ingest
   - fixed snapshot
   - F01
   - F86
   - F86 freshness
   - Atom↔F01↔F86 parity
   - photo link
   모두 green.
5. 이후 실제 `event=schedule`이 연속 회차로 생성되고 동일 검사 green인지 확인.

그 전에는 **“스케줄만 다시 켜면 된다”로 판단하지 않는다.**

이번 감사에서는 application code/business logic을 수정하지 않았다.
