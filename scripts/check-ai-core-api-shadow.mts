import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CONTRACT = 'contracts/ai-core/settlement-intake.api-shadow.json';
const ROUTE = 'app/api/settlement/board/route.ts';

const contract = JSON.parse(readFileSync(CONTRACT, 'utf8')) as any;
const route = readFileSync(ROUTE, 'utf8');

assert.equal(contract.schema_version, 'erp4-ai-core-api-shadow/v1');
assert.equal(contract.status, 'SHADOW_WITH_GAPS');
assert.equal(contract.consumer.route, ROUTE);
assert.equal(contract.consumer.method, 'POST');
assert.equal(contract.consumer.operation, 'settlement.intake.create');
assert.equal(contract.consumer.scope_selector, 'body.id is absent');

assert.match(contract.ai_core.revision, /^[0-9a-f]{40}$/);
assert.equal(contract.ai_core.contracts.request_context, 'core.request-context.v1');
assert.equal(contract.ai_core.contracts.error, 'core.error.v1');
assert.equal(contract.ai_core.contracts.result, 'core.result.v1');

assert.equal(contract.authority.runtime_owner, 'ERP4');
assert.equal(contract.authority.runtime_authority_preserved, true);
assert.equal(contract.authority.cutover_authorized, false);
assert.equal(contract.authority.external_response_shape_changed, false);

assert.equal(contract.project_semantics.actor_requirement, 'ADMIN');
assert.deepEqual(contract.project_semantics.create_identity.fields, ['plate', 'receivedAt', 'customer']);
assert.equal(contract.project_semantics.create_identity.algorithm, 'SHA-256');
assert.equal(contract.project_semantics.duplicate_behavior.http_status, 409);

const errorCodes = new Set(contract.core_shadow_mapping.errors.map((x: any) => x.core_code));
for (const code of [
  'VALIDATION_ERROR',
  'DOMAIN_VALIDATION_FAILED',
  'FORBIDDEN',
  'IDEMPOTENCY_CONFLICT',
  'PERSISTENCE_ERROR',
]) {
  assert.ok(errorCodes.has(code), `missing Core error mapping: ${code}`);
}

assert.equal(contract.core_shadow_mapping.request_context.request_id, 'MISSING');
assert.equal(contract.core_shadow_mapping.request_context.correlation_id, 'MISSING');
assert.equal(contract.core_shadow_mapping.request_context.expected_revision, 'MISSING');
assert.equal(contract.core_shadow_mapping.request_context.idempotency.state, 'PROJECT_NATIVE_DEDUP_ONLY');
assert.equal(contract.core_shadow_mapping.request_context.idempotency.core_key, 'MISSING');
assert.equal(contract.core_shadow_mapping.request_context.idempotency.semantic_payload_digest, 'MISSING');
assert.equal(contract.core_shadow_mapping.result, 'PROJECT_NATIVE_SUCCESS_NOT_CORE_RESULT');

assert.ok(contract.excluded_scope.includes('POST update branch when body.id is present'));
assert.ok(contract.gaps.length >= 6);
assert.ok(contract.next_gate.length >= 4);

/** Current runtime evidence: keep this SHADOW truthful and fail closed if the route drifts. */
assert.ok(route.includes('verifyActiveBearer(req)'));
assert.ok(route.includes("who.role === 'admin'"));
assert.ok(route.includes("return NextResponse.json({ error: '관리자만 씁니다' }, { status: 403 })"));
assert.ok(route.includes("if (S(body?.id)) {"), 'pilot must exclude the update branch');

assert.ok(route.includes("const key = `${S(patch.plate).replace(/\\s/g, '') || '무차번'}|${S(patch.receivedAt)}|${S(patch.customer)}`;"));
assert.ok(route.includes("createHash('sha256').update(key, 'utf8').digest('hex')"));
assert.ok(route.includes('await ref.create(atom);'), 'create must remain atomic');
assert.ok(route.includes("e.code === 6 || e.code === 'already-exists'"));
assert.ok(route.includes("{ status: 409 }"));
assert.ok(route.includes('withDeliveryInvariant'));
assert.ok(route.includes('shapeAtom'));
assert.ok(route.includes("return NextResponse.json({ ok: true, id: code, mode: '접수' });"));

assert.ok(route.includes("{ status: 400 }"));
assert.ok(route.includes("{ status: 500 }"));
assert.ok(route.includes("return NextResponse.json({ error:"), 'project-native error envelope must remain observable');

assert.equal(route.includes('request_id'), false, 'manifest says request_id is missing; update the SHADOW contract when implemented');
assert.equal(route.includes('correlation_id'), false, 'manifest says correlation_id is missing; update the SHADOW contract when implemented');

console.log(JSON.stringify({
  status: 'PASS',
  adoption_state: contract.status,
  operation: contract.consumer.operation,
  runtime_authority: contract.authority.runtime_owner,
  core_request_context: 'SHADOW_GAP',
  core_error_mapping: 'SHADOW',
  project_native_dedup: 'VERIFIED',
  cutover_authorized: contract.authority.cutover_authorized,
}, null, 2));
