import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveStatus } from '../lib/domain/atom-status';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { VEHICLE_STATES } from '../lib/intake/entities';

assert.deepEqual([...VEHICLE_STATES], ['즉시출고', '출고가능', '상품화중', '출고협의', '계약중', '출고불가']);

const fromSource = (raw: string) => resolveStatus({ base: canonSheetVehicleStatus(raw), raw });

for (const raw of ['계약중', '판매완료', '출고완료', '매각', '배차중', '운행중']) {
  const got = fromSource(raw);
  assert.equal(got.vehicle_status, '출고불가', raw);
  assert.equal(got.status, '출고불가', raw);
  assert.equal(got.status_kind, '불가', raw);
  assert.equal(got.listable, false, raw);
  assert.equal(got.status_label_raw, raw, raw);
}

for (const raw of ['출고가능', '출고가능(정비중)', '판매중', '할인판매']) {
  const got = fromSource(raw);
  assert.equal(got.vehicle_status, '출고가능', raw);
  assert.equal(got.status_kind, '가용', raw);
  assert.equal(got.listable, true, raw);
}

assert.equal(fromSource('배차대기').vehicle_status, '출고협의');
assert.equal(fromSource('').vehicle_status, '출고협의');
assert.equal(resolveStatus({ base: '', raw: '' }).vehicle_status, '상품화중');
assert.equal(resolveStatus({ base: '차량검수', raw: '차량검수' }).vehicle_status, '상품화중');

const locked = resolveStatus({ base: '출고가능', raw: '출고가능', locked: 'contract-1' });
assert.equal(locked.vehicle_status, '계약중');
assert.equal(locked.status_kind, '선점');
assert.equal(locked.listable, true);

const completed = resolveStatus({ base: '출고불가', raw: '출고가능', locked: 'contract-1' });
assert.equal(completed.vehicle_status, '출고불가');
assert.equal(completed.status_kind, '불가');
assert.equal(completed.listable, false);

const orchestrator = readFileSync(new URL('./ingest-all-suppliers.mts', import.meta.url), 'utf8');
assert.match(orchestrator, /STATUS_ONLY[\s\S]*?--status-only/);
assert.match(orchestrator, /VARIABLE \|\| STATUS_ONLY/);
const reborn = readFileSync(new URL('./ingest-reborncar-to-firestore.mts', import.meta.url), 'utf8');
assert.match(reborn, /!S\(x\.locked_by_contract\)/);
assert.match(reborn, /S\(x\.locked_by_contract\) \? x\.vehicle_status : '출고가능'/);
const workflow = readFileSync(new URL('../.github/workflows/direct-ingest-hourly.yml', import.meta.url), 'utf8');
assert.match(workflow, /capture-sales-publish-snapshot\.mts --erp5/);
assert.match(workflow, /make-sample-sheet-google\.mts --main --snapshot=tmp\/erp5-sales-publish\.json/);
const publisher = readFileSync(new URL('./make-sample-sheet-google.mts', import.meta.url), 'utf8');
assert.ok(publisher.indexOf('GOOGLE_SHEETS_APPLICATION_CREDENTIALS') < publisher.indexOf('GOOGLE_APPLICATION_CREDENTIALS'));

console.log('PASS: 배차상태 원문 → 정규 상태 한 벌 · 계약잠금 우선순위');
