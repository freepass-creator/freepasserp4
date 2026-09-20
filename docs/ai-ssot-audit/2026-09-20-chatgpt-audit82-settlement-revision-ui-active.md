# ChatGPT independent audit (82) — settlement revision guard and first-party UI adoption are live

Date: 2026-09-20 KST

## Judgment

**MATERIAL IMPLEMENTATION CHANGE / CLAUDE ENTRY POINT STALE / production ERP5 SSOT boundary unchanged.**

Audit (81) was accurate for `0b3f9d13ef12a86a6e83ac3c95d2c6985c08226c`: the settlement-intake AI Core mapping was SHADOW-only and the settlement route itself had not changed. That summary is no longer current.

Two post-audit merges moved the bounded settlement update path from documentation-only SHADOW mapping to an active ERP4 runtime concurrency guard, then activated that guard in both first-party settlement UIs:

- PR #441 / merge `8e4bcb7a484f1ae024f05297923be100d8a21628` — server-side optimistic revision guard.
- PR #442 / merge `1b31af44fac362085649c13d155e4e0c089ae929` — first-party UI transport and conflict handling.

## Evidence

1. **ERP4 runtime now exposes an authoritative resource revision from Firestore metadata.**
   - `app/api/settlement/board/route.ts` derives `resource_revision` from `DocumentSnapshot.updateTime` in the opaque form `firestore:<seconds>:<nanoseconds>`.
   - The revision is returned for line-detail reads, list rows, and successful guarded updates.
   - The list projection writes the computed metadata revision after document data, so a stale payload field cannot override the Firestore metadata source.

2. **Guarded updates are real runtime behavior, not only a SHADOW contract.**
   - `POST /api/settlement/board` accepts optional `expected_revision` when `body.id` is present.
   - When supplied, the route performs Firestore transaction read/compare/write.
   - A stale revision returns HTTP 409 with `code=VERSION_MISMATCH`, the expected revision, and the actual revision; the stale write is not applied.
   - Calls that omit `expected_revision` remain on the compatibility path. This preserves legacy/external callers but means optimistic concurrency is not globally mandatory yet.

3. **Both first-party settlement UIs now actively send the revision.**
   - `app/settlement/board/page.tsx` and `app/settlement/intake/page.tsx` serialize `expected_revision` on edits and receive `VERSION_MISMATCH` / `resource_revision`.
   - `components/settlement/SettlementBoard.tsx` and `components/settlement/IntakeStation.tsx` pass the row revision to `api.edit(...)`; stale conflicts show a user message and reload current data.
   - Intake line-detail reads also refresh the selected row revision before later edits.

4. **The AI Core contract remains explicitly SHADOW_WITH_GAPS; this is not an AI Core cutover.**
   - `contracts/ai-core/settlement-update.api-shadow.json` keeps `runtime_owner=ERP4`, `runtime_authority_preserved=true`, `cutover_authorized=false`, compatibility mode `OPTIONAL_EXPECTED_REVISION`.
   - First-party adoption is recorded as `ACTIVE`, while request/correlation IDs and full `core.error.v1` / `core.result.v1` envelopes remain gaps.
   - `scripts/check-ai-core-api-shadow.mts` now fail-closes the revision token, transaction guard, first-party serialization, conflict handling, and reload behavior.

5. **Main CI is green for the active implementation.**
   - PR #441 resulting main checks: generic CI run `35507964978` success; `SSOT Source Contract` run `35507965001` success.
   - PR #442 resulting main checks: generic CI run `35508944501` success; `SSOT Source Contract` run `35508944490` success.

6. **ERP5 production SSOT and projection boundaries did not move.**
   - `.github/workflows/erp5-ssot-refresh.yml` remains pinned to production engine `cf940df642edf315adbc6da2b4134fbad53da160`.
   - The 24-source canonical registry is unchanged; RP012 Sonogong remains `https://sokrc.com/api`, RP023 AutoPlus remains `https://www.reborncar.co.kr`.
   - One fixed ERP5 snapshot still feeds F01 and F86 in the same workflow and is cross-audited.
   - F86 `종합` still excludes `손오공` and `오토플러스` while keeping their dedicated tabs. Product types retain Sonogong `오공구독` / `픽업구독` and AutoPlus `오플구독`.
   - `.github/workflows/mirror-sync.yml` and `.github/workflows/sales-erp-hourly.yml` remain manual dry-run-only retired paths. The old RP023 mirror Sheet remains legacy/non-canonical and there is no evidence of an RTDB or mirror writer reactivation.

7. **The subsequent Data Hub handoff is documentation-only.**
   - Commit `6188a9ea6b22a7513e51c325384c8558201708e2` adds `docs/handoffs/FREEPASS-DATA-HUB-ERP5-HANDOFF-2026-09-20.md` and does not change the production writer, canonical source registry, F01/F86 publisher, or runtime writer topology.

## Existing OPEN items not resolved here

- Audit (67): standard quote-defaults projection freshness trigger gap.
- Audit (71): shared ERP5 concurrency / pending-replacement hazard and unreconciled 15:05 cancelled-before-job chain.
- Audit (76): fallback recovery replayed an already-successful native 18:05 settlement slot.
- Native schedule cadence/timeliness remains HOLD until stable consecutive native schedule evidence exists.

## Claude implementation owner handoff

Treat Audit (81)'s statement that the settlement Core work is only a route-unchanged SHADOW mapping as **stale**. Preserve the now-active ERP4 optimistic revision guard and first-party UI transport. Do **not** reinterpret this as AI Core runtime cutover, ERP5 canonical writer migration, or authorization to widen settlement business semantics. Legacy/external callers may still omit `expected_revision` by compatibility design; widening that boundary is a separate implementation decision for Claude's single SSOT session.

No application code or business logic was modified by the auditor.
