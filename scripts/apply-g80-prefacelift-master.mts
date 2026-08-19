/** Append-only repair for the corrected 2020-2023 Genesis G80 RG3 lineage. */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';
import { validateSerializedVehicleMasterRow } from '../lib/domain/vehicle-master-row-validation';

type Rec = Record<string, unknown>;
const APPLY = process.argv.includes('--apply');
const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
const MASTER_ID = argument('master-id') || 'mf-007.md-002.sm-rg3-prefacelift-corrected__g80-2020';
const EXPECTED_COUNT = Number(argument('expected-count') || 8);
const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: Rec[] };
const headers = [
  'management_status', 'verification_status', 'market_status', 'origin', 'maker', 'model', 'sub_model', 'powertrain', 'trim',
  'trim_row_key', 'master_id', 'powertrain_seq', 'trim_seq', 'generation_name', 'development_code', 'production_start', 'production_end',
  'model_year_start', 'model_year_end', 'fuel', 'engine_cc', 'displacement_l', 'turbo', 'drivetrain', 'seats',
  'battery_kwh', 'trim_aliases', 'evidence_url', 'evidence_note', 'data_as_of',
] as const;
const rows = artifact.records.filter((record) => record.master_id === MASTER_ID);
if (!MASTER_ID || !Number.isInteger(EXPECTED_COUNT) || EXPECTED_COUNT < 1) throw new Error('master-id/expected-count 인자가 올바르지 않습니다.');
if (rows.length !== EXPECTED_COUNT) throw new Error(`신규 마스터가 정확히 ${EXPECTED_COUNT}행이어야 합니다: ${rows.length}`);
const values = rows
  .sort((a, b) => String(a.trim_row_key).localeCompare(String(b.trim_row_key)))
  .map((record) => headers.map((header) => {
    const value = record[header];
    if (header === 'turbo') return value === true ? '예' : value === false ? '아니오' : '';
    if (header === 'trim_aliases') return Array.isArray(value) ? value.join(',') : '';
    return value ?? '';
  }));
// 기존 영구키의 의미축은 현재 정규화 타입으로 표현하기 어려운 레거시 값도
// 기준판 그대로 보존한다. 예: 과거 베뉴 키의 터보 열에 기록된 `자동`.
const registry = JSON.parse(readFileSync('data/vehicle-trim-key-registry.json', 'utf8')) as {
  records?: Array<{ code?: string; semantic?: string[] }>;
};
const registeredTurbo = new Map((registry.records || []).map((record) => [String(record.code || ''), String(record.semantic?.[15] || '')]));
for (const row of values) {
  const baselineTurbo = registeredTurbo.get(String(row[9] || ''));
  if (baselineTurbo !== undefined) row[22] = baselineTurbo;
}
if (values.some((row) => row.length !== 30)) throw new Error('차종마스터 직렬화는 행마다 정확히 30열이어야 합니다.');
for (const [index, row] of values.entries()) {
  const issues = validateSerializedVehicleMasterRow(row);
  if (issues.length) throw new Error(`신규 마스터 ${index + 1}번째 행 검증 실패: ${issues.join(', ')}`);
}
const keys = values.map((row) => String(row[9]));
if (new Set(keys).size !== EXPECTED_COUNT) throw new Error('신규 마스터 영구키가 중복됩니다.');

const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({
  email: String(credentials.client_email), key: String(credentials.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com',
}).getAccessToken()).token;
if (!token) throw new Error('Sheets 토큰을 얻지 못했습니다.');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}`;
async function api(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 600)}`);
  return body;
}
const range = encodeURIComponent(`'${MASTER_TAB}'!A:AD`);
const before = await api(`${base}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] };
const live = before.values || [];
const liveKeys = new Map(live.map((row, index) => [String(row[9] ?? '').trim(), index + 1]).filter(([key]) => key));
const existing = keys.filter((key) => liveKeys.has(key));
if (existing.length && existing.length !== EXPECTED_COUNT) throw new Error(`부분 적용 상태라 중단합니다: ${existing.length}/${EXPECTED_COUNT}`);
if (existing.length === EXPECTED_COUNT) {
  const located = keys.map((key) => liveKeys.get(key) as number);
  const mismatches = located.filter((row, index) => JSON.stringify((live[row - 1] || []).slice(0, 30)) !== JSON.stringify(values[index]));
  if (!mismatches.length) {
    console.log(JSON.stringify({ mode: 'already_applied', keys: EXPECTED_COUNT, rows: located }));
    process.exit(0);
  }
  if (!APPLY) {
    console.log(JSON.stringify({ mode: 'repair_dry_run', keys: EXPECTED_COUNT, mismatchRows: mismatches }, null, 2));
    process.exit(0);
  }
  await api(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({
    valueInputOption: 'RAW',
    data: located.map((row, index) => ({ range: `'${MASTER_TAB}'!A${row}:AD${row}`, majorDimension: 'ROWS', values: [values[index]] })),
  }) });
}
const lastNonEmptyRow = live.reduce((last, row, index) => row.some((cell) => String(cell ?? '').trim()) ? index + 1 : last, 0);
const plan = { mode: APPLY ? 'apply' : 'dry_run', masterId: MASTER_ID, appendRows: EXPECTED_COUNT, expectedStartRow: lastNonEmptyRow + 1, keys };
writeFileSync('tmp/vehicle-trim-master-append-plan.json', `${JSON.stringify(plan, null, 2)}\n`);
if (!APPLY) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}
if (!existing.length) {
  await api(`${base}/values/${encodeURIComponent(`'${MASTER_TAB}'!A:AD`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values }),
  });
}
const after = await api(`${base}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] };
const afterRows = after.values || [];
const found = keys.map((key) => ({ key, rows: afterRows.flatMap((row, index) => String(row[9] ?? '').trim() === key ? [index + 1] : []) }));
if (found.some((item) => item.rows.length !== 1)) throw new Error(`적용 후 키 유일성 검증 실패: ${JSON.stringify(found)}`);
console.log(JSON.stringify({ mode: 'applied_verified', operation: existing.length ? 'repair' : 'append', written: EXPECTED_COUNT, rows: found.map((item) => item.rows[0]) }, null, 2));
