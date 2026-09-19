import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const sha256 = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function parseIngestSummary(log) {
  const matches = [...String(log || '').matchAll(/■\s+(사전검사\(쓰기 0건\)|반영|미리보기)\s+끝\s+—\s+성공\s+(\d+)\s+·\s+실패\s+(\d+)\s+\/\s+(\d+)/g)];
  if (!matches.length) return null;
  const m = matches.at(-1);
  return {
    phase: m[1].startsWith('사전검사') ? 'PREFLIGHT' : m[1] === '반영' ? 'APPLY' : 'PREVIEW',
    success: Number(m[2]),
    failed: Number(m[3]),
    total: Number(m[4]),
  };
}

export function buildIngestReceipt({
  log,
  workflowOutcome,
  runId,
  runAttempt = '1',
  eventName,
  engineRevision,
  startedAt = null,
  endedAt,
}) {
  const summary = parseIngestSummary(log);
  const operationId = 'erp5-ingest-' + String(runId) + '-' + String(runAttempt);
  const correlationId = 'github-actions-' + String(runId) + '-' + String(runAttempt);

  let status = 'HOLD';
  let reasonCode = 'INGEST_LOG_UNPARSEABLE';
  if (summary) {
    if (summary.phase === 'APPLY') {
      if (summary.failed === 0 && workflowOutcome === 'success') {
        status = 'SUCCEEDED';
        reasonCode = null;
      } else if (summary.success > 0 && summary.failed > 0) {
        status = 'PARTIAL';
        reasonCode = 'SUPPLIER_BATCH_PARTIAL';
      } else {
        status = 'FAILED';
        reasonCode = 'SUPPLIER_BATCH_FAILED';
      }
    } else if (summary.phase === 'PREFLIGHT') {
      status = summary.failed === 0 ? 'SUCCEEDED' : 'FAILED';
      reasonCode = summary.failed === 0 ? null : 'SUPPLIER_PREFLIGHT_FAILED';
    } else {
      status = summary.failed === 0 ? 'SUCCEEDED' : 'FAILED';
      reasonCode = summary.failed === 0 ? null : 'SUPPLIER_PREVIEW_FAILED';
    }
  }

  const inputFact = {
    engine_revision: engineRevision,
    workflow_event: eventName,
    run_id: String(runId),
    run_attempt: String(runAttempt),
    phase: summary?.phase ?? null,
    supplier_total: summary?.total ?? null,
  };
  const outputFact = summary ? {
    phase: summary.phase,
    success: summary.success,
    failed: summary.failed,
    total: summary.total,
    workflow_outcome: workflowOutcome,
  } : null;

  return {
    schema_version: 'core-receipt/v1',
    receipt_id: 'receipt-' + operationId,
    operation_id: operationId,
    operation_kind: summary?.phase === 'PREVIEW' ? 'erp5.inventory.preview'
      : summary?.phase === 'PREFLIGHT' ? 'erp5.inventory.preflight'
        : 'erp5.inventory.refresh',
    actor: 'github-actions:' + String(eventName || 'unknown'),
    executor: 'freepasserp4/.github/workflows/erp5-ssot-refresh.yml',
    correlation_id: correlationId,
    status,
    reason_code: reasonCode,
    input: {
      digest: sha256(inputFact),
      refs: [
        'git:' + engineRevision,
        'contract:inventory-source-registry',
      ],
    },
    output: {
      digest: outputFact ? sha256(outputFact) : null,
      refs: summary ? ['erp5://firestore/products', 'github-actions:run/' + runId] : ['github-actions:run/' + runId],
    },
    source_revision: 'git:' + engineRevision,
    started_at: startedAt || endedAt,
    ended_at: endedAt,
    evidence_refs: [
      'github-actions:run/' + runId,
      'workflow:erp5-ssot-refresh',
    ],
    milestones: [
      {
        stage: 'INGEST_PROCESS_EXITED',
        observed_at: endedAt,
        evidence_refs: ['github-actions:run/' + runId + '#ingest'],
      },
    ],
    reproducibility: {
      deterministic: false,
      executor_version: engineRevision,
      environment_revision: 'github-actions-run:' + runId,
      command_ref: summary?.phase === 'PREVIEW'
        ? 'scripts/ingest-all-suppliers.mts'
        : 'scripts/ingest-all-suppliers.mts --apply --variable --retire',
    },
    batch_summary: summary,
  };
}

function args(argv) {
  const out = {};
  for (const value of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(value);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

if (import.meta.url === new URL('file:' + process.argv[1]).href) {
  const a = args(process.argv.slice(2));
  if (!a.log || !a.out || !a['engine-revision'] || !a['run-id'] || !a['ended-at']) {
    console.error('usage: --log= --out= --engine-revision= --run-id= --run-attempt= --outcome= --event= --ended-at=');
    process.exit(2);
  }
  const receipt = buildIngestReceipt({
    log: readFileSync(a.log, 'utf8'),
    workflowOutcome: a.outcome || 'unknown',
    runId: a['run-id'],
    runAttempt: a['run-attempt'] || '1',
    eventName: a.event || 'unknown',
    engineRevision: a['engine-revision'],
    startedAt: a['started-at'] || null,
    endedAt: a['ended-at'],
  });
  mkdirSync(dirname(a.out), { recursive: true });
  writeFileSync(a.out, JSON.stringify(receipt, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({
    receipt: a.out,
    status: receipt.status,
    reason_code: receipt.reason_code,
    batch_summary: receipt.batch_summary,
  }));
}
