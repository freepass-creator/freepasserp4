# Audit 83 — latest main SSOT verification chain red; Production Deploy Recovery blocked

Date: 2026-09-21 KST
Role: independent auditor only. Claude remains the sole implementation owner.

## Verdict

**MATERIAL REGRESSION / CI-GOVERNANCE HOLD + PRODUCTION-RECOVERY HOLD. ERP5 canonical authority itself is unchanged.**

Audit (82)'s settlement revision-guard/UI-adoption conclusion remains valid, but its green-main verification snapshot is no longer sufficient for current `origin/main`.

## Evidence

1. Last audited application baseline was followed by a new white-label UI/design sequence. Current `origin/main` at audit time is `15d9e651669bdfbc0368643d38d013fcea35e3c2` (`test(shop): update locked notice dismiss contract`). Its generic CI run `35544887444` finished `failure`.
2. In that run, Typecheck, font-token guard, design-token guard, and shop-grid check passed; step 9 `확정 디자인 — 손님 동 규격이 그대로인가` failed. Every later verification step was skipped, including `ERP4 MAIN — 제품 경계·규격 Stability Lock`, `ERP5 canonical Firebase 경계가 잠겼는가`, `RTDB 스왑점 밖 직접 열기`, `RTDB 폐기 빗장`, Firestore feed/parity checks, settlement lock, `AI Core API SHADOW — 정산 신규접수`, simulations, and Production build.
3. This means the latest main is **not fully SSOT-CI verified**. It does **not** mean those skipped guards are known to fail; they were not executed because the earlier confirmed-design gate stopped the job.
4. The current shop-card implementation intentionally uses `manShort(price.rent, { decimal: true })` for list-only compact display and explicitly preserves exact won values for detail/contract/settlement. The current design-lock checker has already been updated to require this compact ShopCard form and exact money on ShopDetail. Therefore this audit does not claim canonical money corruption or attribute the remaining design-gate failure to the rental formatter without direct log evidence. The material fact is the unresolved red gate and the resulting loss of downstream SSOT verification on current main.
5. A separate production-recovery path is also red. `Production Deploy Recovery` run `35544475310` for commit `34a7279edc502cd3e96d1a4973d946c416b42609` failed at `배포 자격 확인`; Install, main-state verification, Deploy Hook, Vercel link, and CLI production deploy were skipped. The workflow requires at least one of `VERCEL_DEPLOY_HOOK` or `VERCEL_TOKEN`, so neither was available to that job. No later green `Production Deploy Recovery` was observed in the audit window.
6. This only proves the repository's **recovery workflow did not perform a deploy** in that run. It is not evidence that an external/native Vercel Git integration did or did not deploy production.

## Canonical SSOT boundary cross-check

No new authority drift was found in the core paths reviewed for this audit:

- ERP5 production engine pin remains `cf940df642edf315adbc6da2b4134fbad53da160`.
- ERP5 canonical source registry remains the 24-source registry.
- F01/F86 remain projections of the same fixed snapshot; F86 aggregate rules continue to exclude Sonogong/AutoPlus general rows where dedicated-channel rules apply.
- Sonogong dedicated tabs remain `오공구독` / `픽업구독`; AutoPlus remains `오플구독`.
- `mirror-sync` and `sales-erp-hourly` remain retired from automatic ERP5 SSOT writing; RTDB/mirror remain non-canonical legacy paths.
- Audit (82)'s active ERP4 settlement optimistic revision guard + first-party `expected_revision` transport remain valid; AI Core remains `SHADOW_WITH_GAPS` / non-authoritative.

Existing OPEN/HOLD items remain: audit (67) quote-default projection freshness, audit (71) shared ERP5 concurrency/pending-replacement + 15:05 cancelled-before-job reconciliation, audit (76) false replay of an already-successful native settlement slot, and native schedule cadence/timeliness HOLD.

## Claude implementation-owner action

Treat current main as **CI HOLD** until the confirmed-design gate and implementation are reconciled and a fresh main CI run executes the downstream SSOT guards through green. Do not infer that the skipped SSOT guards themselves are broken. Separately, if `Production Deploy Recovery` is intended to be an operational recovery path, restore/authorize one of its declared deployment credentials and obtain a green recovery run; do not conflate that with external Vercel auto-deploy state.

Do not change canonical source/writer ownership, F01/F86 semantics, special-tab rules, RTDB/mirror authority, or settlement business semantics on the basis of this audit.

No application code or business logic was modified by the auditor.
