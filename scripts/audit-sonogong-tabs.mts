/**
 * 손오공 미설정 구독탭만 판독 — 쓰기 없음.
 * gid 2099220785
 */
import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import nextEnv from '@next/env';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import { importSheetTable, parseDepositRule, parseMappingHeaderSignature, parseMappingProfile } from '../lib/domain/sheet-import';
import { extractGoogleSheetId } from '../lib/domain/sheet-url';
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
    aud: tokenUri, iat: now, exp: now + 3600,
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

function rows(raw: unknown): EntityRecord[] {
  return Object.entries((raw || {}) as Record<string, EntityRecord>)
    .filter(([, row]) => row && typeof row === 'object')
    .map(([key, row]) => ({ ...row, _key: key }));
}

const [p3, p4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
const merged = new Map<string, EntityRecord>();
for (const row of [...rows(p3.val()), ...rows(p4.val())]) {
  const code = String(row.partner_code || row._key || '');
  if (code) merged.set(code, { ...(merged.get(code) || {}), ...row });
}
const partner = merged.get('RP012');
if (!partner) throw new Error('RP012 없음');
const o = partnerSheetOpts(partner);
const adapter = resolveAdapter(partner);
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const master = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

const gids = ['0', '2099220785'];
if (!token) token = await sheetsToken();
const id = extractGoogleSheetId(o.url)!;

for (const gid of gids) {
  const meta = await (await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )).json() as SheetsGridResponse;
  const target = meta.sheets?.find((s) => s.properties?.sheetId === Number(gid));
  const title = String(target?.properties?.title || gid);
  const a1 = `'${title.replace(/'/g, "''")}'`;
  const fields = [
    'sheets(properties(sheetId,title,hidden)',
    'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
  ].join(',');
  const body = await (await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&ranges=${encodeURIComponent(a1)}&fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )).json() as SheetsGridResponse & { error?: { message?: string } };
  if ((body as { error?: { message?: string } }).error) {
    console.log(`${title} FAIL`, (body as { error?: { message?: string } }).error?.message);
    continue;
  }
  const grid = visibleRowsFromGridResponse(body, gid);
  const prepared = adapter.prepareTable(grid.rows, { headerRow: o.headerRow });
  const r = importSheetTable(prepared, {
    providerCode: 'RP012',
    entries: master,
    profile: parseMappingProfile(partner.mapping_profile),
    profileHeaders: parseMappingHeaderSignature(partner.mapping_header_signature),
    depositRule: parseDepositRule(partner.deposit_rule),
    photoByPlate: grid.photoByPlate,
  });
  const photo = r.products.filter((p) => String(p.photo_link || '').trim()).length;
  console.log(
    `[${title}|${gid}] 행 ${grid.rows.length} · 셀링크 ${Object.keys(grid.photoByPlate || {}).length}`
    + ` · 반영 ${r.imported} · 제외 ${r.excludedCount} · 사진 ${photo}/${r.imported}`
    + ` · 무효 ${r.invalidCount} · 중복 ${r.duplicateCount} · 가격없음 ${r.noPriceCount}`,
  );
  for (const p of r.products.slice(0, 5)) {
    console.log(`   ${p.car_number} · ${p.maker || ''} ${p.model || ''} · ${p.vehicle_status || ''} · 사진${p.photo_link ? 'Y' : 'N'}`);
  }
  if (r.products.length > 5) console.log(`   … +${r.products.length - 5}`);
}
