# ChatGPT independent SSOT audit 74 — 2026-09-19 KST

## Finding

Audit (73)의 runtime summary는 수분 내 stale해졌다. ERP5 direct native cron도 다시 도착했지만, 직전 native settlement success가 시작한 ERP5 `workflow_run`이 아직 실행 중이어서 같은 production concurrency group에서 실제 overlap/pending 상태가 생겼다.

## Evidence

- Native settlement `35434637121`
  - event: `schedule`
  - created: 18:25:08 KST
  - configured slot: 18:05 KST
  - conclusion: `success`
- Settlement-triggered ERP5 `35434667030`
  - event: `workflow_run`
  - created: 18:25:48 KST
  - audit snapshot: `in_progress`
- Direct ERP5 native `35434923578`
  - event: `schedule`
  - created: 18:31:19 KST
  - configured slot: 18:17 KST
  - delay: about 14m 19s
  - audit snapshot: `pending`

## Contract comparison

Current `.github/workflows/erp5-ssot-refresh.yml` still has all three production triggers:
- direct cron `17 0-10 * * 1-6`
- settlement `workflow_run`
- heartbeat-file `push`

All feed the same production `refresh` job and share:
- `concurrency.group=erp5-inventory-publish`
- `cancel-in-progress=false`

The job-level condition filters failed/unsupported upstream `workflow_run` events, but there is no event-source dedupe gate that suppresses direct `schedule` when a recent settlement-triggered ERP5 run is already active.

Therefore native schedule return changes the operational risk from “missing native events” to “late native events plus overlapping production attempts.” No data corruption was observed in this audit snapshot, but audit (71)'s pending-replacement hazard remains directly relevant.

## Unchanged SSOT conclusions

- production engine pin: `cf940df642edf315adbc6da2b4134fbad53da160`
- ERP5 canonical source registry: 24 sources unchanged
- F01/F86: same fixed snapshot contract unchanged
- Sonogong/AutoPlus: dedicated special-tab rules unchanged
- `contract-status`, `sales-erp-hourly`, `mirror-sync`: retired from automatic production
- RTDB/mirror paths remain non-canonical inventory authority
- audit (67) standard quote-defaults freshness trigger HOLD remains open

## Judgment

**PARTIAL RESOLVED / NEW LIVE OVERLAP / HOLD.**

Native schedule delivery is now observed for both settlement and direct ERP5 in the same hour, but both are late. The simultaneous `workflow_run` + direct `schedule` production attempts need explicit dedupe/coalescing/queue semantics before cadence/automation GO can be considered safe.

No application code or business logic was modified by the auditor.

