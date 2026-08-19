/**
 * Live Sheet ↔ committed permanent-key registry audit.
 *
 * Usage:
 *   npm run audit:vehicle-trim-keys
 *   npm run audit:vehicle-trim-keys -- --register-new
 *
 * `--register-new` only appends genuinely new keys. It refuses to bless removal,
 * re-numbering, or a change in what an existing code means.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JWT } from 'google-auth-library';
import {
  TRIM_KEY_SEMANTIC_HEADERS,
  auditTrimKeyContract,
  trimKeyRecordsFromValues,
  type TrimKeyIssue,
  type TrimKeyRegistry,
} from '../lib/domain/vehicle-trim-key-contract';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, any>;
const S = (value: unknown) => String(value ?? '').trim();
const hasArg = (name: string) => process.argv.includes(`--${name}`);
const arg = (name: string) => S(process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3));
const registryPath = fileURLToPath(new URL('../data/vehicle-trim-key-registry.json', import.meta.url));

async function fetchLiveValues(): Promise<string[][]> {
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
      // The Workspace domain delegates the Sheets scope used by the other
      // read-only master audits. Requesting the separate readonly scope fails
      // before the audit can run even though this script never writes.
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      subject,
    }).getAccessToken()).token;
  } catch (cause) {
    throw new Error('읽기 전용 Sheets 자격증명이 없습니다. spreadsheets.readonly 위임을 설정하거나 --snapshot=<values.json>을 사용하세요.', { cause });
  }
  const range = `'${MASTER_TAB.replace(/'/g, "''")}'!A:AF`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => ({})) as Rec;
    if (response.ok) return (body.values || []) as string[][];
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 2_000 * 2 ** attempt)));
      continue;
    }
    throw new Error(body?.error?.message || `Google Sheets HTTP ${response.status}`);
  }
}

const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as TrimKeyRegistry;
const live = trimKeyRecordsFromValues(await fetchLiveValues(), registry.semanticHeaders);
const audit = auditTrimKeyContract(registry, live);
const nonAdditionIssues = audit.issues.filter((issue) => issue.kind !== 'UNREGISTERED_CODE');
const additions = audit.issues.filter((issue) => issue.kind === 'UNREGISTERED_CODE');

if (hasArg('register-new')) {
  if (nonAdditionIssues.length) {
    console.error('새 키 등록 거부: 기존 키 계약 위반을 먼저 해결해야 합니다.');
    printIssues(nonAdditionIssues);
    process.exit(1);
  }
  if (!additions.length) {
    console.log(`PASS — 새 키 없음 · 등록 ${registry.records.length} · 라이브 ${live.length}`);
    process.exit(0);
  }
  const known = new Set(registry.records.map((record) => record.code));
  const added = live.filter((record) => !known.has(record.code));
  const next: TrimKeyRegistry = {
    ...registry,
    capturedAt: new Date().toISOString().slice(0, 10),
    semanticHeaders: [...registry.semanticHeaders],
    records: [...registry.records, ...added].sort((a, b) => a.code.localeCompare(b.code)),
  };
  writeFileSync(registryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`PASS — 새 키 ${added.length}개만 기준판에 추가 · 총 ${next.records.length}`);
  process.exit(0);
}

console.log(`트림행키 영구계약 — 기준판 ${audit.registryCount} · 라이브 ${audit.liveCount}`);
if (audit.ok) {
  console.log('PASS — 삭제·재사용·순번변경·차량의미변경 0건');
} else {
  printIssues(audit.issues);
  process.exitCode = 1;
}

function printIssues(issues: TrimKeyIssue[]) {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issue.kind, (counts.get(issue.kind) || 0) + 1);
  for (const [kind, count] of counts) console.error(`  ${kind}: ${count}`);
  for (const issue of issues.slice(0, 30)) console.error(`  - ${issue.code || '-'}: ${issue.message}`);
  if (issues.length > 30) console.error(`  ... ${issues.length - 30}건 더 있음`);
}
