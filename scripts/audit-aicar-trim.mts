/**
 * 아이카(RP004) 트림 열 — 시트 헤더·파싱 vs ERP. 쓰기 없음.
 *
 *   npx tsx scripts/audit-aicar-trim.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import {
  HEADER_ALIASES,
  importSheetTable,
  parseDepositRule,
  parseMappingHeaderSignature,
  parseMappingProfile,
} from '../lib/domain/sheet-import';
import { extractGoogleSheetId } from '../lib/domain/sheet-url';
import { visibleRowsFromGridResponse } from '../lib/domain/sheet-visible-grid';
import { isListableProduct } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /(\d{2,3}[가-힣]\d{4})/;
const plateOf = (v: unknown) => (S(v).replace(/\s/g, '').match(PLATE) || [''])[0];
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/firebase.database',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
});
const token = (await jwt.getAccessToken()).token!;
const H = { Authorization: `Bearer ${token}` };
const db = async (n: string) => JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {};

const [prods, live, over] = await Promise.all([db('v4/products'), db('partners'), db('v4/partners')]);
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

const merged: Record<string, Rec> = {};
for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) {
  merged[k] = { ...(live[k] || {}), ...(over[k] || {}) };
}
const partner = Object.values(merged).find((p) => S(p.partner_code) === 'RP004');
if (!partner) throw new Error('RP004 없음');

const opts = partnerSheetOpts(partner);
const adapter = resolveAdapter(partner);
const id = extractGoogleSheetId(opts.url);
if (!id) throw new Error('sheet id 없음');
const api = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
const meta = await (await fetch(`${api}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`, { headers: H })).json() as any;
const tabs = (meta.sheets || []).map((s: any) => s.properties).filter((t: any) => !t.hidden);
const use = opts.gids.length ? tabs.filter((t: any) => opts.gids.includes(String(t.sheetId))) : tabs;
console.log(`\n══ 아이카(RP004) 트림 점검 ══`);
console.log(`adapter=${adapter.id} gids=${opts.gids.join(',') || '(all)'} headerRow=${opts.headerRow}`);
console.log(`tabs: ${use.map((t: any) => `${t.title}(${t.sheetId})`).join(', ')}`);

const FIELDS = [
  'sheets(properties(sheetId,title,hidden)',
  'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
].join(',');

const byPlate = new Map<string, Rec>();
for (const t of use) {
  const body = await (await fetch(
    `${api}?ranges=${encodeURIComponent(`'${t.title}'`)}&includeGridData=true&fields=${encodeURIComponent(FIELDS)}`,
    { headers: H },
  )).json() as any;
  const grid = visibleRowsFromGridResponse(body, String(t.sheetId));
  const prepared = adapter.prepareTable(grid.rows, { headerRow: opts.headerRow });
  const hdr = prepared[0] || [];
  console.log(`\n[${t.title}] 헤더 ${hdr.length}칸`);
  hdr.forEach((h: string, i: number) => {
    if (!S(h)) return;
    const key = (HEADER_ALIASES as Rec)[norm(h)] || '';
    console.log(`  ${String(i).padStart(2)} ${h}${key ? `  → ${key}` : '  (미매핑)'}`);
  });
  const r = importSheetTable(prepared, {
    providerCode: 'RP004',
    entries,
    profile: parseMappingProfile(partner.mapping_profile),
    profileHeaders: parseMappingHeaderSignature(partner.mapping_header_signature),
    depositRule: parseDepositRule(partner.deposit_rule),
    photoByPlate: grid.photoByPlate,
  });
  for (const p of r.products as Rec[]) {
    const pl = plateOf(p.car_number);
    if (pl) byPlate.set(pl, p);
  }
}

const erp = new Map<string, Rec>();
for (const p of Object.values(prods) as Rec[]) {
  if (!p || typeof p !== 'object') continue;
  if (p._deleted === true || S(p.status) === 'deleted') continue;
  if (S(p.provider_company_code) !== 'RP004') continue;
  if (!isListableProduct(p as never)) continue;
  const pl = plateOf(p.car_number);
  if (pl) erp.set(pl, p);
}

let sheetTrim = 0, erpTrim = 0, lost = 0, kept = 0, bothEmpty = 0;
const lostSamples: string[] = [];
for (const [pl, sheet] of byPlate) {
  const st = S(sheet.trim_name);
  const e = erp.get(pl);
  if (!e) continue;
  const et = S(e.trim_name);
  const ex = S(e.trim_extra);
  if (st) sheetTrim++;
  if (et || ex) erpTrim++;
  if (st && (et || ex)) kept++;
  else if (st && !et && !ex) {
    lost++;
    if (lostSamples.length < 20) {
      lostSamples.push(
        `${pl} 시트«${st}» raw«${S(e._raw_vehicle?.trim_name)}» `
        + `snap=${S(e._snap_confidence)} name=«${S(e.maker)} ${S(e.model)} ${S(e.sub_model)}»`,
      );
    }
  } else if (!st && !et && !ex) bothEmpty++;
}

console.log(`\n시트파싱 ${byPlate.size}대 · ERP listable 매칭 ${[...byPlate.keys()].filter((k) => erp.has(k)).length}`);
console.log(`시트 trim_name ${sheetTrim} · ERP trim/extra ${erpTrim} · 유지 ${kept} · 유실 ${lost} · 둘다없음 ${bothEmpty}`);
if (lostSamples.length) {
  console.log('\n■ 시트엔 트림 있는데 ERP 빈칸');
  for (const s of lostSamples) console.log('  ' + s);
}
process.exit(0);
