/**
 * 번호없음·차량명있음·저주행(≤300km) 후보 크로스체크 (read-only).
 * 시트 반영분 + ERP v4 저장본을 같이 본다.
 */
import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import nextEnv from '@next/env';
import { fetchAllPartnerSheets } from '../lib/domain/sheet-sync-all';
import { isExactRealPlate, TEMP_PLATE_RE } from '../lib/domain/product';
import {
  parseDelimited,
  type SheetTableFetchOptions,
} from '../lib/domain/sheet-import';
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
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
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
  if (!response.ok || !body.access_token) throw new Error(body.error_description || `Google OAuth ${response.status}`);
  return body.access_token;
}

async function visibleTable(url: string, gid?: string): Promise<string[][]> {
  const id = extractGoogleSheetId(url);
  if (!id || !gid) throw new Error('숨김 행 제외 연동은 일반 시트 URL과 gid가 필요합니다');
  if (!token) token = await sheetsToken();
  const getJson = async (apiUrl: string): Promise<SheetsGridResponse & { error?: { message?: string } }> => {
    const response = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => ({})) as SheetsGridResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || `Google Sheets API ${response.status}`);
    return body;
  };
  const metadata = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`,
  );
  const target = metadata.sheets?.find((sheet) => sheet.properties?.sheetId === Number(gid));
  if (!target?.properties) throw new Error(`Google Sheet 탭 없음(gid ${gid})`);
  if (target.properties.hidden) throw new Error(`숨김 탭은 연동할 수 없습니다(${target.properties.title || gid})`);
  const a1Title = `'${String(target.properties.title || '').replace(/'/g, "''")}'`;
  const fields = [
    'sheets(properties(sheetId,title,hidden)',
    'data(startRow,rowData(values(formattedValue,effectiveValue)),rowMetadata(hiddenByFilter,hiddenByUser)))',
  ].join(',');
  const body = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&ranges=${encodeURIComponent(a1Title)}&fields=${encodeURIComponent(fields)}`,
  );
  return visibleRowsFromGridResponse(body, gid).rows;
}

async function fetchTable(
  url: string,
  gid?: string,
  options: SheetTableFetchOptions = {},
): Promise<string[][]> {
  if (options.visibleRowsOnly) return visibleTable(url, gid);
  const response = await fetch(resolveGoogleSheetCsvUrl(url, gid), {
    redirect: 'follow',
    headers: { 'User-Agent': 'freepasserp4-nameless-plate-audit/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`시트 로드 실패 ${response.status}`);
  const text = await response.text();
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('시트 비공개 또는 로그인 HTML 응답');
  return parseDelimited(text);
}

function rows(raw: unknown): EntityRecord[] {
  return Object.entries((raw || {}) as Record<string, EntityRecord>)
    .filter(([, row]) => row && typeof row === 'object')
    .map(([key, row]) => ({ ...row, _key: key, partner_code: row.partner_code || key }));
}

/** 주행거리 문자열 → km (만km·콤마·단위 허용). 파싱 실패면 null. */
function parseKm(raw: unknown): number | null {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (!s || s === '-' || s === '—') return null;
  const man = s.match(/^([\d.]+)\s*만\s*(?:km|KM|킬로)?$/i);
  if (man) return Math.round(Number(man[1]) * 10_000);
  const n = s.match(/^([\d.]+)\s*(?:km|KM|킬로)?$/i);
  if (n && Number.isFinite(Number(n[1]))) return Math.round(Number(n[1]));
  const digits = s.replace(/[^\d.]/g, '');
  if (digits && Number.isFinite(Number(digits))) return Math.round(Number(digits));
  return null;
}

function vehicleName(row: EntityRecord): string {
  return [row.maker, row.model, row.sub_model, row.trim_name]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function plateOf(row: EntityRecord): string {
  return String(row.car_number || '').replace(/\s/g, '');
}

function isTemp(row: EntityRecord): boolean {
  const plate = plateOf(row);
  return row.is_pending_plate === true || TEMP_PLATE_RE.test(plate);
}

function hasName(row: EntityRecord): boolean {
  return !!vehicleName(row) || !!String(row.vehicle_name || row.car_name || '').trim();
}

type Hit = {
  where: string;
  provider: string;
  plate: string;
  name: string;
  km: number | null;
  status: string;
  kind: 'pending' | 'no_exact_plate' | 'low_km_named';
};

const KM_CAP = 300;

function classify(row: EntityRecord, where: string): Hit | null {
  const plate = plateOf(row);
  const name = vehicleName(row) || String(row.vehicle_name || row.car_name || '').trim();
  const km = parseKm(row.mileage);
  const provider = String(row.provider_company_code || row.partner_code || '?');
  const status = String(row.vehicle_status || '');
  if (isTemp(row) && hasName(row)) {
    return { where, provider, plate: plate || '(임시미부여)', name, km, status, kind: 'pending' };
  }
  if (!isExactRealPlate(plate) && hasName(row) && !isTemp(row)) {
    return { where, provider, plate: plate || '(공란)', name, km, status, kind: 'no_exact_plate' };
  }
  if (km != null && km <= KM_CAP && hasName(row) && !isExactRealPlate(plate)) {
    return { where, provider, plate: plate || '(공란)', name, km, status, kind: 'low_km_named' };
  }
  return null;
}

const [partnersSnap, productsSnap] = await Promise.all([
  db.ref('partners').get(),
  db.ref('v4/products').get(),
]);
const partnerRows = rows(partnersSnap.val());
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const master = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const fetched = await fetchAllPartnerSheets('freepass', master, { partnerRows, fetchTable });

console.log('══ 시트 반영분 — 번호없음/임시번호 + 차량명 ══');
const sheetHits: Hit[] = [];
const sheetLowKmReal: { provider: string; plate: string; name: string; km: number }[] = [];
for (const line of fetched.lines) {
  for (const row of line.products) {
    const hit = classify(row, `sheet:${line.code}`);
    if (hit) sheetHits.push(hit);
    const km = parseKm(row.mileage);
    if (km != null && km <= KM_CAP && isExactRealPlate(plateOf(row))) {
      sheetLowKmReal.push({
        provider: line.code,
        plate: plateOf(row),
        name: vehicleName(row),
        km,
      });
    }
  }
  for (const issue of line.issueSamples || []) {
    if (/미정|번호미정|잘못된 차번|무효/.test(issue)) {
      console.log(`  issue ${line.code}: ${issue}`);
    }
  }
}
console.log(`  후보 ${sheetHits.length}건`);
for (const h of sheetHits.slice(0, 40)) {
  console.log(
    `  [${h.kind}] ${h.provider} · ${h.plate} · ${h.name || '(차명없음)'} · ${h.km == null ? 'km?' : `${h.km}km`} · ${h.status || '-'}`,
  );
}
if (sheetHits.length > 40) console.log(`  … +${sheetHits.length - 40}`);

console.log(`\n══ 시트 반영분 — 실차번이지만 주행 ≤${KM_CAP}km (신차·저주행 참고) ══`);
console.log(`  ${sheetLowKmReal.length}대`);
const byProv = new Map<string, number>();
for (const r of sheetLowKmReal) byProv.set(r.provider, (byProv.get(r.provider) || 0) + 1);
console.log(`  공급사별: ${[...byProv.entries()].map(([c, n]) => `${c} ${n}`).join(' · ') || '(없음)'}`);
for (const r of sheetLowKmReal.slice(0, 25)) {
  console.log(`  ${r.provider} · ${r.plate} · ${r.name} · ${r.km}km`);
}
if (sheetLowKmReal.length > 25) console.log(`  … +${sheetLowKmReal.length - 25}`);

console.log('\n══ ERP v4 활성 — 번호없음/임시번호 + 차량명 ══');
const erpRows = Object.entries((productsSnap.val() || {}) as Record<string, EntityRecord>)
  .map(([key, row]) => ({ ...row, _key: key }))
  .filter((row) => row && typeof row === 'object'
    && row._deleted !== true
    && !row.deletedAt
    && String(row.status || '') !== 'deleted');

const erpHits: Hit[] = [];
const erpLowKmNoPlate: Hit[] = [];
const erpLowKmAny: { provider: string; plate: string; name: string; km: number; pending: boolean }[] = [];
for (const row of erpRows) {
  const hit = classify(row, 'erp');
  if (hit) erpHits.push(hit);
  const km = parseKm(row.mileage);
  const plate = plateOf(row);
  const name = vehicleName(row);
  if (km != null && km <= KM_CAP) {
    erpLowKmAny.push({
      provider: String(row.provider_company_code || row.partner_code || '?'),
      plate: plate || '(공란)',
      name,
      km,
      pending: isTemp(row),
    });
    if (!isExactRealPlate(plate) && hasName(row)) {
      const h = hit || {
        where: 'erp',
        provider: String(row.provider_company_code || row.partner_code || '?'),
        plate: plate || '(공란)',
        name,
        km,
        status: String(row.vehicle_status || ''),
        kind: 'low_km_named' as const,
      };
      erpLowKmNoPlate.push(h);
    }
  }
}

const pending = erpHits.filter((h) => h.kind === 'pending');
const noExact = erpHits.filter((h) => h.kind === 'no_exact_plate');
console.log(`  임시번호+차명 ${pending.length} · 비정상차번+차명 ${noExact.length}`);
const pendingProv = new Map<string, number>();
for (const h of pending) pendingProv.set(h.provider, (pendingProv.get(h.provider) || 0) + 1);
console.log(`  임시번호 공급사: ${[...pendingProv.entries()].map(([c, n]) => `${c} ${n}`).join(' · ') || '(없음)'}`);

console.log(`\n══ ERP — 주행 ≤${KM_CAP}km 전체 ══`);
console.log(`  ${erpLowKmAny.length}대 (그중 번호없음/임시 ${erpLowKmNoPlate.length})`);
const lowProv = new Map<string, { all: number; noPlate: number }>();
for (const r of erpLowKmAny) {
  const b = lowProv.get(r.provider) || { all: 0, noPlate: 0 };
  b.all += 1;
  if (r.pending || !isExactRealPlate(r.plate)) b.noPlate += 1;
  lowProv.set(r.provider, b);
}
for (const [c, b] of [...lowProv.entries()].sort((a, b) => b[1].all - a[1].all)) {
  console.log(`  ${c}: 저주행 ${b.all} · 번호없음/임시 ${b.noPlate}`);
}
console.log('\n  번호없음·저주행 표본:');
for (const h of erpLowKmNoPlate.slice(0, 40)) {
  console.log(
    `  ${h.provider} · ${h.plate} · ${h.name || '(차명없음)'} · ${h.km}km · ${h.status || '-'} · ${h.kind}`,
  );
}
if (erpLowKmNoPlate.length > 40) console.log(`  … +${erpLowKmNoPlate.length - 40}`);

console.log('\n── 요약 ──');
console.log(`시트 반영: 번호없음/임시+차명 ${sheetHits.length} · 실차번+≤${KM_CAP}km ${sheetLowKmReal.length}`);
console.log(`ERP 활성: 임시+차명 ${pending.length} · 비정상차번+차명 ${noExact.length} · ≤${KM_CAP}km ${erpLowKmAny.length} (번호없음 ${erpLowKmNoPlate.length})`);
