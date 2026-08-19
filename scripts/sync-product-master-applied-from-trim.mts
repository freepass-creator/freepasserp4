/**
 * 매칭된(차종코드 있는) 상품의 「차종마스터 적용값」을 현재 차종마스터 artifact 이름으로 동기화.
 * 기본 dry-run. 코드·상태·돈·잠금 칸은 쓰지 않는다.
 *
 *   npx tsx scripts/sync-product-master-applied-from-trim.mts
 *   npx tsx scripts/sync-product-master-applied-from-trim.mts --apply --confirm=SYNC_PRODUCT_MASTER_APPLIED_FROM_TRIM_V1 --approval-reference=…
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import { planProductMasterAppliedNamesFromTrim } from '../lib/domain/product-master-applied-name-sync';
import {
  DEFAULT_PRODUCT_MASTER_SHEET_ID,
  PRODUCT_MASTER_COLUMNS,
  PRODUCT_MASTER_TAB,
} from '../lib/domain/product-master-sheet';
import type { VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const CONFIRM = 'SYNC_PRODUCT_MASTER_APPLIED_FROM_TRIM_V1';
const arg = (name: string, fallback = '') =>
  (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
const sheetId = arg('sheet', DEFAULT_PRODUCT_MASTER_SHEET_ID);
const approval = arg('approval-reference');
const confirm = arg('confirm');
const snapshotPath = resolve(arg('snapshot', `tmp/product-master-applied-sync-snapshot-${Date.now()}.json`));

const artifactRaw = readFileSync('public/data/vehicle-trim-master.json', 'utf8');
const artifactHash = createHash('sha256').update(artifactRaw).digest('hex');
const artifact = JSON.parse(artifactRaw) as VehicleTrimMasterArtifact;
const byKey = new Map(artifact.records.map((row) => [row.trim_row_key, row]));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({
  email: S(sa.client_email),
  key: S(sa.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
if (!token) throw new Error('Sheets 토큰 없음');

const api = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sheets HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) as Rec : {};
};

const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
const range = encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AX`);
const live = await api(`${base}/values/${range}`) as { values?: unknown[][] };
const values = live.values || [];
const headers = (values[0] || []).map(S);
if (headers.length !== PRODUCT_MASTER_COLUMNS.length
  || PRODUCT_MASTER_COLUMNS.some((name, index) => headers[index] !== name)) {
  throw new Error('상품마스터 A:AX 헤더 불일치');
}

const plan = planProductMasterAppliedNamesFromTrim({ values, byKey });
const col = (name: (typeof PRODUCT_MASTER_COLUMNS)[number]) => PRODUCT_MASTER_COLUMNS.indexOf(name);
const colName = (index: number) => {
  let n = index + 1;
  let out = '';
  while (n) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};
const appliedCol = col('차종마스터 적용값');
const codeCol = col('차종코드');

mkdirSync(dirname(snapshotPath), { recursive: true });
writeFileSync(snapshotPath, `${JSON.stringify({
  generated_at: new Date().toISOString(),
  artifact_sha256: artifactHash,
  sheet_id: sheetId,
  plan,
}, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry_run',
  artifact_sha256: artifactHash,
  coded: plan.coded,
  unchanged: plan.unchanged,
  patches: plan.patches.length,
  missing_keys: plan.missing_keys,
  non_automatic: plan.non_automatic.length,
  sample: plan.patches.slice(0, 5).map((p) => `${p.car_number}: ${p.before} → ${p.after}`),
  snapshot: snapshotPath,
}, null, 2));

if (!APPLY) {
  console.log(`dry-run 끝. --apply --confirm=${CONFIRM} --approval-reference=…`);
  process.exit(0);
}
if (confirm !== CONFIRM) throw new Error(`--confirm=${CONFIRM} 필요`);
if (!approval) throw new Error('--approval-reference 필요');
if (!plan.patches.length) {
  console.log(JSON.stringify({ mode: 'apply-noop', patches: 0 }, null, 2));
  process.exit(0);
}

const updates = plan.patches.map((patch) => ({
  range: `'${PRODUCT_MASTER_TAB}'!${colName(appliedCol)}${patch.row}`,
  values: [[patch.after]],
}));

// CAS: 쓰기 직전 재조회로 코드·기존 적용값 일치 확인
const live2 = await api(`${base}/values/${range}`) as { values?: unknown[][] };
const values2 = live2.values || [];
for (const patch of plan.patches) {
  const row = values2[patch.row - 1] || [];
  if (S(row[codeCol]) !== patch.code || S(row[appliedCol]) !== patch.before) {
    throw new Error(`CAS 불일치 row ${patch.row} ${patch.car_number}`);
  }
}

await api(`${base}/values:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
});

const after = await api(`${base}/values/${range}`) as { values?: unknown[][] };
const afterValues = after.values || [];
for (const patch of plan.patches) {
  const row = afterValues[patch.row - 1] || [];
  if (S(row[codeCol]) !== patch.code || S(row[appliedCol]) !== patch.after) {
    throw new Error(`적용 후 검증 실패 row ${patch.row}`);
  }
}

console.log(JSON.stringify({
  mode: 'applied_verified',
  approvalReference: approval,
  patches: plan.patches.length,
  missing_keys: plan.missing_keys,
  snapshot: snapshotPath,
}, null, 2));
