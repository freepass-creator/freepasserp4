import assert from 'node:assert/strict';
import { classifyRollbackEntries, type ProductSyncBackupEntry } from '../lib/server/sheet-daily-sync';

const entries: ProductSyncBackupEntry[] = [
  { key: 'A', existed: true, before: { value: 1 }, providerCode: 'P1' },
  { key: 'B', existed: true, before: { value: 2 }, providerCode: 'P1' },
  { key: 'C', existed: true, before: { value: 2 }, providerCode: 'P2' },
  { key: 'D', existed: true, before: { value: 1 }, providerCode: 'P2' },
  { key: 'E', existed: false, providerCode: 'P3' },
];

const result = classifyRollbackEntries('run_source', entries, {
  A: { value: 9, sheet_sync_run_id: 'run_source' },
  B: { value: 2 },
  C: { value: 3 },
  D: { value: 8, sheet_sync_run_id: 'run_newer' },
  E: { value: 1, sheet_sync_run_id: 'run_source' },
});

assert.deepEqual(result.restorable.map((entry) => entry.key), ['A', 'E'], '해당 실행이 쓴 기존/신규 행만 복구 대상');
assert.deepEqual(result.untouched.map((entry) => entry.key), ['B'], '반영되지 않고 원본 그대로인 행은 건너뜀');
assert.deepEqual(result.conflicts.map((entry) => entry.key), ['C', 'D'], '수기·후속 실행 변경은 충돌로 차단');
console.log('PASS: 판매시트 ERP 백업·롤백 run-id/후속변경 fail-closed');
