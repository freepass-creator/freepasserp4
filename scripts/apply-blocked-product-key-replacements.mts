/**
 * 감사로 확정된 blocked 상품 차종키를 셀 단위로 교체한다.
 *
 * 기본은 dry-run이며 `--apply` 없이는 절대 쓰지 않는다. 행번호·차량번호·현재키를
 * 라이브 Sheet에서 다시 비교하고, 지정된 5개 열 외에는 갱신하지 않는다.
 * A:AX 전체 rewrite 없음. 기존 차종마스터/registry write 없음.
 *
 * dry-run: npx tsx scripts/apply-blocked-product-key-replacements.mts
 * apply:   npx tsx scripts/apply-blocked-product-key-replacements.mts --apply
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_TAB } from '../lib/domain/product-master-sheet';
import type { VehicleTrimMasterArtifact, VehicleTrimMasterRecord } from '../lib/domain/vehicle-trim-master';

type SafeDetail = {
  row: number; car_number: string; current_blocked_key: string;
  replacement_key: string | null; classification: string;
  safe_axis_evidence: Record<string, { match: boolean }> | null;
};
type Report = { details: SafeDetail[] };
const S = (value: unknown) => String(value ?? '').trim();
const plate = (value: unknown) => S(value).replace(/\s/g, '');
const arg = (name: string, fallback = '') =>
  (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
const apply = process.argv.includes('--apply');
const reportPath = resolve(arg('report', 'tmp/blocked-product-key-replacements.json'));
const planPath = resolve(arg('out', 'tmp/blocked-product-key-replacement-apply-plan.json'));
const sheetId = arg('sheet', DEFAULT_PRODUCT_MASTER_SHEET_ID);
const expectedSafeCount = 13;

const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as VehicleTrimMasterArtifact;
const byKey = new Map(artifact.records.map((record) => [record.trim_row_key, record]));
const safe = report.details.filter((detail) => detail.classification === '안전한 1:1 교체 후보');
if (safe.length !== expectedSafeCount) throw new Error(`안전 후보 수가 검증 고정값 ${expectedSafeCount}와 다름: ${safe.length}`);
if (new Set(safe.map((detail) => detail.row)).size !== safe.length) throw new Error('안전 후보에 중복 행이 있음');
for (const detail of safe) {
  const replacement = detail.replacement_key ? byKey.get(detail.replacement_key) : undefined;
  if (!replacement || replacement.usage_tier !== 'automatic') throw new Error(`automatic replacement 아님: ${detail.replacement_key}`);
  if (!detail.safe_axis_evidence || Object.entries(detail.safe_axis_evidence).some(([, evidence]) => !evidence.match)) {
    throw new Error(`불변축 비교 실패 행 ${detail.row}`);
  }
}

const saPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
const serviceAccount = JSON.parse(readFileSync(saPath, 'utf8')) as { client_email: string; private_key: string };
const auth = new JWT({
  email: serviceAccount.client_email, key: serviceAccount.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
});
const token = (await auth.getAccessToken()).token;
const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
const fetchRows = async () => {
  const range = encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AX`);
  const response = await fetch(`${endpoint}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`상품마스터 GET 실패 ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return ((await response.json()) as { values?: unknown[][] }).values || [];
};
const values = await fetchRows();
const headers = (values[0] || []).map(S);
const required = ['차량번호', '차종코드', '차종마스터 적용값', '검증상태', '검수사유', '관리상태'];
for (const name of required) if (headers.indexOf(name) < 0) throw new Error(`상품마스터 필수 열 없음: ${name}`);
const col = (name: string) => headers.indexOf(name);
const colLabel = (zeroBased: number) => {
  let value = zeroBased + 1; let label = '';
  while (value > 0) { label = String.fromCharCode(65 + ((value - 1) % 26)) + label; value = Math.floor((value - 1) / 26); }
  return label;
};
const appliedName = (record: VehicleTrimMasterRecord) =>
  [record.sub_model || record.model, record.powertrain, record.trim].map(S).filter(Boolean).join(' · ');

const mutations = safe.map((detail) => {
  const live = values[detail.row - 1] || [];
  const livePlate = plate(live[col('차량번호')]);
  const liveCode = S(live[col('차종코드')]);
  if (livePlate !== plate(detail.car_number)) {
    throw new Error(`CAS 차량번호 불일치 행 ${detail.row}: report=${detail.car_number}, live=${livePlate}`);
  }
  if (liveCode !== detail.current_blocked_key) {
    throw new Error(`CAS 현재키 불일치 행 ${detail.row}: report=${detail.current_blocked_key}, live=${liveCode}`);
  }
  const replacement = byKey.get(detail.replacement_key!)!;
  return {
    row: detail.row, car_number: livePlate, expected_current_code: liveCode,
    replacement_code: replacement.trim_row_key,
    cells: {
      '차종코드': replacement.trim_row_key,
      '차종마스터 적용값': appliedName(replacement),
      '검증상태': '확정', '검수사유': '', '관리상태': '운영',
    },
  };
});

const plan = { generated_at: new Date().toISOString(), mode: apply ? 'apply' : 'dry-run', sheet_id: sheetId,
  tab: PRODUCT_MASTER_TAB, guarded_rows: mutations.length, mutations };
mkdirSync(dirname(planPath), { recursive: true });
writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', guarded_rows: mutations.length, plan: planPath }, null, 2));
  process.exit(0);
}

// 쓰기 직전 두 번째 GET으로 행 이동·외부 수정 창을 최대한 줄인다.
const beforeWrite = await fetchRows();
for (const mutation of mutations) {
  const row = beforeWrite[mutation.row - 1] || [];
  if (plate(row[col('차량번호')]) !== mutation.car_number
    || S(row[col('차종코드')]) !== mutation.expected_current_code) {
    throw new Error(`쓰기 직전 CAS 실패 행 ${mutation.row}; 전체 apply 중단`);
  }
}
const data = mutations.flatMap((mutation) => Object.entries(mutation.cells).map(([name, value]) => ({
  range: `'${PRODUCT_MASTER_TAB}'!${colLabel(col(name))}${mutation.row}`,
  majorDimension: 'ROWS', values: [[value]],
})));
if (data.length !== expectedSafeCount * 5) throw new Error(`허용 셀 수 65와 다름: ${data.length}`);
const response = await fetch(`${endpoint}/values:batchUpdate`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ valueInputOption: 'RAW', data }), signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`셀 단위 batchUpdate 실패 ${response.status}: ${(await response.text()).slice(0, 500)}`);
console.log(JSON.stringify({ mode: 'applied', rows: mutations.length, cells: data.length }, null, 2));
