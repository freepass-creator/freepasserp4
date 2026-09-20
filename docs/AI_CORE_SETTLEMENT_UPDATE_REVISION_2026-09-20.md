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

Existing clients currently do not send `expected_revision`.

For those calls, the pre-existing update path remains unchanged. This avoids turning on a new mandatory precondition before the UI has been migrated.

This is intentionally an **opt-in concurrency boundary first**, followed by client adoption.

## Machine verification

`scripts/check-ai-core-api-shadow.mts` now verifies:

- Firestore revision token construction;
- blank/missing expected revision preserves legacy compatibility;
- equal revision matches;
- stale revision fails;
- update contract declares `VERSION_MISMATCH`;
- the route uses `runTransaction`, transaction read, compare-before-write and transaction set;
- legacy `ref.set` path still exists;
- line detail and update response expose `resource_revision`.

## Remaining gaps

- settlement UI does not yet send `expected_revision`;
- request_id and correlation_id are still absent;
- public errors are not fully `core.error.v1`;
- success is not fully `core.result.v1`.

## Next gate

Wire the settlement edit UI so the revision returned by line detail is retained and sent as `expected_revision` when saving. Only after that can optimistic concurrency be considered active for normal user edits.
