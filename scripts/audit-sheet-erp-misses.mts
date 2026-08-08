/**
 * 시트에 **값이 있는데** ERP 재고에 빠진 구멍만 전수 대조. 쓰기 없음.
 *
 * 「시트에 없는 공란」은 세지 않는다. 우리가 읽기/반영에서 놓친 것만 센다.
 *   · 옵션 · 사진링크 · 대여료기간 · 보증금 · 트림 · 연식 · 연료 · 배기 · 외장 · 주행
 *
 *   npx tsx scripts/audit-sheet-erp-misses.mts
 *   npx tsx scripts/audit-sheet-erp-misses.mts --code=RP004
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import {
  importSheetTable, parseDepositRule, parseMappingHeaderSignature, parseMappingProfile,
} from '../lib/domain/sheet-import';
import { extractGoogleSheetId } from '../lib/domain/sheet-url';
import { visibleRowsFromGridResponse } from '../lib/domain/sheet-visible-grid';
import { isListableProduct, parseProductOptions, priceList } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const PLATE = /(\d{2,3}[가-힣]\d{4})/;
const plateOf = (v: unknown) => (S(v).replace(/\s/g, '').match(PLATE) || [''])[0];
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const arg = (n: string) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);

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

const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

/** ERP: provider+plate → product */
const erpBy = new Map<string, Rec>();
for (const p of Object.values(prods) as Rec[]) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const code = S(p.provider_company_code) || S(p.partner_code);
  const pl = plateOf(p.car_number);
  if (!code || !pl) continue;
  const key = `${code}|${pl}`;
  // listable 우선, 없으면 아무거나
  const prev = erpBy.get(key);
  if (!prev || (isListableProduct(p as never) && !isListableProduct(prev as never))) erpBy.set(key, p);
}

const merged: Record<string, Rec> = {};
for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) {
  merged[k] = { ...(live[k] || {}), ...(over[k] || {}), _key: k };
}

const only = arg('code').toUpperCase();
const seen = new Set<string>();
const targets = Object.values(merged).filter((p) => {
  const code = S(p.partner_code) || S(p._key);
  if (!S(p.sheet_url) || seen.has(code)) return false;
  if (only && code !== only) return false;
  seen.add(code);
  return true;
});

type Miss = { field: string; plate: string; sheet: string; erp: string };
type Co = {
  code: string; name: string; sheetN: number; matched: number; notInErp: number;
  misses: Miss[]; err: string;
};

const ATOM_FIELDS: Array<{ key: string; label: string; get: (p: Rec) => string }> = [
  { key: 'options', label: '옵션', get: (p) => parseProductOptions(p.options).join('|') },
  { key: 'photo_link', label: '사진', get: (p) => S(p.photo_link) },
  { key: 'trim_name', label: '트림', get: (p) => S(p.trim_name) },
  { key: 'year', label: '연식', get: (p) => S(p.year) },
  { key: 'fuel_type', label: '연료', get: (p) => S(p.fuel_type) },
  { key: 'engine_cc', label: '배기', get: (p) => S(p.engine_cc) || (N(p.engine_cc) ? String(N(p.engine_cc)) : '') },
  { key: 'mileage', label: '주행', get: (p) => S(p.mileage) || (N(p.mileage) ? String(N(p.mileage)) : '') },
  { key: 'ext_color', label: '외장', get: (p) => S(p.ext_color) },
  { key: 'int_color', label: '내장', get: (p) => S(p.int_color) },
  { key: 'seats', label: '인승', get: (p) => S(p.seats) || (N(p.seats) ? String(N(p.seats)) : '') },
  { key: 'drive_type', label: '구동', get: (p) => S(p.drive_type) },
];

function rentKeys(p: Rec): string[] {
  return Object.keys((p.price || {}) as Rec).sort();
}
function hasAnyRent(p: Rec): boolean {
  return priceList(p as never).some((x) => N(x.rent) > 0);
}
function depositMiss(sheet: Rec, erp: Rec): string | null {
  const sp = (sheet.price || {}) as Record<string, Rec>;
  const ep = (erp.price || {}) as Record<string, Rec>;
  const holes: string[] = [];
  for (const k of Object.keys(sp)) {
    const sd = sp[k]?.deposit;
    // 시트에 보증금이 숫자로 있을 때만 — 빈칸·규칙은 «시트에 없음»
    if (sd === undefined || sd === null || sd === '') continue;
    if (!N(sd) && S(sd) !== '0') continue;
    const ed = ep[k]?.deposit;
    if (ed === undefined || ed === null || ed === '') holes.push(`${k}=시트${N(sd)}`);
  }
  return holes.length ? holes.slice(0, 4).join(',') : null;
}

const cos: Co[] = [];
const FIELDS = [
  'sheets(properties(sheetId,title,hidden)',
  'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
].join(',');

for (const partner of targets) {
  const code = S(partner.partner_code) || S(partner._key);
  const name = (S(partner.partner_name) || S(partner.company_name) || S(partner.name) || code).slice(0, 14);
  const co: Co = { code, name, sheetN: 0, matched: 0, notInErp: 0, misses: [], err: '' };
  cos.push(co);
  try {
    const opts = partnerSheetOpts(partner);
    const adapter = resolveAdapter(partner);
    const id = extractGoogleSheetId(opts.url);
    if (!id) { co.err = 'sheet id 없음'; continue; }
    const api = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
    const meta = await (await fetch(`${api}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`, { headers: H })).json() as any;
    const tabs = (meta.sheets || []).map((s: any) => s.properties).filter((t: any) => !t.hidden);
    const use = opts.gids.length ? tabs.filter((t: any) => opts.gids.includes(String(t.sheetId))) : tabs;

    const byPlate = new Map<string, Rec>();
    for (const t of use) {
      const body = await (await fetch(
        `${api}?ranges=${encodeURIComponent(`'${t.title}'`)}&includeGridData=true&fields=${encodeURIComponent(FIELDS)}`,
        { headers: H },
      )).json() as any;
      const grid = visibleRowsFromGridResponse(body, String(t.sheetId));
      let r;
      try {
        r = importSheetTable(adapter.prepareTable(grid.rows, { headerRow: opts.headerRow }), {
          providerCode: code,
          entries,
          profile: parseMappingProfile(partner.mapping_profile),
          profileHeaders: parseMappingHeaderSignature(partner.mapping_header_signature),
          depositRule: parseDepositRule(partner.deposit_rule),
          photoByPlate: grid.photoByPlate,
        });
      } catch { continue; }
      for (const p of r.products as Rec[]) {
        const pl = plateOf(p.car_number);
        if (!pl) continue;
        byPlate.set(pl, p); // 나중 탭이 덮음(동기와 동일 합치 취지)
      }
    }

    co.sheetN = byPlate.size;
    for (const [pl, sheet] of byPlate) {
      const erp = erpBy.get(`${code}|${pl}`);
      if (!erp) { co.notInErp++; continue; }
      co.matched++;

      for (const f of ATOM_FIELDS) {
        const sv = f.get(sheet);
        if (!sv) continue; // 시트에 없음 → 스킵
        const ev = f.get(erp);
        if (ev) continue; // ERP에도 있음
        co.misses.push({ field: f.label, plate: pl, sheet: sv.slice(0, 48), erp: '(빈칸)' });
      }

      // 대여료: 시트에 기간이 있는데 ERP에 아무 대여료도 없으면 구멍
      if (hasAnyRent(sheet) && !hasAnyRent(erp)) {
        co.misses.push({ field: '대여료', plate: pl, sheet: rentKeys(sheet).join(','), erp: '(없음)' });
      } else if (hasAnyRent(sheet)) {
        // 시트 기간이 ERP에 통째로 빠진 경우
        const sk = new Set(rentKeys(sheet).filter((k) => N((sheet.price as Rec)[k]?.rent) > 0));
        const ek = new Set(rentKeys(erp));
        const lost = [...sk].filter((k) => !ek.has(k));
        if (lost.length) {
          co.misses.push({ field: '대여료기간', plate: pl, sheet: lost.join(','), erp: [...ek].join(',') || '(없음)' });
        }
      }

      const dep = depositMiss(sheet, erp);
      if (dep) co.misses.push({ field: '보증금', plate: pl, sheet: dep, erp: '(해당기간 빈칸)' });
    }
  } catch (e) {
    co.err = String((e as Error)?.message || e).slice(0, 80);
  }
}

console.log(`\n══ 시트엔 있는데 ERP에 빠진 구멍 — ${cos.length}곳 ══\n`);
console.log('(시트 공란은 세지 않음. 우리가 놓친 것만.)\n');

const tally = new Map<string, number>();
let missCars = 0;
let missTotal = 0;

for (const c of cos.sort((a, b) => b.sheetN - a.sheetN)) {
  if (c.err) {
    console.log(`${c.code.padEnd(9)} ${c.name.padEnd(14)} FAIL — ${c.err}`);
    continue;
  }
  const byField = new Map<string, number>();
  for (const m of c.misses) byField.set(m.field, (byField.get(m.field) || 0) + 1);
  for (const [f, n] of byField) tally.set(f, (tally.get(f) || 0) + n);
  missTotal += c.misses.length;
  const cars = new Set(c.misses.map((m) => m.plate)).size;
  missCars += cars;

  const flag = c.misses.length
    ? [...byField].map(([f, n]) => `${f}${n}`).join(' · ')
    : '구멍 0';
  console.log(
    `${c.code.padEnd(9)} ${c.name.padEnd(14)} 시트${String(c.sheetN).padStart(3)} `
    + `매칭${String(c.matched).padStart(3)} 미입고${String(c.notInErp).padStart(3)}  `
    + `${flag}`,
  );
}

console.log(`\n── 필드별 구멍 합계 (건수) ──`);
if (!tally.size) console.log('  (없음)');
for (const [f, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${f.padEnd(8)} ${n}`);
}
console.log(`\n총 구멍 ${missTotal}건 · 해당 차량 ${missCars}대(공급사 합산)`);

console.log(`\n── 표본 (공급사별 최대 8건) ──`);
for (const c of cos.filter((x) => x.misses.length)) {
  console.log(`\n[${c.code} ${c.name}]`);
  for (const m of c.misses.slice(0, 8)) {
    console.log(`  ${m.plate.padEnd(10)} ${m.field.padEnd(6)} 시트«${m.sheet}» → ERP ${m.erp}`);
  }
  if (c.misses.length > 8) console.log(`  … 그 밖 ${c.misses.length - 8}`);
}

process.exit(missTotal > 0 ? 2 : 0);
