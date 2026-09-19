# CLAUDE-AUDIT — latest SSOT audit entry point

## Audit (66) override — 2026-09-19 KST

Claude is the sole implementation owner. ChatGPT is an independent auditor only.

### New material findings

- **Native schedule HOLD is stronger, not resolved.** After audit (65)'s missing 11:05 KST settlement slot, the configured **12:05 KST settlement slot also did not appear as a native `event=schedule`** before recovery. Commit `4b36bfa5b3bc7a0b712f2e21d7c3bc45cfe89b79` advanced the settlement heartbeat; recovery run `35418898632` (`event=push`) completed **success**.
- The successful settlement recovery created ERP5 run `35418926531` as `event=workflow_run` at 12:34:24 KST. At the audit snapshot it was still `in_progress`. This proves the recovery chain is firing, **not** that native cron delivery recovered.
- Fresh repository-wide inspection still showed newest native `event=schedule` = `35347508078` from **2026-09-18 21:58:18 KST**. Do not close native schedule/cadence GO until real consecutive `event=schedule` slots are observed.
- Audit (65)'s shorthand `F86 종합 excludes RP012/RP003` was incorrect. The actual production rule is **Sonogong + AutoPlus excluded from `종합`** (`RP012` / `RP023` by current canonical identities), while their own tabs remain available.

### Still authoritative

- Production engine pin: `cf940df642edf315adbc6da2b4134fbad53da160`.
- ERP5 canonical inventory registry: 24 providers; RP006 website, RP012 Sonogong ERP/API, RP023 RebornCar, RP031 current Google Sheet source.
- F01/F86 publish from the same fixed canonical snapshot path.
- F86 `종합` excludes Sonogong/AutoPlus; special-tab rules are otherwise unchanged.
- `contract-status.yml`, `sales-erp-hourly.yml`, and `mirror-sync.yml` remain schedule-free/manual dry-run paths at repository level; settlement scheduled apply remains intake→ledger only.
- RTDB/mirror paths are not canonical inventory authority.
- The `new_car_trim` → git snapshot writer from audit (65) remains a **derived/public-product projection**, not ERP5 canonical inventory authority.
- Existing RP023/RP031/deposit/vehicle-price/sales-tab/newest-Atom freshness/`/inventory` HOLDs remain open absent separate evidence.

### Claude next work

1. Keep native cron health separate from heartbeat/`workflow_run` recovery health; only real consecutive `event=schedule` runs close native cadence HOLD.
2. Preserve the working heartbeat recovery plane, but model and fail-close its `push.paths` + settlement→ERP5 `workflow_run` triggers in `docs/예약작업-지도.md` and CI governance.
3. Keep the Firestore→git product snapshot writer explicitly documented as a derived projection with its own freshness/trigger contract.
4. Preserve canonical source/projection rules unless separate evidence changes them.

Detail: `docs/ai-ssot-audit/2026-09-19-chatgpt-audit66-1205-native-miss-recovery.md`

Detail commit: `47519af466260d0eab916b1b659e76e74c189dcc`

No application code or business logic was modified by the auditor.
