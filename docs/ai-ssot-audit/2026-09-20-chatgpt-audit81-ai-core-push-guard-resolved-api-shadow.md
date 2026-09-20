# ChatGPT independent audit (81) — AI Core main-push guard resolved; settlement intake API remains SHADOW

Date: 2026-09-20 KST

## Judgment

**RESOLVED / MATERIAL IMPLEMENTATION CHANGE / production SSOT semantics unchanged.**

Audit (80) correctly identified that `.github/workflows/ssot-source-contract.yml` watched the AI Core SHADOW surfaces on pull requests but omitted them from the `main` push path filter. That exact governance gap has now been fixed and is runtime-proven on `main`.

## Evidence

1. **Audit (80) push-path gap is resolved by PR #439.**
   - Commit: `d81c97fccc37566aa97e67d133dca6341bf42721` (`fix(ci): cover AI SSOT push paths (#439)`).
   - Current `.github/workflows/ssot-source-contract.yml` `push.paths` now includes:
     - `scripts/check-ai-core-contract-shadow.mts`
     - `lib/domain/ai-core-contract-shadow.ts`
     - `contracts/ai-core/**`
   - The PR path list and main-push path list now cover the AI Core SHADOW surfaces that audit (80) called out.

2. **The fix is proven on the resulting `main` push, not only on a PR.**
   - Current main commit `0b3f9d13ef12a86a6e83ac3c95d2c6985c08226c` adds another AI Core contract file under `contracts/ai-core/**`.
   - That push created `SSOT Source Contract` run `35507383468` with `event=push`; it completed `success`.
   - Therefore the specific audit (80) failure mode — an AI Core shadow-only main change landing without a Source Contract main-push run — is no longer current.

3. **PR #440 is a new implementation change, but it is explicitly non-authoritative SHADOW.**
   - Commit: `0b3f9d13ef12a86a6e83ac3c95d2c6985c08226c` (`feat(ai-core): bind settlement intake write API as SHADOW pilot (#440)`).
   - Added `contracts/ai-core/settlement-intake.api-shadow.json` and `scripts/check-ai-core-api-shadow.mts`, and wired the specialized checker into generic `.github/workflows/ci.yml`.
   - The SHADOW contract explicitly states:
     - `runtime_owner = ERP4`
     - `runtime_authority_preserved = true`
     - `cutover_authorized = false`
     - `external_response_shape_changed = false`
   - It records missing Core request/correlation/idempotency/revision/result-envelope capabilities as gaps instead of pretending runtime cutover has happened.
   - Generic CI run `35507383421` for the same `main` commit completed `success`.
   - The commit does not modify `app/api/settlement/board/route.ts`; the checker verifies the existing project-native admin/auth, deterministic SHA-256 receipt identity, Firestore `create()`, 409 duplicate behavior, and current response/error shapes.

4. **Canonical production SSOT boundaries did not move.**
   - `.github/workflows/erp5-ssot-refresh.yml` remains pinned to `cf940df642edf315adbc6da2b4134fbad53da160`.
   - ERP5 still uses the 24-source canonical registry.
   - F01/F86 remain projections from the same fixed snapshot.
   - F86 aggregate still excludes Sonogong/AutoPlus while retaining their dedicated tabs; Sonogong remains `오공구독` / `픽업구독`, AutoPlus remains `오플구독`.
   - `mirror-sync.yml` and `sales-erp-hourly.yml` remain retired/manual dry-run paths; the RP023 old mirror Sheet remains non-canonical and RP023 canonical inventory remains RebornCar.

## Existing OPEN items not resolved by this change

- Audit (67): `standard-quote-defaults.snapshot.json` source-trigger/freshness gap.
- Audit (71): shared ERP5 concurrency / pending-replacement hazard and unreconciled 15:05 cancelled-before-job chain.
- Audit (76): fallback recovery replayed an already-successful native 18:05 settlement slot.
- Native direct schedule cadence/timeliness remains HOLD until stable consecutive `event=schedule` evidence exists.

## Claude implementation owner handoff

Treat audit (80)'s AI Core Source Contract main-push coverage gap as **RESOLVED**. Preserve the AI Core contracts and settlement-intake API mapping as **SHADOW / non-authoritative**; do not infer runtime cutover from CI success. No canonical source, writer, F01/F86, special-tab, mirror/RTDB, or settlement business-semantics change is requested by this audit.

No application code or business logic was modified by the auditor.
