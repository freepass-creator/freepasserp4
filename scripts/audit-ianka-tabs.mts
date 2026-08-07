/**
 * 이안카(RP031) 2탭 실측 — 쓰기 없음.
 * 설정(gid·어댑터) · 탭별 판독 · 겹침 · 사진 링크.
 */
import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import nextEnv from '@next/env';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import { importSheetTable, parseDelimited, type SheetTableFetchOptions } from '../lib/domain/sheet-import';
import { fetchAllPartnerSheets } from '../lib/domain/sheet-sync-all';
import { extractGoogleSheetId, resolveGoogleSheetCsvUrl } from '../lib/domain/sheet-url';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import type { EntityRecord } from '../lib/intake/entities';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

nextEnv.loadEnvConfig(process.cwd());
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const localEnv = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).flatMap((line) => {
    if (!line.trim() || /^\s*#/.test(line)) return [];
    const index = line.indexOf('=');
    if (index < 1) return [];
    return [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, '')]];
  }),
);
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(
    localEnv.GOOGLE_APPLICATION_CREDENTIALS
      || process.env.GOOGLE_APPLICATION_CREDENTIALS
      || 'tmp/firebase-auth/sa.json',
    'utf8',
  ));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();

let token = '';
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
async function sheetsToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = String(sa.token_uri || 'https://oauth2.googleapis.com/token');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), String(sa.private_key)).toString('base64url');
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description || `OAuth ${response.status}`);
  return body.access_token;
}

async function fetchGrid(url: string, gid: string) {
  const id = extractGoogleSheetId(url);
  if (!id) throw new Error('시트 ID 없음');
  if (!token) token = await sheetsToken();
  const getJson = async (apiUrl: string) => {
    const response = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => ({})) as SheetsGridResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || `Sheets ${response.status}`);
    return body;
  };
  const metadata = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`,
  );
  const target = metadata.sheets?.find((s) => s.properties?.sheetId === Number(gid));
  if (!target?.properties) throw new Error(`탭 없음 gid=${gid}`);
  const title = String(target.properties.title || gid);
  if (target.properties.hidden) throw new Error(`숨김 탭 ${title}`);
  const a1 = `'${title.replace(/'/g, "''")}'`;
  const fields = [
    'sheets(properties(sheetId,title,hidden)',
    'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
  ].join(',');
  const body = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&ranges=${encodeURIComponent(a1)}&fields=${encodeURIComponent(fields)}`,
  );
  return { title, ...visibleRowsFromGridResponse(body, gid) };
}

async function fetchTable(
  url: string,
  gid?: string,
  options: SheetTableFetchOptions = {},
): Promise<string[][]> {
  if (options.visibleRowsOnly) {
    const grid = await fetchGrid(url, String(gid || ''));
    options.onPhotoByPlate?.(grid.photoByPlate || {});
    return grid.rows;
  }
  const response = await fetch(resolveGoogleSheetCsvUrl(url, gid), {
    redirect: 'follow',
    headers: { 'User-Agent': 'freepasserp4-ianka-audit/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`CSV ${response.status}`);
  return parseDelimited(await response.text());
}

function rows(raw: unknown): EntityRecord[] {
  return Object.entries((raw || {}) as Record<string, EntityRecord>)
    .filter(([, row]) => row && typeof row === 'object')
    .map(([key, row]) => ({ ...row, _key: key }));
}

const TAB_LABEL: Record<string, string> = {
  '126495265': '재렌트',
  '2008897223': '메인',
};

const [partnersV3, partnersV4] = await Promise.all([
  db.ref('partners').get(),
  db.ref('v4/partners').get(),
]);
const merged = new Map<string, EntityRecord>();
for (const row of rows(partnersV3.val())) {
  const code = String(row.partner_code || row._key || '');
  if (code) merged.set(code, row);
}
for (const row of rows(partnersV4.val())) {
  const code = String(row.partner_code || row._key || '');
  if (code) merged.set(code, { ...(merged.get(code) || {}), ...row, _key: row._key || code });
}
const partner = [...merged.values()].find((p) => String(p.partner_code || p._key || '') === 'RP031');
if (!partner) throw new Error('RP031 파트너 없음');

const o = partnerSheetOpts(partner);
const adapter = resolveAdapter(partner);
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const master = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

console.log('══ 이안카 RP031 설정 ══');
console.log(`  이름: ${partner.name || partner.partner_name}`);
console.log(`  어댑터: ${adapter.id} (설정값 adapter_id=${String(partner.adapter_id || '(없음)')})`);
console.log(`  원본 gid 문자열: ${String(partner.sheet_gid || partner.sheet_tab || '(없음)')}`);
console.log(`  해석된 탭 순서(먼저 읽음=우선): ${o.gids.map((g) => `${TAB_LABEL[g] || '?'}:${g}`).join(' → ') || '(없음)'}`);
console.log(`  탭 수: ${o.gids.length}`);
console.log(`  header_row: ${o.headerRow}`);
console.log(`  sheet_url: ${o.url ? '있음' : '없음'}`);

if (o.gids.length !== 2) {
  console.log(`\n⚠ 기대 2탭인데 ${o.gids.length}탭 — 설정 확인 필요`);
}

console.log('\n══ 탭별 판독 (visible+사진) ══');
for (const gid of o.gids) {
  const label = TAB_LABEL[gid] || gid;
  try {
    const grid = await fetchGrid(o.url, gid);
    const prepared = adapter.prepareTable(grid.rows, { headerRow: o.headerRow });
    const imported = importSheetTable(prepared, {
      providerCode: 'RP031',
      entries: master,
      profile: undefined,
      depositRule: o.depositRule,
      photoByPlate: grid.photoByPlate,
    });
    const withPhoto = imported.products.filter((p) => String(p.photo_link || '').trim()).length;
    console.log(
      `  [${label} ${gid}] 시트제목="${grid.title}" · 가시행 ${grid.rows.length}`
      + ` · 셀링크 ${Object.keys(grid.photoByPlate || {}).length}`
      + ` · 반영 ${imported.imported} · 출고불가제외 ${imported.excludedCount}`
      + ` · 사진 ${withPhoto}/${imported.imported}`
      + ` · 무효 ${imported.invalidCount} · 중복 ${imported.duplicateCount}`,
    );
  } catch (e) {
    console.log(`  [${label} ${gid}] FAIL — ${String((e as Error).message || e)}`);
  }
}

console.log('\n══ 엔진 병합 (fetchAllPartnerSheets · 실제 검증 경로) ══');
const fetched = await fetchAllPartnerSheets('freepass', master, {
  partnerRows: [partner],
  fetchTable,
});
const line = fetched.lines[0];
if (!line) {
  console.log('  라인 없음');
} else {
  const withPhoto = line.products.filter((p) => String(p.photo_link || '').trim()).length;
  console.log(`  ok=${line.ok} · ${line.message}`);
  console.log(
    `  원본 ${line.sourceRowCount} · 반영 ${line.imported} · 출고불가제외 ${line.excludedCount}`
    + ` · 중복 ${line.duplicateCount} · 차단중복 ${line.blockingDuplicateCount ?? 0}`
    + ` · 무효 ${line.invalidCount} · 사진 ${withPhoto}/${line.imported}`,
  );
  if (line.issueSamples?.length) {
    for (const issue of line.issueSamples.slice(0, 8)) console.log(`    - ${issue}`);
  }
}
