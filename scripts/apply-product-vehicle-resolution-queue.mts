/** 상품 587대 중 미확정 행을 원인별 검토 큐로 기록한다. 기본 dry-run, --apply만 write. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_COLUMNS, PRODUCT_MASTER_TAB } from '../lib/domain/product-master-sheet';
import { isTrustedProductCoverageSourceMode } from '../lib/domain/product-master-coverage-audit';

type Rec = Record<string, unknown>;
type CoverageRow = { row: number; car_number: string; current_code: string; verification: string; category: string };
type QueueRow = {
  row: number; resolution_class: string; missing_axes?: string[]; existing_clue_axes?: string[];
  candidate_count: number; next_action: string;
};
const S = (v: unknown) => String(v ?? '').trim();
const plate = (v: unknown) => S(v).replace(/\s/g, '');
const APPLY = process.argv.includes('--apply');
const coveragePath = resolve('tmp/product-master-vehicle-coverage.json');
const queuePath = resolve('tmp/product-master-vehicle-resolution-backlog.json');
const snapshotPath = resolve(`tmp/product-vehicle-resolution-queue-snapshot-${Date.now()}.json`);
const coverage = JSON.parse(readFileSync(coveragePath, 'utf8')) as { report_type?: string; source?: Rec; rows: CoverageRow[] };
const queue = JSON.parse(readFileSync(queuePath, 'utf8')) as { input_generated_at?: string; rows: QueueRow[] };
if (S(coverage.report_type) !== 'product_master_vehicle_coverage_v2_supplier_direct_evidence'
  || S(coverage.source?.evidence_scope) !== 'supplier_direct_prefix_only'
  || !isTrustedProductCoverageSourceMode(S(coverage.source?.mode))) throw new Error('supplier-direct 라이브 coverage v2 보고서가 아님');
if (S(queue.input_generated_at) !== S((JSON.parse(readFileSync(coveragePath, 'utf8')) as Rec).generated_at)) {
  throw new Error('검토 큐가 최신 라이브 감사에서 생성되지 않음');
}
const byRow = new Map(coverage.rows.map((r) => [r.row, r]));
const labels: Record<string, string> = {
  SOURCE_CONFLICT: '원천충돌', PRODUCT_DETAIL_REQUIRED: '상품정보보완',
  MASTER_RESEARCH_REQUIRED: '공식마스터조사', AMBIGUOUS_CANDIDATES: '후보다중',
  MANUAL_EVIDENCE_REQUIRED: '공식근거보완',
  EXISTING_CLUE_RECHECK: '기존단서재판독', LEGACY_CODE_RECONCILIATION: '과거코드재대조',
  MASTER_KEY_OR_ALIAS_RECHECK: '마스터키별칭재대조', PRICE_OPTION_LOOKUP_REQUIRED: '가격옵션대조',
  CANDIDATE_AXIS_LOOKUP_REQUIRED: '후보차이축재조회', MASTER_EVIDENCE_REVIEW: '마스터근거재검토',
  CLUE_EXTRACTION_RECHECK: '단서추출재검토',
  // 사람 검토 결정(3축, data/product-vehicle-review-decisions.json)이 있는 행 — next_action 이 곧 결정 요약이다.
  REVIEWED_CODE: '3축검토·코드', REVIEWED_TRIPLE: '3축검토·3축확정', REVIEWED_PARTIAL: '3축검토·트림미확정', REVIEWED_HOLD: '3축검토·원천확인',
};
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const auth = new JWT({ email: S(sa.client_email), key: S(sa.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const token = (await auth.getAccessToken()).token;
const api = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json', ...(init?.headers || {}) }, signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Sheets HTTP ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) as Rec : {};
};
const base = `https://sheets.googleapis.com/v4/spreadsheets/${DEFAULT_PRODUCT_MASTER_SHEET_ID}`;
const range = encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AX`);
const live = await api(`${base}/values/${range}`) as { values?: unknown[][] };
const values = live.values || [];
const headers = (values[0] || []).map(S);
if (PRODUCT_MASTER_COLUMNS.some((h, i) => headers[i] !== h)) throw new Error('상품마스터 헤더 불일치');
const col = (name: (typeof PRODUCT_MASTER_COLUMNS)[number]) => PRODUCT_MASTER_COLUMNS.indexOf(name);
const colName = (i: number) => { let n = i + 1, out = ''; while (n) { out = String.fromCharCode(65 + ((n - 1) % 26)) + out; n = Math.floor((n - 1) / 26); } return out; };
const updates: { range: string; values: string[][] }[] = [];
const before: Rec[] = [];
for (const item of queue.rows) {
  // 사람 검토로 코드가 박힌 행(REVIEWED_CODE)은 확정/운영이다 — 검수필요로 되돌리지 않는다.
  if (item.resolution_class === 'REVIEWED_CODE') continue;
  const expected = byRow.get(item.row);
  if (!expected) throw new Error(`감사 원행 없음: ${item.row}`);
  const row = values[item.row - 1] || [];
  if (plate(row[col('차량번호')]) !== expected.car_number || S(row[col('차종코드')]) !== expected.current_code
    || S(row[col('검증상태')]) !== expected.verification) throw new Error(`CAS 불일치 row ${item.row}`);
  const detail = item.existing_clue_axes?.length
    ? `; 기존단서축=${item.existing_clue_axes.join(',')}`
    : item.missing_axes?.length ? `; 필요축=${item.missing_axes.join(',')}` : '';
  const reason = `[차종전건감사:${labels[item.resolution_class] || item.resolution_class}] ${item.next_action}; 후보=${item.candidate_count}${detail}`;
  before.push({ row: item.row, car_number: expected.car_number, reason: S(row[col('검수사유')]), status: S(row[col('관리상태')]) });
  updates.push({ range: `'${PRODUCT_MASTER_TAB}'!${colName(col('검수사유'))}${item.row}`, values: [[reason]] });
  updates.push({ range: `'${PRODUCT_MASTER_TAB}'!${colName(col('관리상태'))}${item.row}`, values: [['검수필요']] });
}
mkdirSync(dirname(snapshotPath), { recursive: true });
writeFileSync(snapshotPath, `${JSON.stringify({ generated_at: new Date().toISOString(), before, updates }, null, 2)}\n`);
if (!APPLY) { console.log(JSON.stringify({ mode: 'dry-run', rows: queue.rows.length, cells: updates.length, snapshot: snapshotPath }, null, 2)); process.exit(0); }
await api(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates }) });
const after = await api(`${base}/values/${range}`) as { values?: unknown[][] };
for (const item of queue.rows) {
  if (item.resolution_class === 'REVIEWED_CODE') continue;
  const row = (after.values || [])[item.row - 1] || [];
  if (!S(row[col('검수사유')]).startsWith('[차종전건감사:') || S(row[col('관리상태')]) !== '검수필요') {
    throw new Error(`적용 후 검증 실패 row ${item.row}`);
  }
}
console.log(JSON.stringify({ mode: 'apply', rows: queue.rows.length, cells: updates.length, verified: queue.rows.length, snapshot: snapshotPath }, null, 2));
