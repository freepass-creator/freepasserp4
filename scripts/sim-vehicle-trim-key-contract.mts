import assert from 'node:assert/strict';
import {
  TRIM_KEY_SEMANTIC_HEADERS,
  TRIM_KEY_SEMANTIC_HEADERS_V3,
  auditTrimKeyContract,
  type TrimKeyRecord,
  type TrimKeyRegistry,
} from '../lib/domain/vehicle-trim-key-contract';

const record = (code: string, trim: string): TrimKeyRecord => ({
  code,
  masterId: 'mf-001.md-001.sm-test',
  powertrainSeq: '1',
  trimSeq: code.endsWith('t01') ? '1' : '2',
  semantic: TRIM_KEY_SEMANTIC_HEADERS.map((field) => field === '제조사' ? '테스트' : field === '세부트림' ? trim : ''),
});
const one = record('mf-001.md-001.sm-test::v01::t01', '기본');
const two = record('mf-001.md-001.sm-test::v01::t02', '상위');
const registry: TrimKeyRegistry = {
  schemaVersion: 1,
  spreadsheetId: 'sheet',
  sheetName: '차종마스터',
  capturedAt: '2026-08-15',
  semanticHeaders: [...TRIM_KEY_SEMANTIC_HEADERS],
  records: [one, two],
};

assert.equal(auditTrimKeyContract(registry, [structuredClone(one), structuredClone(two)]).ok, true, '동일 입력은 멱등 PASS');

const removed = auditTrimKeyContract(registry, [structuredClone(one)]);
assert(removed.issues.some((issue) => issue.kind === 'REMOVED_CODE'), '삭제를 잡아야 함');

const changed = structuredClone(one);
changed.semantic[TRIM_KEY_SEMANTIC_HEADERS.indexOf('세부트림')] = '다른 차';
assert(auditTrimKeyContract(registry, [changed, structuredClone(two)]).issues.some((issue) => issue.kind === 'REGISTERED_SEMANTIC_DRIFT'), '의미 변경을 잡아야 함');

const inserted = record('mf-001.md-001.sm-test::v02::t01', '신규');
inserted.powertrainSeq = '2';
assert(auditTrimKeyContract(registry, [structuredClone(one), structuredClone(two), inserted]).issues.some((issue) => issue.kind === 'UNREGISTERED_CODE'), '미등록 신규키를 잡아야 함');

const resequenced = structuredClone(one);
resequenced.powertrainSeq = '2';
assert(auditTrimKeyContract(registry, [resequenced, structuredClone(two)]).issues.some((issue) => issue.kind === 'POWERTRAIN_SEQ_MISMATCH'), '순번 이동을 잡아야 함');

const v3Record = (code: string, trim: string) => ({
  code,
  masterId: 'mf-001.md-001.sm-test',
  powertrainSeq: '1',
  trimSeq: code.endsWith('t01') ? '1' : '2',
  semantic: TRIM_KEY_SEMANTIC_HEADERS_V3.map((field) => field === '제조사' ? '테스트' : field === '세부트림' ? trim : ''),
});
const v3one = v3Record('mf-001.md-001.sm-test::v01::t01', '기본');
const v3two = v3Record('mf-001.md-001.sm-test::v01::t02', '상위');
const registryV3: TrimKeyRegistry = {
  schemaVersion: 3,
  spreadsheetId: 'sheet',
  sheetName: '차종마스터',
  capturedAt: '2026-08-18',
  semanticHeaders: [...TRIM_KEY_SEMANTIC_HEADERS_V3],
  records: [v3one, v3two],
};
assert.equal(auditTrimKeyContract(registryV3, [structuredClone(v3one), structuredClone(v3two)]).ok, true, 'V3(파워트레인 열 없음) 계약 PASS');

console.log('PASS — 동일입력/삭제/의미변경/신규/순번변경/V3헤더');

