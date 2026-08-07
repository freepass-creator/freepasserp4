/**
 * 공급사 시트 전수 점검 — 탭 설정 vs 실제 시트 탭 · 탭별 반영 · 사진.
 * 쓰기 없음. 실제 검증과 같은 visible Grid + fetchAllPartnerSheets.
 *
 *   npx tsx scripts/audit-all-sheet-tabs.mts
 *   npx tsx scripts/audit-all-sheet-tabs.mts --code=RP012
 */
import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import nextEnv from '@next/env';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import {
  importSheetTable,
  parseDelimited,
  parseDepositRule,
  parseMappingHeaderSignature,
  parseMappingProfile,
  type SheetTableFetchOptions,
} from '../lib/domain/sheet-import';
import { fetchAllPartnerSheets, isWebInventoryPartner } from '../lib/domain/sheet-sync-all';
import { extractGoogleSheetId, resolveGoogleSheetCsvUrl } from '../lib/domain/sheet-url';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import type { EntityRecord } from '../lib/intake/entities';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

nextEnv.loadEnvConfig(process.cwd());
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
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

type SheetMeta = { gid: string; title: string; hidden: boolean };

async function listSheetTabs(url: string): Promise<SheetMeta[]> {
  const id = extractGoogleSheetId(url);
  if (!id) throw new Error('시트 ID 없음');
  if (!token) token = await sheetsToken();
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
  );
  const body = await response.json().catch(() => ({})) as SheetsGridResponse & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Sheets ${response.status}`);
  return (body.sheets || []).map((s) => ({
    gid: String(s.properties?.sheetId ?? ''),
    title: String(s.properties?.title || ''),
    hidden: !!s.properties?.hidden,
  })).filter((s) => s.gid);
}

async function fetchGrid(url: string, gid: string) {
  const id = extractGoogleSheetId(url);
  if (!id) throw new Error('시트 ID 없음');
  if (!token) token = await sheetsToken();
  const getJson = async (apiUrl: string) => {
    const response = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(40_000),
    });
    const body = await response.json().catch(() => ({})) as SheetsGridResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || `Sheets ${response.status}`);
    return body;
  };
  const tabs = await listSheetTabs(url);
  const target = tabs.find((t) => t.gid === gid);
  if (!target) throw new Error(`탭 없음 gid=${gid}`);
  if (target.hidden) throw new Error(`숨김 탭 ${target.title}`);
  const a1 = `'${target.title.replace(/'/g, "''")}'`;
  const fields = [
    'sheets(properties(sheetId,title,hidden)',
    'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
  ].join(',');
  const body = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&ranges=${encodeURIComponent(a1)}&fields=${encodeURIComponent(fields)}`,
  );
  return { title: target.title, ...visibleRowsFromGridResponse(body, gid) };
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
    headers: { 'User-Agent': 'freepasserp4-all-sheet-tabs/1.0' },
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

function isSheetPartner(p: EntityRecord): boolean {
  if (!String(p.sheet_url || '').trim()) return false;
  if (isWebInventoryPartner(p)) return false;
  if (p._deleted === true || p.deletedAt || String(p.status || '') === 'deleted') return false;
  return !/영업|sales/i.test(String(p.partner_type || ''));
}

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

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const master = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

let partners = [...merged.values()].filter(isSheetPartner);
if (ONLY) partners = partners.filter((p) => String(p.partner_code || p._key || '') === ONLY);
partners.sort((a, b) => String(a.partner_code || '').localeCompare(String(b.partner_code || '')));

console.log(`══ 공급사 시트 전수 점검 ${partners.length}곳 · 쓰기 없음 ══\n`);

type Summary = {
  code: string;
  name: string;
  adapter: string;
  configuredTabs: number;
  sheetVisibleTabs: number;
  unusedVisible: string[];
  missingConfigured: string[];
  imported: number;
  photos: number;
  cellLinks: number;
  excluded: number;
  overlap: number;
  ok: boolean;
  note: string;
};
const summaries: Summary[] = [];

for (const partner of partners) {
  const code = String(partner.partner_code || partner._key || '');
  const name = String(partner.name || partner.partner_name || code);
  let o;
  try {
    o = partnerSheetOpts(partner);
  } catch (e) {
    console.log(`✗ ${code} ${name} — 설정 오류: ${String((e as Error).message || e)}\n`);
    summaries.push({
      code, name, adapter: '?', configuredTabs: 0, sheetVisibleTabs: 0,
      unusedVisible: [], missingConfigured: [], imported: 0, photos: 0, cellLinks: 0,
      excluded: 0, overlap: 0, ok: false, note: String((e as Error).message || e),
    });
    continue;
  }
  const adapter = resolveAdapter(partner);
  console.log(`── ${code} ${name} · adapter=${adapter.id} · 설정탭 ${o.gids.length || 0} ──`);
  console.log(`   gid설정: ${o.gids.join(',') || '(없음)'} · header_row=${o.headerRow}`);

  let tabs: SheetMeta[] = [];
  try {
    tabs = await listSheetTabs(o.url);
  } catch (e) {
    console.log(`   시트 메타 FAIL — ${String((e as Error).message || e)}\n`);
    summaries.push({
      code, name, adapter: adapter.id, configuredTabs: o.gids.length, sheetVisibleTabs: 0,
      unusedVisible: [], missingConfigured: o.gids, imported: 0, photos: 0, cellLinks: 0,
      excluded: 0, overlap: 0, ok: false, note: String((e as Error).message || e),
    });
    continue;
  }
  const visibleTabs = tabs.filter((t) => !t.hidden);
  const configured = new Set(o.gids);
  const missingConfigured = o.gids.filter((g) => !tabs.some((t) => t.gid === g));
  const unusedVisible = visibleTabs
    .filter((t) => !configured.has(t.gid))
    .map((t) => `${t.title}:${t.gid}`);

  console.log(`   시트 탭 전체 ${tabs.length} (표시 ${visibleTabs.length} · 숨김 ${tabs.length - visibleTabs.length})`);
  console.log(`   표시 탭: ${visibleTabs.map((t) => `${t.title}(${t.gid})`).join(' · ') || '(없음)'}`);
  if (missingConfigured.length) console.log(`   ⚠ 설정됐지만 시트에 없음: ${missingConfigured.join(',')}`);
  if (unusedVisible.length) console.log(`   ⚠ 시트에 있는데 설정 안 된 표시탭: ${unusedVisible.join(' · ')}`);

  let tabCellLinks = 0;
  for (const gid of o.gids) {
    const meta = tabs.find((t) => t.gid === gid);
    const label = meta?.title || gid;
    try {
      const grid = await fetchGrid(o.url, gid);
      const prepared = adapter.prepareTable(grid.rows, { headerRow: o.headerRow });
      const imported = importSheetTable(prepared, {
        providerCode: code,
        entries: master,
        profile: parseMappingProfile(partner.mapping_profile),
        profileHeaders: parseMappingHeaderSignature(partner.mapping_header_signature),
        depositRule: parseDepositRule(partner.deposit_rule),
        photoByPlate: grid.photoByPlate,
      });
      const links = Object.keys(grid.photoByPlate || {}).length;
      tabCellLinks += links;
      const withPhoto = imported.products.filter((p) => String(p.photo_link || '').trim()).length;
      console.log(
        `   [${label}|${gid}] 행 ${grid.rows.length} · 셀링크 ${links}`
        + ` · 반영 ${imported.imported} · 제외 ${imported.excludedCount}`
        + ` · 사진 ${withPhoto}/${imported.imported}`
        + ` · 무효 ${imported.invalidCount} · 중복 ${imported.duplicateCount}`,
      );
    } catch (e) {
      console.log(`   [${label}|${gid}] FAIL — ${String((e as Error).message || e)}`);
    }
  }

  let ok = false;
  let imported = 0;
  let photos = 0;
  let excluded = 0;
  let overlap = 0;
  let note = '';
  try {
    const fetched = await fetchAllPartnerSheets('freepass', master, {
      partnerRows: [partner],
      fetchTable,
    });
    const line = fetched.lines[0];
    if (line) {
      ok = line.ok;
      imported = line.imported;
      excluded = line.excludedCount;
      overlap = line.duplicateCount;
      photos = line.products.filter((p) => String(p.photo_link || '').trim()).length;
      note = line.message;
      console.log(`   병합: ${line.message}`);
      console.log(`   → 반영 ${imported} · 사진 ${photos}/${imported} · 제외 ${excluded} · 중복 ${overlap}`);
    } else {
      note = '라인 없음';
      console.log('   병합: 라인 없음');
    }
  } catch (e) {
    note = String((e as Error).message || e);
    console.log(`   병합 FAIL — ${note}`);
  }
  console.log('');
  summaries.push({
    code, name, adapter: adapter.id,
    configuredTabs: o.gids.length,
    sheetVisibleTabs: visibleTabs.length,
    unusedVisible, missingConfigured,
    imported, photos, cellLinks: tabCellLinks,
    excluded, overlap, ok, note,
  });
}

console.log('══ 요약 ══');
console.log('code   name                 adpt tabs sheet 반영  사진  미설정표시탭');
let sumIn = 0;
let sumPhoto = 0;
for (const s of summaries) {
  sumIn += s.imported;
  sumPhoto += s.photos;
  const warn = [
    s.missingConfigured.length ? `설정탭없음:${s.missingConfigured.join(',')}` : '',
    s.unusedVisible.length ? `미설정${s.unusedVisible.length}` : '',
    !s.ok ? 'FAIL' : '',
    s.configuredTabs >= 2 ? `${s.configuredTabs}탭` : '',
  ].filter(Boolean).join('·') || '-';
  console.log(
    `${s.code.padEnd(7)} ${s.name.slice(0, 18).padEnd(18)} ${s.adapter.padEnd(8)}`
    + ` ${String(s.configuredTabs).padStart(2)}/${String(s.sheetVisibleTabs).padStart(2)}`
    + ` ${String(s.imported).padStart(4)} ${String(s.photos).padStart(3)}/${String(s.imported).padStart(3)}`
    + `  ${warn}`,
  );
  if (s.unusedVisible.length) {
    for (const u of s.unusedVisible) console.log(`         미설정탭 → ${u}`);
  }
}
console.log(`\n합계 반영 ${sumIn} · 사진 있는 매물 ${sumPhoto}/${sumIn}`);
const multi = summaries.filter((s) => s.configuredTabs >= 2);
console.log(`멀티탭 설정 ${multi.length}곳: ${multi.map((s) => `${s.code}(${s.configuredTabs})`).join(' · ') || '(없음)'}`);
const unusedAny = summaries.filter((s) => s.unusedVisible.length);
console.log(`표시탭 미설정 의심 ${unusedAny.length}곳: ${unusedAny.map((s) => s.code).join(' · ') || '(없음)'}`);
