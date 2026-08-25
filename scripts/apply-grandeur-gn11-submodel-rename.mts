/**
 * 세부모델 「더 뉴 그랜저 GN11」→「그랜저 GN11」(더 뉴+개발코드 중첩 금지 · GN7 표기와 정렬).
 * 기본 dry-run. 키/순번 불변.
 *
 *   npx tsx scripts/apply-grandeur-gn11-submodel-rename.mts
 *   npx tsx scripts/apply-grandeur-gn11-submodel-rename.mts --apply --confirm=RENAME_GRANDEUR_GN11_SUBMODEL_V1 --approval-reference=…
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';
import {
  TRIM_KEY_SEMANTIC_HEADERS_V3,
  auditTrimKeyContract,
  trimKeyRecordsFromValues,
  type TrimKeyRegistry,
} from '../lib/domain/vehicle-trim-key-contract';
import { buildVehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const CONFIRM = 'RENAME_GRANDEUR_GN11_SUBMODEL_V1';
const FROM = '더 뉴 그랜저 GN7';
const TO = '그랜저 GN11';
const arg = (name: string, fallback = '') =>
  (process.argv.find((v) => v.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({
  email: S(sa.client_email),
  key: S(sa.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com',
}).getAccessToken()).token!;
const base = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}`;
const api = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 600)}`);
  return body;
};

const live = await api(`${base}/values/${encodeURIComponent(`'${MASTER_TAB}'!A:AF`)}`) as { values?: unknown[][] };
const values = live.values || [];
const headers = (values[0] || []).map(S);
const subCol = headers.indexOf('세부모델');
const keyCol = headers.indexOf('트림행키');
if (subCol < 0 || keyCol < 0) throw new Error('세부모델/트림행키 열 없음');

const patches: Array<{ row: number; key: string; from: string; to: string }> = [];
values.slice(1).forEach((row, index) => {
  if (S(row[subCol]) !== FROM) return;
  patches.push({ row: index + 2, key: S(row[keyCol]), from: FROM, to: TO });
});

const colName = (index: number) => {
  let n = index + 1;
  let out = '';
  while (n) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry_run',
  from: FROM,
  to: TO,
  patches: patches.length,
  keys: patches.map((p) => p.key),
}, null, 2));

if (!APPLY) {
  console.log(`dry-run 끝. --apply --confirm=${CONFIRM} --approval-reference=…`);
  process.exit(0);
}
if (arg('confirm') !== CONFIRM) throw new Error(`--confirm=${CONFIRM} 필요`);
if (!arg('approval-reference')) throw new Error('--approval-reference 필요');

mkdirSync('tmp', { recursive: true });
const snapshotPath = `tmp/grandeur-gn11-submodel-rename-snapshot-${Date.now()}.json`;
writeFileSync(snapshotPath, `${JSON.stringify({ values, patches }, null, 2)}\n`);

if (patches.length) {
  await api(`${base}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: patches.map((p) => ({
        range: `'${MASTER_TAB}'!${colName(subCol)}${p.row}`,
        values: [[TO]],
      })),
    }),
  });
}

const after = await api(`${base}/values/${encodeURIComponent(`'${MASTER_TAB}'!A:AF`)}`) as { values?: unknown[][] };
const afterValues = after.values || [];
const remaining = afterValues.slice(1).filter((row) => S(row[subCol]) === FROM).length;
if (remaining) throw new Error(`반영 후에도 ${FROM} 잔여 ${remaining}`);
const renamed = afterValues.slice(1).filter((row) => S(row[subCol]) === TO && S(row[keyCol]).includes('sm-gn11__the-new-grandeur')).length;
if (renamed !== 18) throw new Error(`그랜저 GN11 행수 불일치 ${renamed}`);

const liveRecords = trimKeyRecordsFromValues(afterValues, [...TRIM_KEY_SEMANTIC_HEADERS_V3]);
const nextRegistry: TrimKeyRegistry = {
  schemaVersion: 3,
  spreadsheetId: MASTER_SHEET_ID,
  sheetName: MASTER_TAB,
  capturedAt: new Date().toISOString(),
  semanticHeaders: [...TRIM_KEY_SEMANTIC_HEADERS_V3],
  records: liveRecords,
};
const audit = auditTrimKeyContract(nextRegistry, liveRecords);
if (!audit.ok) throw new Error(`키감사 실패: ${audit.issues.slice(0, 5).map((i) => i.kind).join(',')}`);

writeFileSync('data/vehicle-trim-key-registry.json', `${JSON.stringify(nextRegistry, null, 2)}\n`);
writeFileSync(
  'public/data/vehicle-trim-master.json',
  `${JSON.stringify(buildVehicleTrimMasterArtifact(afterValues, MASTER_SHEET_ID, MASTER_TAB), null, 2)}\n`,
);

console.log(JSON.stringify({
  mode: 'applied_verified',
  approvalReference: arg('approval-reference'),
  sheetPatches: patches.length,
  renamed,
  snapshotPath,
  key_contract_issues: 0,
}, null, 2));
