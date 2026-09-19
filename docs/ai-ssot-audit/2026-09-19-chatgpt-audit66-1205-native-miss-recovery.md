# Audit 66 — 12:05 native schedule miss + recovery-plane verification

Date: 2026-09-19 KST
Role: ChatGPT independent SSOT auditor. Claude remains the sole implementation owner.

## Finding

**MATERIAL / native cron HOLD strengthened; recovery plane remains functional.**

Audit (65) already recorded that the 11:05 KST settlement native slot did not produce a native `event=schedule` and required heartbeat recovery. The next configured settlement slot, **12:05 KST**, also failed to appear as a native scheduled event by the time recovery was invoked.

Evidence:

- Recovery commit: `4b36bfa5b3bc7a0b712f2e21d7c3bc45cfe89b79` — `chore(automation): recover missing settlement slot 2026-09-19 12:05 KST`.
- Settlement recovery run: `35418898632`, workflow `정산 접수→원장(1시간)`, `event=push`, completed **success**.
- The recovery then created ERP5 run `35418926531`, workflow `ERP5 SSOT 원천 최신화(매시간)`, `event=workflow_run`, created 2026-09-19 12:34:24 KST. At this audit snapshot it was still `in_progress`; this is recovery-chain evidence, not native-cron evidence.
- Fresh repository-wide `event=schedule` inspection still shows the newest native scheduled run as `35347508078` from **2026-09-18 21:58:18 KST**, conclusion `success`. No 2026-09-19 native settlement/ERP5 slot has superseded it in the observed run list.

Therefore the correct operational conclusion is not “cron recovered.” It is:

1. **Native schedule/cadence remains HOLD**, now with another consecutive missing settlement slot after audit (65).
2. The **heartbeat → settlement push → ERP5 workflow_run recovery plane is functioning** and is successfully preventing the missed settlement slot from becoming a silent no-op.
3. Recovery events must not be counted as native `event=schedule` proof.

## Repository-state comparison

No new regression was found in the core SSOT contracts after audit (65):

- production engine pin remains `cf940df642edf315adbc6da2b4134fbad53da160`;
- the ERP5 canonical source registry remains 24 providers, including RP006=Iron website, RP012=Sonogong ERP/API, RP023=RebornCar, RP031=current Google Sheet source;
- F01 and F86 still publish from the same fixed ERP5 snapshot;
- F86 summary policy remains `종합` excluding **Sonogong and AutoPlus** while their own tabs remain available;
- `contract-status.yml`, `sales-erp-hourly.yml`, and `mirror-sync.yml` remain schedule-free/manual dry-run paths at repository level;
- settlement scheduled apply remains intake→ledger only and does not reconnect `sync-contract-from-ledger.mts`;
- mirror/RTDB legacy paths remain non-canonical inventory authority.

The existing governance gap from audits (63)/(65) remains: `docs/예약작업-지도.md` and `scripts/check-schedule-map.mts` are still primarily cron-oriented and do not fully model/fail-close the heartbeat `push.paths` + settlement→ERP5 `workflow_run` production recovery plane.

The audit (65) derived `new_car_trim` → git snapshot writer remains a derived/public-product projection and was not promoted to canonical inventory authority in this delta.

## Claude handoff

- Keep native cron GO/HOLD separate from recovery-plane health; only real consecutive `event=schedule` runs can close native cadence HOLD.
- Preserve the working recovery path while documenting and CI-guarding its non-cron triggers.
- Correct the Claude entry-point shorthand for F86 summary exclusion to Sonogong/AutoPlus (RP012/RP023); audit (65)'s `RP012/RP003` wording is stale/incorrect.
- Do not change application code/business logic based on this audit alone.

No application code or business logic was modified by this audit.
