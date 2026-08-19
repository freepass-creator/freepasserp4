/** 상품마스터가 참조하는 blocked 영구키를 안전하게 검수 격리한다. 기본 dry-run. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import {
  DEFAULT_PRODUCT_MASTER_SHEET_ID,
  PRODUCT_MASTER_COLUMNS,
  PRODUCT_MASTER_TAB,
} from '../lib/domain/product-master-sheet';
import type { VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';

type Rec = Record<string, unknown>;
const S = (value: unknown) => String(value ?? '').trim();
const plate = (value: unknown) => S(value).replace(/\s/g, '');
const apply = process.argv.includes('--apply');
const directConflicts = process.argv.includes('--direct-conflicts');
const reportPath = resolve('tmp/product-master-vehicle-coverage.json');
const snapshotPath = resolve(`tmp/product-master-blocked-quarantine-${Date.now()}.json`);
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
  report_type?: string;
  source?: Rec;
  rows?: Array<{ row: number; car_number: string; current_code: string; current_tier: string; category: string }>;
};
if (S(report.report_type) !== 'product_master_vehicle_coverage_v2_supplier_direct_evidence'
  || S(report.source?.evidence_scope) !== 'supplier_direct_prefix_only'
  || S(report.source?.mode) !== 'live_sheet') throw new Error('supplier-direct 라이브 coverage v2 보고서가 아님');
const targets = (report.rows || []).filter((row) => directConflicts
  ? row.category === '확정 코드 명시축 불일치'
  : row.current_tier === 'blocked');
if (!targets.length) throw new Error(directConflicts ? '명시축 충돌 없음' : 'blocked 참조 없음');

const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as VehicleTrimMasterArtifact;
const byKey = new Map(artifact.records.map((row) => [row.trim_row_key, row]));
for (const target of targets) {
  const current = byKey.get(target.current_code);
  if (!current) throw new Error(`영구키 없음: ${target.current_code}`);
  if (!directConflicts && current.usage_tier !== 'blocked') throw new Error(`blocked 키 아님: ${target.current_code}`);
  if (directConflicts && current.usage_tier !== 'automatic') throw new Error(`automatic 충돌키 아님: ${target.current_code}`);
}

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const auth = new JWT({ email: S(sa.client_email), key: S(sa.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const token = (await Promise.race([
  auth.getAccessToken(),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Google OAuth timeout')), 30_000)),
])).token;
const base = `https://sheets.googleapis.com/v4/spreadsheets/${DEFAULT_PRODUCT_MASTER_SHEET_ID}`;
const range = encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AX`);
const api = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json', ...(init?.headers || {}) }, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sheets HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) as Rec : {};
};
const live = await api(`${base}/values/${range}`) as { values?: unknown[][] };
const values = live.values || [];
const headers = (values[0] || []).map(S);
if (PRODUCT_MASTER_COLUMNS.some((name, index) => headers[index] !== name)) throw new Error('상품마스터 헤더 불일치');
const col = (name: (typeof PRODUCT_MASTER_COLUMNS)[number]) => PRODUCT_MASTER_COLUMNS.indexOf(name);
const colName = (index: number) => {
  let n = index + 1; let out = '';
  while (n) { out = String.fromCharCode(65 + ((n - 1) % 26)) + out; n = Math.floor((n - 1) / 26); }
  return out;
};
const before: Rec[] = [];
const updates: Array<{ range: string; values: string[][] }> = [];
for (const target of targets) {
  const row = values[target.row - 1] || [];
  if (plate(row[col('차량번호')]) !== target.car_number || S(row[col('차종코드')]) !== target.current_code) {
    throw new Error(`CAS 불일치 row ${target.row}`);
  }
  const columns = ['차종마스터 적용값', '검증상태', '검수사유', '관리상태', '차종코드'] as const;
  before.push({ row: target.row, car_number: target.car_number,
    values: Object.fromEntries(columns.map((name) => [name, S(row[col(name)] )])) });
  const patch: Record<(typeof columns)[number], string> = {
    '차종마스터 적용값': '',
    '검증상태': '검수필요',
    '검수사유': directConflicts
      ? '공급사 원문과 기존 차종코드 명시축 충돌 — 재매칭 필요'
      : '차단된 과거 영구키 — 원문 확인 후 재매칭 필요',
    '관리상태': '검수필요',
    '차종코드': '',
  };
  for (const name of columns) updates.push({
    range: `'${PRODUCT_MASTER_TAB}'!${colName(col(name))}${target.row}`,
    values: [[patch[name]]],
  });
}
mkdirSync(dirname(snapshotPath), { recursive: true });
writeFileSync(snapshotPath, `${JSON.stringify({ generated_at: new Date().toISOString(), targets: targets.length,
  before, planned_updates: updates }, null, 2)}\n`, 'utf8');
if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', rows: targets.length, cells: updates.length, snapshot: snapshotPath }, null, 2));
  process.exit(0);
}
await api(`${base}/values:batchUpdate`, { method: 'POST',
  body: JSON.stringify({ valueInputOption: 'RAW', data: updates }) });
const after = await api(`${base}/values/${range}`) as { values?: unknown[][] };
for (const target of targets) {
  const row = (after.values || [])[target.row - 1] || [];
  if (plate(row[col('차량번호')]) !== target.car_number || S(row[col('차종코드')])
    || S(row[col('검증상태')]) !== '검수필요' || S(row[col('관리상태')]) !== '검수필요') {
    throw new Error(`격리 후 검증 실패 row ${target.row}`);
  }
}
console.log(JSON.stringify({ mode: 'apply', rows: targets.length, cells: updates.length,
  verified: targets.length, snapshot: snapshotPath }, null, 2));
