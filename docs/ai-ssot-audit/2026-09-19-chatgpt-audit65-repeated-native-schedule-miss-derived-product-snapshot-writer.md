# Audit (65) — repeated native schedule miss + derived new-car product snapshot writer

Date: 2026-09-19 KST
Role: ChatGPT independent auditor only
Application/business-logic changes by auditor: none

## Verdict

**MATERIAL.** Audit (64)'s recovery-plane PASS remains valid, but native cron delivery has still not recovered: the next settlement slot at **2026-09-19 11:05 KST** again required heartbeat recovery. Separately, current main gained a new **derived public-product snapshot writer** after audit (64): Firestore `new_car_trim` → repository snapshot `data/new-car/current-feed.snapshot.json`. This path is not part of the ERP5 canonical inventory registry and must not be promoted to inventory authority implicitly.

A governance bookkeeping drift was also found: `CLAUDE-AUDIT.md` already points to audit (64), and the dated audit (64) detail exists, but `docs/AI-SSOT-AUDIT-LOG.md` currently ends at audit (63). The central append-only ledger therefore missed audit (64).

## 1. Native schedule: repeated miss, recovery plane still green

Evidence checked against current repository/Actions state:

- Current safe settlement workflow remains `.github/workflows/settlement-intake-sync.yml` with native cron `5 0-9 * * 1-6` (KST Mon-Sat 09:05–18:05), plus the path-restricted heartbeat push fallback.
- Current ERP5 workflow remains `.github/workflows/erp5-ssot-refresh.yml` with native cron `17 0-10 * * 1-6` (KST Mon-Sat 09:17–19:17), heartbeat push fallback, and settlement `workflow_run` chaining.
- The production ERP5 engine pin is unchanged at `cf940df642edf315adbc6da2b4134fbad53da160`.
- Audit (64) already proved a heartbeat settlement recovery and a chained full ERP5 green, but kept native `event=schedule` on WATCH.
- The **11:05 KST settlement slot again did not materialize natively**. Commit `3bba8325681b8b55770a54e48ec1f453a6eaee36` explicitly records `chore(automation): recover missing settlement slot 2026-09-19 11:05 KST` and only advances `.automation/heartbeats/settlement-intake-sync.txt`.
- Recovery run **`35416904804`** completed successfully.
- Commit `7d16ac4a3a6f36628dfe685733676f20f6d60f6f` records the corresponding safe-chain ERP5 recovery/follow-on, and ERP5 run **`35416937797`** completed successfully.
- A fresh repository-wide `event=schedule` query still shows **`35347508078`** (ERP5, created 2026-09-18 21:58:18 KST, success) as the newest native scheduled run. The heartbeat `push` and `workflow_run` recovery executions are not native cron proof.

### Audit decision

- **Recovery plane:** PASS / functioning.
- **Native cron delivery/cadence:** HOLD / repeated missing evidence, not recovered.
- Do not infer a GitHub scheduler outage or workflow-disabled state without direct runtime-state evidence. The only safe statement is that the configured native schedule did not produce the expected 11:05 event and fallback recovery was required again.
- Do not use successful heartbeat or `workflow_run` executions as substitutes for native `event=schedule` evidence.

## 2. New writer topology after audit (64): Firestore product feed → git snapshot

Post-audit-(64) commits added a new public-product snapshot path:

- `df3a97db3dbd181612b5f8a486bdd29318342efa` — adds `scripts/export-newcar-public-snapshot.mts`.
- `dbf0f2cda8c82ad70c36a19bb89a0244cbf8d321` — adds `.github/workflows/export-newcar-public-snapshot.yml`.
- `aa2c8e6b5ca87f48c86b48afc1bd94411c8fd9ef` — normalizes the snapshot output against the public API shape.

Current path:

```text
Firestore `new_car_trim`
  → scripts/export-newcar-public-snapshot.mts
  → data/new-car/current-feed.snapshot.json
  → .github/workflows/export-newcar-public-snapshot.yml
  → bot commit back to main when snapshot changes
```

The workflow currently has `workflow_dispatch` and path-scoped `push` triggers for the exporter/workflow definition. It does **not** itself declare a cron or a Firestore-change event trigger. Therefore changes in `new_car_trim` alone are not, from this workflow definition, sufficient proof that the repository snapshot will be refreshed automatically.

### Authority boundary

This new path is a **derived/public-product projection**, not a new ERP5 canonical inventory source:

- `lib/domain/inventory-source-registry.ts` remains the 24-source inventory authority registry.
- RP006 remains Iron website.
- RP012 remains Sonogong ERP/API.
- RP023 remains RebornCar.
- RP031 remains its current Google Sheet canonical source.
- No evidence was found that this new snapshot writer changes the canonical inventory registry, F01/F86 source lineage, or production pin.

Claude should therefore document/guard this new writer as a downstream public-product feed and define its freshness semantics separately. It must not be treated as canonical inventory authority merely because it is committed into `main`.

## 3. Central audit ledger drift

Current `CLAUDE-AUDIT.md` points to audit (64), and the dated audit (64) detail exists at:

- `docs/ai-ssot-audit/2026-09-19-chatgpt-audit64-chained-erp5-full-green-native-schedule-watch.md`

However, the live `docs/AI-SSOT-AUDIT-LOG.md` ends at **audit (63)**. This is an append-only ledger gap. The audit recorder for this audit should backfill a concise audit (64) summary before appending audit (65), without rewriting prior entries.

## 4. Unchanged conclusions

No new evidence in this review changes these conclusions:

- ERP5 production pin remains `cf940df642edf315adbc6da2b4134fbad53da160`.
- Canonical inventory registry remains 24 providers.
- F01/F86 still publish from the fixed canonical snapshot path.
- F86 `종합` exclusion remains RP012 Sonogong + RP003 AutoPlus KM1; the Sonogong/AutoPlus special-tab model remains unchanged.
- Retired automatic legacy writers remain retired at repository level: `contract-status.yml`, `sales-erp-hourly.yml`, and `mirror-sync.yml` are manual-only; the old `settlement-sync.yml` was replaced by safe `settlement-intake-sync.yml`.
- RTDB/mirror paths are not canonical inventory authority.
- Existing business/provenance HOLDs remain open absent new proof: RP023 mirror debt, RP031 provenance/migration, special-tab deposit single-definition/lineage, vehicle-price lineage, sales-tab naming, newest-Atom freshness, and `/inventory` ERP4 write-boundary work.

## Claude implementation-owner handoff

1. Keep native schedule/cadence GO blocked until real `event=schedule` executions are observed at multiple configured slots; do not count heartbeat or `workflow_run` recovery as native-cron proof.
2. Bring `docs/예약작업-지도.md` and the schedule checker into parity with the approved heartbeat `push.paths` + settlement→ERP5 `workflow_run` recovery plane so CI can distinguish native schedule from fallback execution.
3. Add the new Firestore→git product snapshot path to the writer-topology documentation/guard as a **derived public product projection**, including an explicit freshness/trigger contract.
4. Preserve the ERP5 canonical inventory boundary and all existing F01/F86/Sonogong/AutoPlus/mirror/RTDB HOLDs unless separate evidence closes them.

No application code or business logic was modified by this audit.
