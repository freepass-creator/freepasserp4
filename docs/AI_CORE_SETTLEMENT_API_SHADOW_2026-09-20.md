# ERP4 Settlement Intake — AI Core API/Error SHADOW Pilot — 2026-09-20

Status: **SHADOW_WITH_GAPS / NO RUNTIME CUTOVER**

## Scope

Only one bounded write operation is covered:

- route: `POST /api/settlement/board`
- operation: new settlement intake
- selector: request body has no `id`

The update branch (`body.id` present), GET operations, auth replacement, response cutover and database migration are explicitly outside this pilot.

## Why this operation

The current ERP4 implementation already has useful write-safety semantics:

- server-side admin authorization through `verifyActiveBearer`;
- domain normalization through `withDeliveryInvariant` and `shapeAtom`;
- deterministic receipt identity from `plate + receivedAt + customer`;
- SHA-256 document identity;
- Firestore `DocumentReference.create()` so concurrent duplicates do not overwrite;
- duplicate conflict returned as HTTP 409;
- post-write readback check.

These are strong project-native behaviors and must not be weakened merely to make the code look like AI Core.

## AI Core mapping

Pinned AI Core revision:

`ade9648774f2637eb822aaa97192858a66c29a55`

Relevant canonical contracts:

- `core.request-context.v1`
- `core.error.v1`
- `core.result.v1`

### Request context

Current ERP4 state:

- actor: available from the existing admin auth boundary;
- request_id: missing;
- correlation_id: missing;
- expected_revision: missing;
- Core idempotency key: missing;
- semantic payload digest: missing.

The deterministic settlement document key is **project-native duplicate protection**, not a claim that `core.request-context.v1` idempotency has already been adopted.

### Error families

The SHADOW mapping records the current project behavior without changing the public API:

| Current behavior | Core shadow family |
|---|---|
| 400 malformed field/type/date | `VALIDATION_ERROR` |
| 400 business-state contradiction / missing intake identity | `DOMAIN_VALIDATION_FAILED` |
| 403 admin-only rejection | `FORBIDDEN` |
| 409 deterministic duplicate | `IDEMPOTENCY_CONFLICT` |
| 500 readback mismatch | `PERSISTENCE_ERROR` |

ERP4 still emits its existing `{ error: string, id?: string }` shape. This pilot does **not** claim RFC 9457 / `core.error.v1` cutover.

## Machine gate

`scripts/check-ai-core-api-shadow.mts` verifies both sides:

1. the SHADOW manifest remains explicit about missing Core fields and no cutover authority;
2. the actual route still preserves the project-native safety behaviors that justify the mapping.

If ERP4 later adds request/correlation IDs or changes duplicate semantics, this checker should fail until the SHADOW contract is deliberately updated.

## Next gate

1. add request/correlation context without changing business behavior;
2. bind Core idempotency semantics to the existing deterministic receipt identity rather than replacing it;
3. internally project stable Core error envelopes while preserving the current client contract;
4. pilot the update branch separately with `expected_revision` before widening adoption.

This document does not authorize runtime response changes, data writes, auth replacement, deployment, or Core cutover.
