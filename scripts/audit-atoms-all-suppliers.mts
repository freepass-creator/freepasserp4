/**
 * 공급사 시트 **전수 원자 점검** — 시트에서 끌어온 값이 원자로 제대로 서는가.
 *
 * 실제 유입 경로(어댑터 → importSheetTable)를 그대로 태운다. 쓰기 없음.
 * 여기서 비는 칸은 «공급사가 안 적었거나 우리가 못 읽는 것»이고, 둘은 대응이 다르다 —
 * 안 적힌 건 표준양식으로 물어보면 되고, 못 읽는 건 우리가 고쳐야 한다.
 *
 *   npx tsx scripts/audit-atoms-all-suppliers.mts
 *   npx tsx scripts/audit-atoms-all-suppliers.mts --code=RP023
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import {
  importSheetTable, parseDepositRule, parseMappingHeaderSignature, parseMappingProfile,
} from '../lib/domain/sheet-import';
import { extractGoogleSheetId } from '../lib/domain/sheet-url';
import { visibleRowsFromGridResponse } from '../lib/domain/sheet-visible-grid';
import { parseProductOptions } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const arg = (n: string) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
]});
const token = (await jwt.getAccessToken()).token;
const H = { Authorization: `Bearer ${token}` };
const db = async (n: string) => JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {};

const [live, over] = await Promise.all([db('partners'), db('v4/partners')]);
const merged: Record<string, Rec> = {};
for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) {
  merged[k] = { ...(live[k] || {}), ...(over[k] || {}), _key: k };
}
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

const only = arg('code').toUpperCase();
const seen = new Set<string>();
const targets = Object.values(merged).filter((p) => {
  const code = S(p.partner_code) || S(p._key);
  if (!S(p.sheet_url) || seen.has(code)) return false;
  if (only && code !== only) return false;
  seen.add(code);
  return true;
});

const ATOMS = ['car_number', 'vehicle_status', 'product_type', 'maker', 'sub_model', 'trim_name',
  'year', 'fuel_type', 'engine_cc', 'mileage', 'ext_color', 'int_color', 'seats', 'drive_type',
  'options', 'photo_link', 'vin', 'partner_memo'] as const;

type Row = { code: string; name: string; n: number; fill: Map<string, number>; periods: Set<string>;
  noRent: number; noDeposit: number; review: number; err: string };
const rows: Row[] = [];

for (const partner of targets) {
  const code = S(partner.partner_code) || S(partner._key);
  const name = (S(partner.partner_name) || S(partner.company_name) || S(partner.name) || code).slice(0, 14);
  const row: Row = { code, name, n: 0, fill: new Map(), periods: new Set(), noRent: 0, noDeposit: 0, review: 0, err: '' };
  rows.push(row);
  try {
    const opts = partnerSheetOpts(partner);
    const adapter = resolveAdapter(partner);
    const id = extractGoogleSheetId(opts.url);
    const api = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
    const meta = await (await fetch(`${api}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`, { headers: H })).json() as any;
    const tabs = (meta.sheets || []).map((s: any) => s.properties).filter((t: any) => !t.hidden);
    // 설정 탭이 있으면 그것만, 없으면 표시 탭 전부(오플처럼 어댑터가 고르는 곳).
    const use = opts.gids.length ? tabs.filter((t: any) => opts.gids.includes(String(t.sheetId))) : tabs;
    const fields = ['sheets(properties(sheetId,title,hidden)',
      'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink)),rowMetadata(hiddenByFilter,hiddenByUser)))'].join(',');
    for (const t of use) {
      const body = await (await fetch(`${api}?ranges=${encodeURIComponent(`'${t.title}'`)}&includeGridData=true&fields=${encodeURIComponent(fields)}`, { headers: H })).json() as any;
      const grid = visibleRowsFromGridResponse(body, String(t.sheetId));
      let r;
      try {
        r = importSheetTable(adapter.prepareTable(grid.rows, { headerRow: opts.headerRow }), {
          providerCode: code, entries,
          profile: parseMappingProfile(partner.mapping_profile),
          profileHeaders: parseMappingHeaderSignature(partner.mapping_header_signature),
          depositRule: parseDepositRule(partner.deposit_rule),
        });
      } catch { continue; }              // 그 탭이 표가 아닌 경우(공지 등)
      for (const p of r.products as Rec[]) {
        row.n++;
        for (const a of ATOMS) {
          const v = a === 'options' ? (parseProductOptions(p.options).length ? '1' : '') : S(p[a]);
          if (v) row.fill.set(a, (row.fill.get(a) || 0) + 1);
        }
        if (p._needs_master_review === true) row.review++;
        const price = (p.price || {}) as Record<string, Rec>;
        const keys = Object.keys(price);
        if (!keys.length) row.noRent++;
        for (const k of keys) {
          row.periods.add(k);
          if (!N(price[k]?.deposit)) row.noDeposit++;
        }
      }
    }
  } catch (e) {
    row.err = String((e as Error)?.message || e).slice(0, 60);
  }
}

console.log(`\n══ 공급사 시트 전수 원자 점검 — ${rows.length}곳 ══\n`);
const head = ['차번', '상태', '분류', '제조사', '세부모델', '트림', '연식', '연료', '배기량', '주행', '외장', '내장', '인승', '구동', '옵션', '사진', 'VIN'];
const keys: (typeof ATOMS)[number][] = ['car_number', 'vehicle_status', 'product_type', 'maker', 'sub_model', 'trim_name',
  'year', 'fuel_type', 'engine_cc', 'mileage', 'ext_color', 'int_color', 'seats', 'drive_type', 'options', 'photo_link', 'vin'];
console.log('코드      이름           대수  ' + head.map((h) => h.padStart(4)).join(' '));
const totals = new Map<string, number>();
let all = 0;
for (const r of rows.sort((a, b) => b.n - a.n)) {
  if (r.err) { console.log(`${r.code.padEnd(9)} ${r.name.padEnd(14)} FAIL — ${r.err}`); continue; }
  all += r.n;
  for (const k of keys) totals.set(k, (totals.get(k) || 0) + (r.fill.get(k) || 0));
  const cells = keys.map((k) => {
    const c = r.fill.get(k) || 0;
    return (r.n && c === r.n ? '✓' : String(c)).padStart(4);
  });
  console.log(`${r.code.padEnd(9)} ${r.name.padEnd(14)} ${String(r.n).padStart(4)}  ${cells.join(' ')}`);
}
console.log(`\n합계 ${all}대 · ✓ = 그 공급사 전량이 채워진 칸\n`);
console.log('원자별 전체 채움률');
for (const [i, k] of keys.entries()) {
  const c = totals.get(k) || 0;
  console.log(`  ${head[i].padEnd(8)} ${String(c).padStart(4)}/${all}  ${((c / all) * 100).toFixed(0)}%`);
}
console.log('\n요금·검수');
for (const r of rows.filter((x) => !x.err && x.n)) {
  const ps = [...r.periods].sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]));
  const flags = [
    r.noRent ? `대여료없음 ${r.noRent}` : '',
    r.noDeposit ? `보증금없음 ${r.noDeposit}칸` : '',
    r.review ? `차종검수 ${r.review}` : '',
  ].filter(Boolean).join(' · ');
  console.log(`  ${r.code.padEnd(9)} ${ps.join(' · ')}${flags ? `   ← ${flags}` : ''}`);
}
process.exit(0);
