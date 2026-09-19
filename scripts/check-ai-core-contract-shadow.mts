import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CORE_SNAPSHOT_CONTRACT,
  ERP5_PRODUCTION_ENGINE_REVISION,
  toCoreSalesPublishSnapshot,
} from '../lib/domain/ai-core-contract-shadow';

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const workflow = readFileSync('.github/workflows/erp5-ssot-refresh.yml', 'utf8');
const mainIngest = readFileSync('scripts/ingest-all-suppliers.mts', 'utf8');

const sourceRegistry = readJson('contracts/ai-core/erp5-products.source-registry.json');
const importPipeline = readJson('contracts/ai-core/erp5-product-refresh.pipeline.json');
const exportPipeline = readJson('contracts/ai-core/erp5-sales-publish.pipeline.json');

assert.match(
  workflow,
  new RegExp(`ref:\\s*${ERP5_PRODUCTION_ENGINE_REVISION}`),
  'production workflow must stay pinned to the audited ERP5 engine revision',
);
assert.match(workflow, /GOOGLE_CLOUD_PROJECT:\s*freepasserp5/);
assert.match(workflow, /github-inventory-writer@freepasserp5\.iam\.gserviceaccount\.com/);
assert.match(workflow, /capture-sales-publish-snapshot\.mts --erp5 --out=tmp\/erp5-sales-publish\.json/);

assert.match(workflow, /name: Core receipt helper checkout/);
assert.match(workflow, /ref: \$\{\{ github\.workflow_sha \}\}/);
assert.match(workflow, /id: ingest/);
assert.match(workflow, /set -o pipefail/);
assert.match(workflow, /tee tmp\/core-contract\/erp5-ingest\.log/);
assert.match(workflow, /name: ERP5 ingest Core receipt 생성\(Shadow\)/);
assert.match(workflow, /continue-on-error: true/);
assert.match(workflow, /build-erp5-ingest-receipt\.mjs/);
assert.match(workflow, /erp5-ingest-core-receipt-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);

assert.match(mainIngest, /SSOT HARD GUARD/);
assert.match(mainIngest, /process\.exit\(2\)/);
assert.match(mainIngest, /실제 반영은 ERP5 SSOT workflow만 사용하세요/);

assert.equal(sourceRegistry.schema_version, 'core-source-registry/v1');
assert.equal(sourceRegistry.canonical_owner, 'freepasserp5');
assert.equal(sourceRegistry.canonical_writer, '.github/workflows/erp5-ssot-refresh.yml');
assert.equal(sourceRegistry.sources.filter((x: any) => x.role === 'CANONICAL').length, 1);
assert.equal(sourceRegistry.sources[0].priority, 1);
assert.equal(sourceRegistry.sources[0].authoritative, true);
assert.equal(sourceRegistry.fallback_policy.mode, 'NONE');
assert.equal(sourceRegistry.fallback_policy.requires_explicit_activation, true);

assert.equal(importPipeline.schema_version, 'core-data-pipeline-contract/v1');
assert.equal(importPipeline.direction, 'IMPORT');
assert.equal(importPipeline.commit_policy, 'BEST_EFFORT_BATCH');
assert.equal(importPipeline.partial_failure_policy, 'ALLOW_PARTIAL_WITH_RECEIPT');
assert.equal(importPipeline.receipt_required, true);
assert.deepEqual(importPipeline.stages, ['RAW_SNAPSHOT','PARSE','NORMALIZE','VALIDATE','IDENTITY_RESOLVE','COMMIT']);

assert.equal(exportPipeline.direction, 'EXPORT');
assert.equal(exportPipeline.commit_policy, 'READ_ONLY');
assert.equal(exportPipeline.partial_failure_policy, 'NOT_APPLICABLE');
assert.equal(exportPipeline.receipt_required, true);
assert.ok(exportPipeline.stages.indexOf('PROJECT') < exportPipeline.stages.indexOf('SERIALIZE'));
assert.ok(exportPipeline.stages.indexOf('SERIALIZE') < exportPipeline.stages.indexOf('DELIVER'));

const sample = {
  version: 1,
  snapshotId: '20260919120000000-shadow',
  capturedAt: '2026-09-19T12:00:00.000Z',
  source: 'firestore',
  products: [{ _key: 'P1' }],
  policies: [{ _key: 'POL1' }],
  partners: [{ _key: 'RP001' }],
  inventory: { registered: 1 },
  payloadHash: 'a'.repeat(64),
};
const core = toCoreSalesPublishSnapshot(sample);
assert.equal(core.schema_version, CORE_SNAPSHOT_CONTRACT);
assert.equal(core.snapshot_id, sample.snapshotId);
assert.equal(core.subject_revision, 'sha256:' + sample.payloadHash);
assert.equal(core.source_revision, 'git:' + ERP5_PRODUCTION_ENGINE_REVISION);
assert.equal(core.payload_digest, 'sha256:' + sample.payloadHash);
assert.equal(core.payload, sample);

console.log(JSON.stringify({
  status: 'PASS',
  adoption_state: 'SHADOW',
  production_writer: '.github/workflows/erp5-ssot-refresh.yml',
  production_engine_revision: ERP5_PRODUCTION_ENGINE_REVISION,
  core_source_registry: 'PASS',
  core_snapshot_projection: 'PASS',
  core_import_pipeline: 'SHADOW_WITH_RECEIPT_GAP',
  core_export_pipeline: 'SHADOW',
}, null, 2));
