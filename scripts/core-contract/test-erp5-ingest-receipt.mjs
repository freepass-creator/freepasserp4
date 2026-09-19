import assert from 'node:assert/strict';
import { buildIngestReceipt, parseIngestSummary } from './build-erp5-ingest-receipt.mjs';

const engine='cf940df642edf315adbc6da2b4134fbad53da160';
const time='2026-09-19T12:00:00.000Z';
const common={runId:'123',runAttempt:'1',eventName:'schedule',engineRevision:engine,endedAt:time};

const okLog='■ 사전검사(쓰기 0건) 끝 — 성공 24 · 실패 0 / 24\n■ 반영 끝 — 성공 24 · 실패 0 / 24';
assert.deepEqual(parseIngestSummary(okLog),{phase:'APPLY',success:24,failed:0,total:24});
const ok=buildIngestReceipt({log:okLog,workflowOutcome:'success',...common});
assert.equal(ok.status,'SUCCEEDED');
assert.equal(ok.reason_code,null);
assert.equal(ok.metrics.supplier_failed,0);
assert.match(ok.input.digest,/^sha256:[0-9a-f]{64}$/);

const partial=buildIngestReceipt({
  log:'■ 사전검사(쓰기 0건) 끝 — 성공 24 · 실패 0 / 24\n■ 반영 끝 — 성공 22 · 실패 2 / 24',
  workflowOutcome:'failure',...common,
});
assert.equal(partial.status,'PARTIAL');
assert.equal(partial.reason_code,'SUPPLIER_BATCH_PARTIAL');

const preflight=buildIngestReceipt({
  log:'■ 사전검사(쓰기 0건) 끝 — 성공 23 · 실패 1 / 24',
  workflowOutcome:'failure',...common,
});
assert.equal(preflight.status,'FAILED');
assert.equal(preflight.reason_code,'SUPPLIER_PREFLIGHT_FAILED');

const preview=buildIngestReceipt({
  log:'■ 미리보기 끝 — 성공 24 · 실패 0 / 24',
  workflowOutcome:'success',...common,
});
assert.equal(preview.status,'SUCCEEDED');
assert.equal(preview.operation_kind,'erp5.inventory.preview');

const unknown=buildIngestReceipt({log:'network died before summary',workflowOutcome:'failure',...common});
assert.equal(unknown.status,'HOLD');
assert.equal(unknown.reason_code,'INGEST_LOG_UNPARSEABLE');
assert.equal(unknown.output.digest,null);

console.log('✓ ERP5 ingest Core receipt parser — success/partial/preflight/preview/unknown');
