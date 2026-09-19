# Audit 62 — first safe schedule delivery gap

Date: 2026-09-19 KST
Auditor: ChatGPT independent SSOT audit

## Verdict

**MATERIAL / WATCH(runtime).** Audit (61)의 safe automation cutover는 code/config/topology 수준에서 그대로 유효하다. 다만 audit (61)의 “첫 선언 slot(KST 09:05) 이전” 설명은 더 이상 현재 상태가 아니다. 2026-09-19 09:37 KST 기준 첫 settlement `09:05` 및 canonical ERP5 `09:17` slot이 모두 지났지만 새 `event=schedule` run은 아직 관측되지 않았다.

정확한 상태는 **delayed-or-missing / runtime proof pending**이다. 이 repository는 과거 GitHub scheduled event가 수 시간 지연돼 생성된 이력이 있으므로 workflow 고장으로 단정하지 않는다.

## Evidence

- audit 시작 시 current main HEAD: `59455403b4140d2728a0f4cd37d77f41cbfef535` (`docs(audit): record audit61 safe automation cutover`).
- audit (61) 이후 application/business logic commit 없음.
- latest main CI: run `35387663829`, success.
- `.github/workflows/settlement-intake-sync.yml`: `cron: '5 0-9 * * 1-6'` = KST 월~토 09:05~18:05.
- `.github/workflows/erp5-ssot-refresh.yml`: `cron: '17 0-10 * * 1-6'` = KST 월~토 09:17~19:17.
- repository-wide Actions `event=schedule` 재조회 시 newest run은 여전히 `35347508078`:
  - workflow: `ERP5 SSOT 원천 최신화(매시간)`
  - created: `2026-09-18T12:58:18Z` = 2026-09-18 21:58:18 KST
  - conclusion: `success`
  - production pin: `cf940df642edf315adbc6da2b4134fbad53da160`
- 따라서 2026-09-19 09:05 settlement intake와 09:17 ERP5 canonical slot은 이번 감사 시점까지 repository-wide scheduled event로 나타나지 않았다.

## What did not regress

- `settlement-intake-sync.yml`은 계속 `sync-intake-to-ledger.mts`만 scheduled apply하고 legacy `sync-contract-from-ledger.mts`를 호출하지 않는다.
- `contract-status.yml`, `sales-erp-hourly.yml`, `mirror-sync.yml`은 schedule이 제거된 manual dry-run only 상태다.
- `scripts/check-schedule-map.mts`는 retired workflow schedule 재생성, settlement intake tool 제거, legacy settlement writer 재연결을 fail-closed한다.
- canonical ERP5 production pin/registry/F01·F86 fixed-snapshot contract, Sonogong/AutoPlus special-tab routing, mirror/RTDB legacy boundary는 audit (61) 이후 변경되지 않았다.
- last proven canonical scheduled full-green run `35347508078`의 source 24/24 → Atom → snapshot → F01/F86 → freshness/cross-parity/photo audit PASS 증거는 계속 유효하다.

## Operational interpretation

1. safe cutover의 repository-level ownership 정리는 되돌리지 않는다.
2. 새 settlement automation은 아직 **scheduled runtime success가 증명되지 않았다.**
3. 09:05/09:17 미관측만으로 workflow를 broken/disabled라고 단정하지 않는다. 과거 multi-hour GitHub schedule delay가 실제로 있었다.
4. manual dispatch/apply는 scheduled proof를 대체하지 않는다.
5. 다음 실제 `event=schedule`이 나타나면 settlement-intake와 canonical ERP5를 각각 확인하고, success/실제 실행 step을 근거로 runtime WATCH를 해제할지 판정한다.

## Claude handoff

- application/business logic을 수정하지 않는다.
- audit (61)의 config/topology GO를 유지한다.
- runtime status만 `first slot not reached`에서 `first slots passed, delayed-or-missing`으로 갱신한다.
- #415 legacy marker/code debt와 기존 RP023/RP031/deposit/price/tab/freshness `/inventory` HOLD는 이번 schedule 관측으로 닫지 않는다.
