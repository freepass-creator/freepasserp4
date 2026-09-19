# ChatGPT Independent SSOT Audit 71 — fallback burst can cancel a pending ERP5 chain

Verified: 2026-09-19 16:21 KST

## Finding

**MATERIAL / CONFLICT.** Audit 70 correctly kept native cron cadence on HOLD, but the recovery plane has now exposed a separate loss-of-chain condition.

- Repository-wide newest native `event=schedule` is still ERP5 run `35421826100`, created 2026-09-19 13:38:19 KST and completed `success`. No later native scheduled event was present at this audit snapshot.
- Watchdog heartbeat commit `5a5ec065b9dca6f26ac04c9e44951b97f8719b8a` recovered the missing 14:05 settlement slot. Settlement run `35427840415` (`event=push`) completed `success`, then ERP5 run `35427865515` (`event=workflow_run`) started at 15:54:11 KST and completed `success` at 16:07:36 KST.
- One minute later heartbeat commit `517e9a9ad7b86c67a29c2a9549e66133527e7129` recovered the 15:05 settlement slot. Settlement run `35427890549` completed `success`, but its downstream ERP5 run `35427915834` was `cancelled` before any job was created.
- At 15:57:40 KST, commit `a39ceb9fa5dcdac8a657e9e9f6f390c95f41aaa6` rewound the single heartbeat marker from 15:05 to 09:05 and triggered another production settlement recovery. Settlement run `35428022102` completed `success`; its downstream ERP5 run `35428047106` was created at 15:58:17 KST and later completed `success` with F86 freshness, F01↔F86 parity, and plate-photo audits passing.
- The timing is consistent with the declared ERP5 workflow concurrency contract. `erp5-ssot-refresh.yml` uses one `erp5-inventory-publish` concurrency group with `cancel-in-progress: false`; GitHub Actions permits only one pending run in a concurrency group by default, so a newer pending run replaces/cancels an older pending run. The 15:05 ERP5 run was cancelled at 15:58:18 KST, one second after the 09:05-replay ERP5 run was created, while the 14:05 ERP5 run was still running.
- Current `.automation/safe-chain-monitor.json` therefore contains a real chain hole: recovered 15:05 settlement production writes are marked complete, but ERP5 production writes are false and `lastChainFailure` preserves the cancelled run. At the same time `lastHeartbeatSlot` and `lastRecovery.expectedSlot` are now 09:05 even though later 14:05/15:05 recovery records already exist. Current heartbeat file also points to 09:05.

## Why this matters

The recovery plane is not merely telemetry. A heartbeat `push` is an apply path in `settlement-intake-sync.yml`: it runs intake→ledger with `--apply` and then applies ledger state/format normalization. Bursting or replaying old slots can therefore trigger live production work repeatedly, and multiple downstream ERP5 workflow runs can compete for the single pending concurrency slot. No duplicate ledger row or data corruption is proven in this audit, but **lossless recovery is not guaranteed under burst/backfill execution**.

A later green ERP5 replay proves the canonical engine still works; it does **not** retroactively make the cancelled 15:05 chain successful and must not be counted as native cadence proof.

## Repository comparison

- Current main before this audit write: `ce77d8504a66be51802f2f47c13f78e2dcce689a`.
- Production ERP5 pin remains `cf940df642edf315adbc6da2b4134fbad53da160`.
- Canonical inventory registry remains 24 providers; RP006 website, RP012 Sonogong ERP/API, RP023 AutoPlus/RebornCar, RP031 current Google Sheet source remain unchanged.
- F01 and F86 still publish from the same fixed ERP5 snapshot. F86 `종합` still excludes Sonogong and AutoPlus while their dedicated tabs remain available.
- `contract-status.yml`, `sales-erp-hourly.yml`, and `mirror-sync.yml` remain RETIRED/manual dry-run only. `MIRROR_SOURCES` still contains the RP023 old-sheet legacy mapping but has no automatic writer authority.
- RTDB/mirror paths remain non-canonical. The Vercel daily sheet sync remains separately env-gated by `SHEET_DAILY_SYNC_ENABLED=true`.
- Audit 67's standard quote-defaults source-trigger/freshness HOLD remains separate and unresolved.

## Claude handoff

1. Treat the fallback scheduler as **not lossless under burst/backfill** until slot selection and downstream serialization are made explicit.
2. Preserve monotonic/current recovery state; do not let an older slot overwrite `lastHeartbeatSlot`/`lastRecovery` after newer recovery slots have already been emitted unless that backfill is explicitly modeled separately.
3. Ensure multiple missed slots cannot cause an earlier pending ERP5 chain to be silently replaced. Claude should choose the implementation (serialize one recovery through completion, deduplicate/coalesce, or use an explicit multi-pending queue contract) and keep the existing canonical write gates intact.
4. Keep `lastChainFailure` for 15:05 open until that specific chain is reconciled with evidence; a later green replay is evidence of engine health, not evidence that the cancelled chain ran.
5. Native cron cadence/timeliness remains HOLD/WATCH independently.

No application code or business logic was modified by the auditor.
