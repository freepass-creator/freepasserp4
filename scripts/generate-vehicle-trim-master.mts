/** Generate the deterministic row-level ERP master from the Google Sheet SSOT. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JWT } from 'google-auth-library';
import { buildVehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import { auditTrimKeyContract, trimKeyRecordsFromValues, type TrimKeyRegistry } from '../lib/domain/vehicle-trim-key-contract';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, any>;
const S = (value: unknown) => String(value ?? '').trim();
const arg = (name: string) => S(process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3));
const hasArg = (name: string) => process.argv.includes(`--${name}`);
const outputPath = fileURLToPath(new URL('../public/data/vehicle-trim-master.json', import.meta.url));
const registryPath = fileURLToPath(new URL('../data/vehicle-trim-key-registry.json', import.meta.url));

async function fetchValues(): Promise<string[][]> {
  const snapshot = arg('snapshot');
  if (snapshot) {
    const parsed = JSON.parse(readFileSync(snapshot, 'utf8')) as string[][] | { values?: string[][] };
    return Array.isArray(parsed) ? parsed : parsed.values || [];
  }
  const credentialPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
  const serviceAccount = JSON.parse(readFileSync(credentialPath, 'utf8')) as Rec;
  const subject = S(process.env.GOOGLE_WORKSPACE_SUBJECT) || 'pyh@teamjpk.com';
  let token: string | null | undefined;
  try {
    token = (await new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      // Domain-wide delegation currently grants the Sheets scope used by the
      // live audits. This command remains read-only unless --write updates the
      // local artifact; it never writes to Google Sheets.
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      subject,
    }).getAccessToken()).token;
  } catch (cause) {
    throw new Error('읽기 전용 Sheets 자격증명이 없습니다. spreadsheets.readonly 위임을 설정하거나 --snapshot=<values.json>을 사용하세요.', { cause });
  }
  // AE:AF are staged V2 `차체구성`/`원문별칭` axes. Existing 30-column sheets still
  // serialize deterministically as A:AD because the artifact uses header width.
  const range = `'${MASTER_TAB.replace(/'/g, "''")}'!A:AF`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(body?.error?.message || `Google Sheets HTTP ${response.status}`);
  return (body.values || []) as string[][];
}

if (hasArg('write') === hasArg('check')) {
  throw new Error('정확히 하나를 지정하세요: --write 또는 --check');
}
const values = await fetchValues();
const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as TrimKeyRegistry;
const keyAudit = auditTrimKeyContract(registry, trimKeyRecordsFromValues(values, registry.semanticHeaders));
if (!keyAudit.ok) {
  throw new Error(`행키 영구계약 위반으로 생성 차단: ${keyAudit.issues.slice(0, 20).map((issue) => `${issue.kind}:${issue.code || '-'}`).join(', ')}`);
}
const artifact = buildVehicleTrimMasterArtifact(values, MASTER_SHEET_ID, MASTER_TAB);
const output = `${JSON.stringify(artifact, null, 2)}\n`;

if (hasArg('write')) {
  writeFileSync(outputPath, output, 'utf8');
  console.log(`PASS — 트림마스터 생성 ${artifact.row_count}행 · 수동 ${artifact.manual_assignable_count} · 자동 ${artifact.automatic_assignable_count} · 차단 ${artifact.blocked_count}`);
} else {
  const existing = readFileSync(outputPath, 'utf8');
  if (existing !== output) throw new Error('vehicle-trim-master.json이 현재 시트 스냅샷과 다릅니다.');
  console.log(`PASS — 트림마스터 드리프트 0 · ${artifact.row_count}행`);
}
