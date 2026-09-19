# ChatGPT → Claude SSOT 감사 진입점 — audit (62) override

> 사용자의 명시적 지시로 ChatGPT가 **운영 workflow/config + CI governance**까지 자동화 정리를 수행했다. application/business logic 구현 Owner는 계속 Claude 단일 SSOT 세션이다.

## 1) 현재 운영 판정 — GO(config/topology) / WATCH(runtime)

자동 writer 충돌 P0는 repository 수준에서 해소된 상태를 유지한다. audit (61) 이후 application/business logic 회귀는 확인되지 않았다.

### 자동으로 도는 경로

#### A. 정산 intake
- workflow: `.github/workflows/settlement-intake-sync.yml`
- KST 월~토 09:05~18:05
- 계약접수 시트 → canonical 정산원장 `접수`
- ledger 서식/용어 정리
- inventory / supplier sheet / F01 상태를 직접 쓰지 않음

#### B. canonical ERP5
- workflow: `.github/workflows/erp5-ssot-refresh.yml`
- KST 월~토 09:17~19:17
- production pin: `cf940df642edf315adbc6da2b4134fbad53da160`
- 원장 접수/취소 → ERP5 contract lock
- 24 source ingest → Atom → fixed snapshot → F01 → F86 → freshness/cross-parity/photo audit

자동 흐름:

```text
09:05 settlement-intake-sync
  intake → ledger 접수
       ↓
09:17 erp5-ssot-refresh
  ledger lock → Atom → snapshot → F01/F86 → audits
```

## 2) RESOLVED — legacy automatic writers

PR #418 merge:
- `27adad84d0fd1d980e51eb00394de11afa48dbed`

다음은 automatic writer가 아니다.

### contract-status
- schedule 제거
- 운영 `--apply` 제거
- manual dry-run only
- 따라서 `LEDGER` vs `정산원장` **scheduled dual writer**는 제거됨

### sales-erp-hourly
- schedule 제거
- push trigger 제거
- `cloud-hourly-sync --apply` 제거
- manual dry-run only

### mirror-sync
- schedule 제거
- scheduled `--apply` 제거
- manual dry-run only

### CI guard
`check-schedule-map.mts`가:
- retired 3개 workflow에 schedule이 다시 생기면 FAIL
- settlement intake에서 `sync-intake-to-ledger.mts`가 사라지면 FAIL
- legacy `sync-contract-from-ledger.mts`가 다시 연결되면 FAIL

PR #418 검증:
- SSOT adapter contract `35386792417` success
- CI `35386792385` success
- workflow parse / schedule map / ERP5 boundary / RTDB / settlement / vehicle-lock / settlement E2E / production build PASS
- Vercel success

## 3) RESOLVED — legacy settlement workflow identity

과거 `settlement-sync.yml`은 `disabled_manually` 상태가 증명됐고 GitHub connector에는 workflow-enable API가 없다.

그래서 PR #419로 safe automation을 **새 workflow identity**로 등록했다.

PR #419 merge:
- `8583e640a30b058e152443fdf1bfce24f873b0aa`

변경:
- 추가 `.github/workflows/settlement-intake-sync.yml`
- 삭제 `.github/workflows/settlement-sync.yml`
- 예약지도 및 CI guard도 새 path로 전환

PR #419 검증:
- CI `35387211356` success
- production build 포함 전체 green
- Vercel success

## 4) Runtime WATCH — 첫 safe scheduled slots가 지났지만 event 미관측

새 `settlement-intake-sync.yml`은 2026-09-19 새벽 main에 처음 등록됐다.

audit (61) 작성 당시에는 첫 선언 슬롯(KST 09:05) 전이었지만, **2026-09-19 09:37 KST 기준 09:05 settlement slot과 09:17 canonical ERP5 slot이 모두 지났다.**

그런데 repository-wide `event=schedule` 최신 run은 여전히:

- run `35347508078`
- workflow `ERP5 SSOT 원천 최신화(매시간)`
- created 2026-09-18 21:58:18 KST
- conclusion `success`

이다. 따라서 새 settlement automation의 scheduled success와 오늘 첫 ERP5 scheduled delivery는 아직 미증명이다.

정확한 판정은 **delayed-or-missing / runtime proof pending**이다. 과거 이 repository에서 GitHub scheduled event가 수 시간 늦게 생성된 실측 이력이 있으므로, 현재 증거만으로 workflow broken/disabled라고 단정하지 않는다.

중요:
- 수동 `apply=true`를 scheduled proof로 대체하지 않는다.
- 실제 `event=schedule`이 나타나면 settlement-intake와 이어지는 canonical ERP5를 각각 확인한다.
- code/config/topology GO는 유지하고 runtime만 WATCH한다.

canonical ERP5 자체의 last proven scheduled full-green 증거는 유효하다:
- run `35347508078`
- production pin `cf940df642edf315adbc6da2b4134fbad53da160`
- source 24/24 → Atom → snapshot → F01/F86 → freshness/cross-parity/photo 전부 green

## 5) GitHub issue 상태

- #416 settlement legacy `정산` writer — **CLOSED / completed**
- #417 legacy scheduled writers retirement — **CLOSED / completed**
- #415 contract-lock owner/marker code cleanup — **OPEN**

#415 경계:
- automatic production dual-writer는 #418로 제거됐다.
- 다만 `scripts/mark-contract-in-listings.mts` 내부 legacy marker `정산원장` 자체는 남아 있다.
- application/business logic code cleanup은 Claude가 판단해서 처리한다.
- 현재 자동화 GO를 막는 P0는 아니다.

## 6) 기존 HOLD 유지

이번 automation cutover나 첫 schedule 미관측으로 해결됐다고 확대 해석하지 않는다.

- RP023 canonical RebornCar vs legacy mirror old Sheet **code debt** (자동 writer는 retired)
- RP031 API/DOM feeder provenance/canonical migration
- main `deposit-policy.ts` vs production special-tab deposit rule single-definition
- Sonogong/AutoPlus deposit lineage
- vehicle-price source→Atom lineage
- sales-tab naming migration
- newest-Atom freshness semantics
- `/inventory` ERP4 read/write boundary

## 7) 다음 Claude 우선순위

자동화 P0를 다시 뜯지 말고 다음 순서:

1. 실제 `event=schedule` delivery가 나타나면 settlement-intake 및 ERP5 scheduled runtime 검증
2. #415 legacy marker/code cleanup 필요성 판단 및 정리
3. RP023/RP031 source/provenance debt
4. deposit-policy single-definition
5. vehicle-price lineage
6. sales-tab/newest-Atom freshness
7. `/inventory` ERP5 authenticated write boundary

단, scheduled runtime evidence에서 실제 failure가 나오면 그것이 최우선 override다.

## 기준

- central audit: `docs/AI-SSOT-AUDIT-LOG.md` → audit (62)
- 상세: `docs/ai-ssot-audit/2026-09-19-chatgpt-audit62-first-safe-schedule-delivery-gap.md`
- audit62 evidence commit: `4f6283e6a840eca1c0f2bfea396e742dfe3f11d6`
- PR #418 merge: `27adad84d0fd1d980e51eb00394de11afa48dbed`
- PR #419 merge: `8583e640a30b058e152443fdf1bfce24f873b0aa`
- canonical production pin: `cf940df642edf315adbc6da2b4134fbad53da160`
- canonical scheduled green: `35347508078`

**현재 상태: 자동화 구성/소유권 정리는 완료. 첫 safe scheduled slots는 지났지만 event가 아직 관측되지 않아 runtime WATCH 유지.**
