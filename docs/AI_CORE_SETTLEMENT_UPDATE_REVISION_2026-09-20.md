# ERP4 Settlement Update — Optimistic Concurrency Pilot — 2026-09-20

Status: **OPTIONAL EXPECTED_REVISION / SHADOW_WITH_GAPS**

## Scope

This pilot covers only the update branch of:

- route: `POST /api/settlement/board`
- selector: `body.id` is present
- operation: `settlement.intake.update`

The create branch remains the separate SHADOW pilot already on main.

## Problem

Before this change the update path was:

`read current row -> calculate patch -> ref.set(..., merge:true)`

Two admins could read the same row, edit independently, and the later save could overwrite the earlier save without detecting that the source row had changed.

## Resource revision

ERP4 keeps Firestore as runtime authority.

The Core-compatible opaque resource revision is therefore derived from the actual Firestore document `updateTime`:

`firestore:<seconds>:<nanoseconds>`

No second version counter or duplicate SSOT is introduced.

The revision is exposed additively from:

- `GET /api/settlement/board?line=<id>` as `resource_revision`;
- successful update responses as `resource_revision`.

## Guarded update

A client may send:

`expected_revision: "firestore:..."`

When it is present, ERP4 performs the read/compare/write in one Firestore transaction.

- matching revision -> write proceeds;
- different revision -> no write, HTTP 409;
- Core shadow code -> `VERSION_MISMATCH`;
- response also returns `expected_revision` and the actual current revision.

A transaction retry caused by a concurrent write re-reads the document. If the revision changed, the retry becomes `VERSION_MISMATCH` rather than silently overwriting the other edit.

## Backward compatibility

The two first-party Settlement UIs now send `expected_revision` on edits:

- mobile/board flow: `SettlementBoard`;
- PC workstation flow: `IntakeStation`.

Both receive row revisions from the board payload, and the workstation also refreshes the revision from line-detail reads.

Legacy or external callers may still omit `expected_revision`. For those calls, the pre-existing update path remains unchanged. This preserves compatibility without weakening first-party protection.

## Machine verification

`scripts/check-ai-core-api-shadow.mts` now verifies:

- Firestore revision token construction;
- blank/missing expected revision preserves legacy compatibility;
- equal revision matches;
- stale revision fails;
- update contract declares `VERSION_MISMATCH`;
- the route uses `runTransaction`, transaction read, compare-before-write and transaction set;
- legacy `ref.set` path still exists;
- board rows, line detail and update response expose `resource_revision`;
- both first-party UI adapters serialize it as `expected_revision`;
- stale 409 `VERSION_MISMATCH` triggers user feedback and a fresh reload.

## Remaining gaps

- legacy/external callers may still omit `expected_revision` by compatibility design;
- request_id and correlation_id are still absent;
- public errors are not fully `core.error.v1`;
- success is not fully `core.result.v1`.

## Next gate

The next gate is request/correlation context plus observation of real `VERSION_MISMATCH` handling in first-party edits. Optimistic concurrency is now active for the known Settlement UI edit flows while legacy compatibility remains available.
