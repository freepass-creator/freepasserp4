# Audit 88 — 12:05 settlement missed native schedule and recovery after grace

Date: 2026-09-21 12:53 KST
Auditor: ChatGPT independent SSOT audit
Status: **MATERIAL REGRESSION / HOLD (native cadence + recovery continuity), WATCH (monitor reconciliation), PASS (canonical ownership/topology unchanged)**

## Finding

Audit 87 established that the 10:05 and 11:05 logical settlement slots were recovered by heartbeat-triggered `push` runs even though native GitHub `schedule` delivery remained unresolved. The next due production slot, **2026-09-21 12:05 KST**, was not protected by either lane within the repository's configured grace period.

Evidence at **12:53 KST**:

1. `.github/workflows/settlement-intake-sync.yml` declares `cron: '5 0-9 * * 1-6'`, i.e. 09:05–18:05 KST hourly on Mon–Sat, and explicitly allows the heartbeat-file `push` fallback.
2. `.automation/safe-chain-monitor.json` declares `missingScheduleGraceMinutes: 20` and `settlementExpectedKst: 09:05-18:05 Mon-Sat hourly`.
3. GitHub Actions query for `branch=main&event=schedule` over **11:45–12:53 KST** returned **`total_count: 0`**. This interval covers both the expected 12:05 settlement native trigger and the downstream 12:17 ERP5 native slot.
4. Push-run inspection over the same interval showed the previously recorded 10:05/11:05 recovery runs but **no 12:05 heartbeat recovery**. No commit/run title for `1205` was present.
5. `.automation/heartbeats/settlement-intake-sync.txt` still points to `slot=2026-09-21T11:05:00+09:00`.
6. `.automation/safe-chain-monitor.json` was last checked at `2026-09-21T12:21:05+09:00`, only through slot `11:05`; its last heartbeat is also `11:05`. At audit time, the 12:05 slot was **48m44s late**, well beyond the configured 20-minute grace.

Therefore the prior conclusion “native cadence is on HOLD but the watchdog recovery lane is actively protecting missed slots” is now stale. The watchdog/recovery continuity itself missed at least this due slot beyond grace. This does **not** prove a permanent GitHub scheduler outage, and it does **not** by itself prove ERP5/F01/F86 data corruption; it is a production delivery/timeliness and recovery-governance regression.

## Monitor reconciliation state

There is one partial resolution and one remaining drift relative to Audit 87:

- **Resolved:** the 10:05 tracker entry is now reconciled to `erp5-audit-failure` with the F86 canonical tab-order failure recorded (`updatedAt=12:21:05 KST`).
- **Still stale:** the 11:05 entry remains `erp5-in-progress`, its audits remain `pending`, and `lastKnownGoodErp5RunId` still points to the 09:05 ERP5 run `35550547914`, even though Audit 87 verified downstream ERP5 run `35556051763` completed `success`/full-green.

Do not weaken parity/freshness/audit gates to address this monitoring drift; reconcile persisted monitor truth to completed Actions conclusions instead.

## SSOT / writer-topology check

No application/business-logic change landed after the Audit 87 recorder head before this observation. The current repository evidence does not show a new ownership or writer-topology drift:

- ERP5 remains the canonical inventory/data plane.
- The canonical 24-source registry remains the governing source registry.
- F01 and F86 remain projections from the same fixed snapshot.
- Sonogong special tabs remain `오공구독` / `픽업구독`; AutoPlus remains `오플구독`; the existing F86 special-tab/exclusion policy is unchanged.
- Retired mirror/sales automatic-writer decisions and the RTDB/mirror non-canonical boundary are unchanged.

This audit therefore **does not authorize** any SSOT cutover, writer reactivation, RTDB/mirror promotion, or application/business-logic change.

## Claude handoff

Claude remains the sole implementation owner for this SSOT session. Claude should treat the current state as:

- **HOLD — native schedule cadence/timeliness** (unchanged),
- **HOLD — recovery continuity** (newly re-opened/strengthened because 12:05 exceeded grace with no fallback),
- **WATCH — monitor reconciliation** (10:05 corrected; 11:05 still stale),
- **PASS — canonical ownership/topology and projection semantics** (no new drift observed).

The auditor did not trigger a recovery run and did not modify application code or business logic.
