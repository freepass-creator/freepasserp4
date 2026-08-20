/** 잘못 확정된 상품마스터 단일후보를 적용 전 스냅샷으로 되돌린다. 기본 dry-run. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_COLUMNS, PRODUCT_MASTER_TAB } from '../lib/domain/product-master-sheet';

type Rec = Record<string, unknown>;
type Before = { row: number; car_number: string; values: Record<string, string> };
const S = (value: unknown) => String(value ?? '').trim();
const plate = (value: unknown) => S(value).replace(/\s/g, '');
const apply = process.argv.includes('--apply');
const snapshotPath = resolve('tmp/product-master-vehicle-patch-snapshot-1786809444909.json');
const reportPath = resolve('tmp/product-master-vehicle-coverage.json');
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as { before: Before[] };
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { report_type?: string; source?: Rec; rows: Array<{
  row: number; car_number: string; current_code: string; category: string;
}> };
if (S(report.report_type) !== 'product_master_vehicle_coverage_v2_supplier_direct_evidence'
  || S(report.source?.evidence_scope) !== 'supplier_direct_prefix_only') {
  throw new Error('supplier-direct coverage v2 보고서가 아니므로 rollback 대조를 중단합니다.');
}
const invalidRows = new Set(report.rows.filter((row) => row.category === '확정 코드 명시축 불일치').map((row) => row.row));
const targets = snapshot.before.filter((row) => invalidRows.has(row.row));
if (targets.length !== 14) throw new Error(`검증 고정 롤백 14대와 다름: ${targets.length}`);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const auth = new JWT({ email: S(sa.client_email), key: S(sa.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const token = (await Promise.race([auth.getAccessToken(),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Google OAuth timeout')), 30_000))])).token;
const base = `https://sheets.googleapis.com/v4/spreadsheets/${DEFAULT_PRODUCT_MASTER_SHEET_ID}`;
const range = encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AZ`);
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
const columns = ['차종마스터 적용값', '검증상태', '검수사유', '관리상태', '차종코드'] as const;
const updates: Array<{ range: string; values: string[][] }> = [];
for (const target of targets) {
  const row = values[target.row - 1] || [];
  const currentReport = report.rows.find((item) => item.row === target.row)!;
  if (plate(row[col('차량번호')]) !== plate(target.car_number)
    || S(row[col('차종코드')]) !== currentReport.current_code) throw new Error(`CAS 불일치 row ${target.row}`);
  for (const name of columns) updates.push({
    range: `'${PRODUCT_MASTER_TAB}'!${colName(col(name))}${target.row}`,
    values: [[S(target.values[name])]],
  });
}
const planPath = resolve(`tmp/product-master-invalid-rollback-${Date.now()}.json`);
writeFileSync(planPath, `${JSON.stringify({ generated_at: new Date().toISOString(), targets, updates }, null, 2)}\n`, 'utf8');
if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', rows: targets.length, cells: updates.length, plan: planPath }, null, 2));
  process.exit(0);
}
await api(`${base}/values:batchUpdate`, { method: 'POST',
  body: JSON.stringify({ valueInputOption: 'RAW', data: updates }) });
const after = await api(`${base}/values/${range}`) as { values?: unknown[][] };
for (const target of targets) {
  const row = (after.values || [])[target.row - 1] || [];
  if (plate(row[col('차량번호')]) !== plate(target.car_number)
    || columns.some((name) => S(row[col(name)]) !== S(target.values[name]))) {
    throw new Error(`롤백 후 검증 실패 row ${target.row}`);
  }
}
console.log(JSON.stringify({ mode: 'apply', rows: targets.length, cells: updates.length,
  verified: targets.length, plan: planPath }, null, 2));
