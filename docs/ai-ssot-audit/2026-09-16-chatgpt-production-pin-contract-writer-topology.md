# ChatGPT independent SSOT audit — production pin / contract gate / writer topology

Date: 2026-09-16
Auditor: ChatGPT
Scope: documentation/audit only. No application code or business logic changed.

## Evidence snapshot

- `main` observed at audit start/current implementation state: `a607a4e26d1be841c530a6b0bd504f65038408f4` (PR #319 merge).
- `.github/workflows/erp5-ssot-refresh.yml` now checks out production engine `1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f` and publishes/audits both F01 and F86.
- This means audit-log entry `(12)` is stale where it says production still pins `308511563...` and the F86 presentation implementation exists only on `codex/rtdb-cutover-current`.
- The production lineage now contains the F86 projection behavior previously identified as side-branch work: no `공지사항` recreation, aggregate-first plan, aggregate tab timestamp+count, supplier tabs without timestamp, long-fee-missing cars retained with blank fee cells, and value-based `구분`/`배차상태` formatting through the shared sales format path. Earlier implementation commit `1939018a8edb0f4993d61e12e5e0df4864ca9cb8` was explicitly live-published/verified before the subsequent production pin advanced to `1f923d27...`.

## New HOLD — source-contract allowlist rejects the live production pin

Current main `scripts/check-inventory-source-contract.mts` still approves only these validated engines:

- `404de5...`
- `627246...`
- `baaed18...`
- `308511563d8e8f56dbd94f715469d8ae7ed9171a`

It does **not** approve current production pin `1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f`.

Current-main GitHub Actions proof:

- workflow: `SSOT Source Contract`
- run: `35058214607`
- job: `104672754543`
- conclusion: `failure`
- exact failure: `.github/workflows/erp5-ssot-refresh.yml: checkout ref 1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f is not an approved validated engine`

This is a repository governance/CI contract drift. It does not by itself prove the pinned engine's runtime publish fails, because the production workflow checks out the engine before running its own checks; nevertheless main currently cannot certify its own declared production pin.

## Unresolved — pickup-subscription canonical color

At production pin `1f923d27...`, `lib/domain/category-colors.ts` still has canonical `MASTER_CATEGORY_COLORS['분류']['픽업구독'] = '#C2185B'`.

Therefore the side-branch/manual-publish teal `#0F766E` has still not become the canonical production SSOT. Audit entry `(11)` remains valid on this point.

## Writer-topology correction

`.github/workflows/sales-erp-hourly.yml` must not be treated as merely theoretical/UI-disabled history.

- It still has a schedule and defaults `SALES_ERP_CLOUD_SCHEDULED_SYNC_ENABLED` to `true` when the repository variable is absent.
- Scheduled run `34955061603` was actually dispatched on 2026-09-15 and failed.
- PR #317 / commit `330ada9569f6b6bcff28d1cead8132b388136ad9` explicitly fixed the recurring workflow's missing Sonogong credential-preparation path; the commit message states the workflow had been dying every cycle because `.손오공계정.json` was not prepared despite secrets existing.

Claude should therefore treat this as an active-capable scheduled writer and verify/lock its ownership boundary against ERP5 projection rules, rather than assuming it is dormant.

`mirror-sync.yml` is different: its job is fail-closed behind explicit `vars.MIRROR_SYNC_ENABLED == 'true'`, so no new active conflict was found there in this audit.

## No new drift found

- ERP5 canonical source registry remains RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar.
- Sonogong/AutoPlus special-tab routing remains separated with supplier-specific period/fee axes preserved.
- No new RTDB-canonical regression was found.

## Auditor decision

**HOLD** for SSOT governance acceptance until:

1. the validated-engine contract recognizes the actual production pin and `SSOT Source Contract` is green again;
2. a normal production scheduled cycle on the current pin is observed/recorded after the repin;
3. pickup-subscription color is resolved only through `MASTER_CATEGORY_COLORS['분류']`, not channel-local hardcoding; and
4. `sales-erp-hourly.yml` writer ownership is explicitly reconfirmed so it cannot become a second canonical inventory writer.
