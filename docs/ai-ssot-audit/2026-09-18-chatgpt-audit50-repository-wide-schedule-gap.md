# Audit 50 — `:17` 전환 뒤 두 회차 연속 부재 + repository-wide schedule delivery gap

Date: 2026-09-18
Auditor: ChatGPT (independent SSOT audit)
Repository: `freepass-creator/freepasserp4`

## Finding

Audit (49)은 PR #410 merge 뒤 첫 post-merge `17:17 KST` 회차가 아직 관측되지 않았다는 단계였다. 이번 재검수는 `18:21 KST` 이후이며, repository-wide `event=schedule` latest는 여전히 run `35304903901` (`ERP5 SSOT 원천 최신화(매시간)`, created `2026-09-18 12:53:42 KST`, conclusion=failure)이다.

따라서 ERP5의 post-merge `17:17`과 `18:17` 두 회차가 연속으로 schedule event로 생성된 증거가 없다.

더 중요한 점은 이 공백이 ERP5 단일 workflow에만 국한되지 않는다는 것이다. current main에는 다음 scheduled writer가 모두 살아 있다.

- `.github/workflows/mirror-sync.yml` — `*/30 * * * *`, schedule이면 `--apply`
- `.github/workflows/sales-erp-hourly.yml` — 평일 KST 09:00~18:00, schedule이면 `--apply`
- `.github/workflows/settlement-sync.yml` — 월~토 KST 09:05~18:05, schedule이면 ledger/supplier-status writer apply
- `.github/workflows/erp5-ssot-refresh.yml` — 월~토 KST 09:17~19:17

그런데 repository-wide latest schedule이 12:53 KST에서 멈춰 있다. 이 시각 이후라면 적어도 mirror 다수 회차, 18:00 sales/ERP, 18:05 settlement, 17:17/18:17 ERP5가 기대되지만 새 `event=schedule`가 없다. 현재 관측은 **repository-level scheduled-event delivery gap**에 더 가깝다.

동시에 push Actions는 살아 있다. CI run `35325766505`는 17:42:47 KST에 생성돼 success했다. 따라서 GitHub Actions 전체 장애라고 단정하지 않고, **scheduled event delivery만 미관측**이라고 한정한다.

## Live-state cross-check

- main before this audit recording: `7545b68f2f80a0dc807211bf7bcbfdf23ead3cbe`
- canonical ERP5 cron: `17 0-10 * * 1-6`
- production engine pin: `14892951a929cf03796231f260e6bc2ff3060efc`
- PR #411: draft/open, merged=false, head `f17747a549cf7857c28932373ada0bfb8eb7d7da`
- canonical registry unchanged: RP006 Iron website, RP012 Sonogong ERP API, RP023 RebornCar, RP031 Google Sheet
- F86 production rules unchanged: `종합`만 발행시각, 회사 탭은 `회사 · N대`; 장기요금 없는 차도 싣고 요금칸만 빈다; `종합`은 손오공/오토플러스 제외
- legacy writer topology unchanged: RP023 old `MIRROR_SOURCES`, mirror/sales/settlement scheduled writers, RTDB path HOLD
- RP031 provenance, Sonogong/AutoPlus deposit-policy, audit (27)/(28)/(29)/(34) HOLD unchanged

## Decision

1. Audit (49)의 “첫 slot delayed-or-missing”은 이제 stale다. **두 ERP5 slot 연속 부재 + 다른 scheduled writer도 같은 시간대 delivery 증거 0**으로 강화한다.
2. `:17` 변경은 유지하되 cadence recovery는 OPEN/HOLD다. 원인은 미확정 상태로 남긴다.
3. Claude는 scheduler 문제를 repository-wide 관점에서 진단하고, 실제 연속 `event=schedule` 재등장으로만 복구를 판정한다.
4. application code/business logic은 수정하지 않는다.
