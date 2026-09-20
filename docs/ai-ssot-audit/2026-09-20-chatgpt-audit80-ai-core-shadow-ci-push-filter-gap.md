# ChatGPT audit (80) — AI Core shadow adoption + main push-path guard gap

Date: 2026-09-20 KST
Role: independent SSOT auditor

## Finding

**MATERIAL IMPLEMENTATION / GOVERNANCE DRIFT. Production SSOT semantics remain unchanged, but the new AI Core contract shadow is not fail-closed on main-only changes.**

Current `origin/main` is `14056f8c2c3a7cc973d956b4f23929a4c420fb98` (`Merge C adoption refresh for ERP5 Core contracts and batch receipt`). Relative to audit (79)'s main (`606a761683345869400274e4dea360908d2622bf`), this merge adds the AI Core shadow contracts/checker and a non-blocking Core ingest receipt artifact path to the production ERP5 workflow.

Evidence:

- New shadow surfaces: `contracts/ai-core/erp5-products.source-registry.json`, `contracts/ai-core/erp5-product-refresh.pipeline.json`, `contracts/ai-core/erp5-sales-publish.pipeline.json`, `lib/domain/ai-core-contract-shadow.ts`, `scripts/check-ai-core-contract-shadow.mts`, and `scripts/core-contract/**`.
- `.github/workflows/erp5-ssot-refresh.yml` still pins the production engine to `cf940df642edf315adbc6da2b4134fbad53da160`. It checks out only the Core receipt helper from `${{ github.workflow_sha }}`, builds/uploads the receipt with `continue-on-error: true`, and therefore does not replace or relax the canonical ERP5 writer/publish path.
- Main push run `35479442674` for `14056f8...` completed `success`; its `source-contract` job passed `Canonical inventory source contract`, `AI Core Core Contract shadow`, `ERP5 Core receipt parser`, and `Workflow contract regression`.

## New conflict — `SSOT Source Contract` push filter omits the new shadow surfaces

`.github/workflows/ssot-source-contract.yml` has asymmetric path coverage:

- `pull_request.paths` includes `scripts/check-ai-core-contract-shadow.mts`, `lib/domain/ai-core-contract-shadow.ts`, and `contracts/ai-core/**`.
- `push.paths` does **not** include those three shadow surfaces; it currently ends with `scripts/core-contract/**`.

Therefore a future push/merge to `main` that changes only the AI Core contract JSON, the TypeScript shadow projection, or the shadow checker can land without triggering `SSOT Source Contract` on the resulting main commit. This matters because current `main` is not branch-protected and has no required status checks, so PR-only execution cannot be assumed as a fail-closed enforcement boundary.

This is a **CI/governance coverage gap**, not evidence that ERP5 canonical data is currently wrong. The merge's own contract CI is green, and the audited runtime boundaries below remain unchanged.

## Core SSOT boundaries rechecked

- Production ERP5 engine pin remains `cf940df642edf315adbc6da2b4134fbad53da160`.
- Canonical supplier/runtime registry remains the existing 24-source ERP5 collection path; the new Core source-registry JSON is a downstream SHADOW description of `freepasserp5/firestore/products`, not a replacement supplier registry.
- F01/F86 still publish from the same fixed ERP5 sales snapshot in the pinned production engine.
- Sonogong remains `오공구독` / `픽업구독`; AutoPlus remains `오플구독`; F86 `종합` excludes the Sonogong/AutoPlus special-channel sources while retaining their dedicated tabs.
- `mirror-sync.yml` and `sales-erp-hourly.yml` remain retired from automatic scheduling; mirror/RTDB paths remain non-canonical.
- Audit (67), (71), (76), and native cadence/timeliness HOLDs are not resolved by this merge.

## Claude implementation owner

1. Preserve the SHADOW/non-authoritative status of the new AI Core contracts and receipt artifacts.
2. Make `SSOT Source Contract` `push.paths` cover the same AI Core shadow surfaces that `pull_request.paths` covers, or otherwise establish an equivalent fail-closed main enforcement path.
3. Do not change the production pin, canonical writer ownership, F01/F86 snapshot contract, special-tab routing, or legacy-retirement boundaries as part of this audit finding unless independently required by direct evidence.

No application code or business logic was modified by the auditor.
