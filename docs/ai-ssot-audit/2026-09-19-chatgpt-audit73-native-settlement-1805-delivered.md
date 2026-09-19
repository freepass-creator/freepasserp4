# ChatGPT independent SSOT audit 73 — 2026-09-19 KST

## Finding

Audit (72)의 runtime 요약은 부분적으로 stale해졌다. repository-wide native schedule delivery가 18:05 settlement slot에서 다시 관측됐다.

## Evidence

- `정산 접수→원장(1시간)` run `35434637121`
  - event: `schedule`
  - created: 2026-09-19 18:25:08 KST
  - completed: 18:25:46 KST
  - conclusion: `success`
  - configured slot: 18:05 KST (`5 0-9 * * 1-6`)
  - delivery delay: about 20m 08s
- Its success created ERP5 run `35434667030`
  - event: `workflow_run`
  - created: 18:25:48 KST
  - audit snapshot: `in_progress`
- Fresh repository-wide `event=schedule` results show the newest direct ERP5 native scheduled run is still `35421826100` at 13:38:19 KST, conclusion `success`.

## Contract comparison

Current `erp5-ssot-refresh.yml` still has:
- direct cron `17 0-10 * * 1-6`
- settlement `workflow_run` chaining
- heartbeat push fallback
- `concurrency.group=erp5-inventory-publish`
- `cancel-in-progress=false`

Current `settlement-intake-sync.yml` still has:
- cron `5 0-9 * * 1-6`
- heartbeat path fallback
- ledger-only production apply
- no direct canonical inventory writer

Repository-level retired writer topology is unchanged:
- `mirror-sync.yml`: workflow_dispatch dry-run only
- `sales-erp-hourly.yml`: workflow_dispatch dry-run only
- mirror/RTDB paths remain non-canonical inventory authority

Canonical source registry remains unchanged, including:
- RP006 Iron = website
- RP012 Sonogong = ERP API
- RP023 AutoPlus = RebornCar website
- RP031 Ianka = current Google Sheet

Production pin remains `cf940df642edf315adbc6da2b4134fbad53da160`; F01/F86 same-fixed-snapshot and Sonogong/AutoPlus special-tab conclusions remain inherited.

## Judgment

**PARTIAL RESOLVED / WATCH.**

The 18:05 settlement slot proves native schedule delivery is not wholly absent. It does **not** prove stable cadence or punctuality, because it arrived about 20 minutes late, the downstream ERP5 chain was still running at the audit snapshot, and no newer direct ERP5 `event=schedule` had appeared.

Audit (71)'s burst/backfill pending-run cancellation hazard remains OPEN, including the unreconciled 15:05 ERP5 `35427915834` cancelled-before-job event.

Audit (67)'s standard quote-defaults freshness trigger HOLD also remains open.

No application code or business logic was modified by the auditor.
