# Sheet Contract v1 — 2026-09-21

Status: HOLD. This task made no production mutation, merge or dispatch. A concurrent actor merged #453 and dispatched the old full pipeline; see the incident note below.

## Contract and implementation

- Machine-readable SSOT: `contracts/sheets/sheet-contract-v1.json`.
- Formatter/manifest: `lib/domain/sales-sheet-banner.ts`.
- Shared F01/F86 planner/auditor: `lib/domain/sheet-contract-plan.ts`.
- Existing publishers preserve the original-text widths by header via `lib/server/sheet-contract-format.ts`; CLIP is applied after either formatter.
- New narrow executor: `scripts/apply-sheet-contract.mts`, dispatched only by `.github/workflows/sheet-formatting-only.yml` (`Sheet Contract 표시 전용`). Reuses `GOOGLE_SA_JSON`, `pyh@teamjpk.com`, and `production-sheet-write-gate`; no new secret or IAM grant.
- Regression: `scripts/sim-sales-sheet-banner.mts`, included in `check:sync`.

The current instruction supersedes the initial upper-cell interpretation: the banner is the actual worksheet title. Internal identities and logical order remain 상품리스트, 손오공상품, 픽업구독, 오플구독. Display names are 상품리스트, 손오공, 픽업, 오플. Only the first title contains MM-dd HH:mm. Counts are actual tab data rows, not example totals or sums including repeated supplier tabs.

Source-name columns (차명(원본)/차명(원문)) have a 180px floor, source-option columns (옵션(원본)/옵션(원문)) a 320px floor. Preserve any larger width. CLIP avoids overflow while preserving row heights. Values/formulas, headers, order, filters, freezes, merges, protections and unrelated user formatting are outside this change.

## Live read-only evidence

Raw rows remain in ignored local `tmp/banner-review/`, never Git or review prompts.

| Target | Read timestamp (UTC) | First four row counts | Extra / drift |
| --- | --- | --- | --- |
| F01 | 2026-09-21T06:30:38.665Z | 385 / 41 / 223 / 54 | Separate 오공구독 tab with 59 rows: HOLD, no merge/delete |
| F86 | 2026-09-21T06:30:50.967Z | 385 / 59 / 223 / 54 | Supplier tabs repeat product-list rows; not added to first-tab count |

F01 observed titles: 상품리스트 09.21 15; 손오공상품 09.21 10:39:41 · 41대; 픽업구독 09.21 15; 오플구독 09.21 15. F86 first four were canonical bare names. No titles were changed. Visible data grids contained no formulas; F01 hidden/user-sheet formula coverage remains unverified.

Both sheets' source columns by logical tab: product X/Y, Sonogong Y/Z, pickup AA/AB, Autoplus X/Y. Longest option text lengths: F01 161/75/73/860 characters; F86 161/105/73/860. Representative source cells were CLIP in F01 and OVERFLOW_CELL in F86. Actual pixelSize and protection metadata were unavailable through the current connector response. No guessed width is used.

The default gws account was verified as pyh@teamjpk.com. Its current scopes contain Gmail/userinfo only. Both Sheets metadata and Drive revision read attempts failed with 403 insufficient scopes. No new credential, login or scope workaround was attempted. Drive connector supplied the row snapshots; its modifiedTime was 2026-09-21T06:09:03.207Z (F01), 2026-09-21T06:09:22.440Z (F86). Drive revision is UNAVAILABLE, not inferred from those times.

## Execution and rollback boundary

The existing ERP5 refresh is NOT an appropriate way to apply display-only approval: it ingests, writes Firestore and republishes data. The new workflow has only workflow_dispatch, no schedule; one allowlisted target per run. It shares the ERP5 publisher concurrency group. A dry-run records fresh full metadata and a content/revision hash; an apply requires the exact reviewed code commit, hash and timestamp. A fresh read immediately before the single batchUpdate must still match. Unknown reference/protection/formula state, duplicate tab identities or drift fail before writing.

`contracts/sheets/reference-audit.json` is deliberately UNAVAILABLE. The executor cannot apply until Apps Script/external consumer evidence is supplied for the exact snapshot and contract hash. An empty list or a skipped check is not verification. Formula/protection conflicts are conservatively HOLD pending review.

Immediate readback compares title/width/wrapping and a hash of every non-owned field. No automatic mutation retry or rollback is performed. The workflow emits sanitized plan/failure/readback receipts and rollback requests, never raw vehicle records. Rollback requires separate approval and an exact post-state hash; it restores titles, widths and each cell's original wrapping only.

## Verification and limitations

- Exact title/parser/identity/count/calendar/width/no-shrink/CLIP/provenance/adversarial planner tests: PASS.
- Typecheck, check:sync, inventory-source registry, finder-row guard, sheet-merge/vehicle-lock/E2E settlement/release-blocker simulations: PASS.
- Font/token guards, vehicle-master lock and master regression: FAIL at original 0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e as well as this worktree. Baseline reproduced in the unchanged original engine worktree. No unrelated UI or locked vehicle-master edits made to hide those failures.
- Local production build: blocked by the inherited mandatory NEXT_PUBLIC_FIREBASE_DATABASE_URL requirement during page-data collection. RTDB configuration was not restored; this is remaining migration debt.
- Claude review: UNAVAILABLE (weekly limit). Gemini: UNAVAILABLE (403 service disabled). Cursor read-only review found identity prefix collisions and weak calendar checks; those were corrected. Legacy/new duplicate identities intentionally remain HOLD, row-count basis is intentional, and non-F86 channel behavior is outside this task.
- Live write/readback validation and full green CI are NOT complete. Local apply was explicitly tested and rejected before any credential/API call.

## Change history

2026-09-21: Reject MM.DD, middle-dot separators and canonical-key-as-company display. Add exact worksheet title mapping, shared contract, source-width preservation and dispatch-only narrow execution. Earlier top-cell proposal was withdrawn; no top cells or rows were created.


## Concurrent production change (not performed by this task)

At 2026-09-21T06:54:31Z, #453 merged its original b1df8ac3 head as 79db9988500d7fd7634f24c52f382016d8cb5730. Main now pins the rejected 0e0bfb3 engine. At 06:54:49Z, workflow_dispatch run 35570499422 started the full ERP5 pipeline. This task did not merge or dispatch it, and notified the coordinating task immediately. The local withdrawal commit b4f18c88 was pushed after merge and is not applied to main. Earlier read-only snapshots may now be stale; do not execute their plans.

GitHub CI run 35570386892 on 090b65b3 failed at the same four baseline font violations after typecheck passed. The remaining CI steps were skipped, not PASS. Cursor's final delta review found no new write-safety blockers in the corrected executor, but found a duplicate company identity gap in the shared planner; this was then closed with an adversarial test. The existing broad publishers retain full-column formatting semantics; the formatting-only workflow is bounded to header/data rows.
