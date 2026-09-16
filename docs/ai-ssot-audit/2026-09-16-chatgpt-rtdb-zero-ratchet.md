# ChatGPT independent SSOT audit — RTDB direct-open zero ratchet / remaining governance holds

Date: 2026-09-16
Auditor: ChatGPT
Scope: documentation/audit only. No application code or business logic changed.

## Evidence snapshot

- Current `main`: `294ecce4eb84109bd2e5244a89dca11fa0446cd7` (PR #320 merge).
- PR #321 / commit `fa8915319afbd0c61affe01d99895db0e5ef9c8a` changed the RTDB direct-open checker from a production-code-dependent self-test to synthetic in-memory test samples and wired `npm run check:store` into `.github/workflows/ci.yml`.
- `scripts/check-store-canon.mts` now records the app/lib/components direct RTDB-open baseline as `0`; the only excluded doors are the three explicit swap/adapter gates (`lib/server/firebase-admin.ts`, `lib/server/firestore-ref-shim.ts`, `lib/firebase/rtdb-adapter.ts`).
- Latest main CI run `35062421549` at head `294ecce4...` completed `success`, so the new RTDB direct-open ratchet is not merely code-present; it is currently CI-enforced and green.

## Resolved — direct RTDB openings outside the swap/adapter gates are now zero and CI-ratcheted

This is a meaningful implementation improvement after audit entry `(14)`.

Before PR #321, the checker carried a stale baseline of 24 and its self-test depended on a real production file remaining RTDB-dirty. After the Firestore cutover cleaned that file, the checker could report its own self-test as broken while the repository had actually improved. PR #321 replaced that control with synthetic samples covering static/admin imports, dynamic import, `require`, re-export and concatenated specifiers, plus negative controls for comments, strings and Firestore imports.

Current result: direct production openings detected under `app`, `lib`, `components` = **0**. The baseline is also **0**, so any newly introduced direct opening makes `check:store` fail rather than allowing the old 24-file budget to hide a regression.

This resolves the **direct RTDB-door debt** previously described in older documentation.

## Important boundary — RTDB zero does not resolve writer topology

The above result must not be interpreted as “all legacy writers are gone.” Current main still contains two independent scheduled, write-capable paths:

- `.github/workflows/mirror-sync.yml`
  - cron `*/30 * * * *`
  - no repository-level `MIRROR_SYNC_ENABLED`/equivalent fail-closed guard
  - scheduled execution runs `scripts/sync-mirror-all.mts --apply`
- `.github/workflows/sales-erp-hourly.yml`
  - cron `0 0-9 * * 1-5`
  - scheduled execution runs `scripts/cloud-hourly-sync.mts --apply`, which continues into the legacy hourly sheet/ERP pipeline

`lib/domain/mirror-sources.ts` also still defines RP023 AutoPlus mirror input as the old Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`, while canonical `lib/domain/inventory-source-registry.ts` correctly keeps RP023 on RebornCar.

Therefore audit `(14)` remains valid: `mirror-sync.yml` and `sales-erp-hourly.yml` are **active-capable scheduled writers** at repository level until ownership/disable is made explicit. PR #321 does not close that SSOT topology issue.

## HOLD unchanged — main Source Contract still rejects the current production pin

Current `.github/workflows/erp5-ssot-refresh.yml` checks out:

- `1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f`

Current main `scripts/check-inventory-source-contract.mts` still has a validated-engine list ending at `308511563d8e8f56dbd94f715469d8ae7ed9171a` and does not include `1f923d27...`.

The previously recorded `SSOT Source Contract` run `35058214607` therefore remains the relevant governance failure: main cannot certify its own declared production engine. Latest generic `CI` being green does **not** supersede that separate SSOT contract failure.

## Current production evidence boundary

The latest observed scheduled `ERP5 SSOT 원천 최신화(매시간)` success is run `35053074482` (run #15), but it occurred before PR #318/#319 advanced the production ref to `1f923d27...`. It therefore cannot be used as proof of a normal scheduled production cycle on the current pin.

No post-repin scheduled success was observed in the current Actions listing at audit time. This does not prove the cron is broken or disabled; it means only that the existing audit requirement — observe/record a normal scheduled cycle on `1f923d27...` — remains pending.

## Other current SSOT conclusions unchanged

- Production `1f923d27...` still has `MASTER_CATEGORY_COLORS['분류']['픽업구독'] = '#C2185B'`; the requested canonical pickup-subscription color change is not yet resolved in production SSOT.
- F86 production lineage contains the current presentation rules: no F86 notice tab, `종합` first and timestamped, supplier tabs without timestamp, long-fee-missing cars retained with blank fee cells, shared value-based formatting path.
- Canonical inventory registry remains RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=`reborncar.co.kr`.
- Sonogong remains `손오공구독`; AutoPlus remains `오플구독`; supplier-specific period/mileage/fee axes are preserved.

## Auditor decision

**Resolved:** direct app/lib/components RTDB openings outside the swap/adapter gates are now zero and protected by main CI.

**Still HOLD / unresolved:**

1. add/validate the actual production pin `1f923d27...` in the Source Contract and restore that gate to green;
2. obtain a normal scheduled production F01/F86 full-audit success on the current pin;
3. resolve pickup-subscription color only through `MASTER_CATEGORY_COLORS['분류']` and verify live output after regular production publish;
4. explicitly settle repository-level ownership/disable for `mirror-sync.yml` and `sales-erp-hourly.yml`; RTDB direct-open zero must not be used as evidence that those writers are retired;
5. keep RP023 canonical source on RebornCar and never promote the old mirror Sheet to canonical authority.
