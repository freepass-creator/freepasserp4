/**
 * **빈 칸만 공급사 시트에서 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-10)
 *   차량번호와 대여료만 있고 차종·연식·색·주행이 통째로 빈 껍데기가 남아 있다(아이카 11대 실측).
 *   옛 유입의 잔재인데, `create-missing-from-sheets` 는 «없는 차»만 만들므로 이런 차는
 *   영영 안 채워진다. 영업자 표에 차종 없이 값만 떠서 못 판다.
 *
 * ★**빈 칸만** 채운다. 값이 있으면 절대 덮지 않는다 —
 *   시트 재유입이 ERP 보다 나쁠 수 있다(2026-08-10 실측: 「그랜저 GN7」이 「그랜저 L」로 뒤집혔다).
 *   그래서 «덮어쓰기»가 아니라 «빈칸 채우기»만 한다.
 *
 * ⚠ 대여료(price)·상태(vehicle_status)는 여기서 손대지 않는다 —
 *   각각 `fill-missing-prices` · `fix-sheet-status-gap` 이 맡는다. 한 스크립트가 여럿을 고치면
 *   무엇 때문에 값이 바뀌었는지 못 짚는다.
 *
 *   npx tsx scripts/fill-blanks-from-sheets.mts
 *   npx tsx scripts/fill-blanks-from-sheets.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { autoMapHeaders, importSheetTable } from '../lib/domain/sheet-import';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 채울 칸 — 차를 설명하는 것만. 돈·상태·정책은 여기서 다루지 않는다. */
const FIELDS = [
  'maker', 'model', 'sub_model', 'variant', 'trim_name', 'year', 'fuel_type', 'engine_cc',
  'mileage', 'ext_color', 'int_color', 'options', 'product_type', 'seats', 'drive_type',
  'first_registration_date', 'vehicle_class',
] as const;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const shT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const grabGrid = async (id: string, tries = 4): Promise<Rec> => {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`;
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${shT}` } });
    const j = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return j;
    if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(10000 * (i + 1)); continue; }
    throw new Error(j?.error?.message || `HTTP ${res.status}`);
  }
};

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };

/** 빈 칸이 하나라도 있는 차 — 목록에 서는 차만 본다(안 보이는 차는 급하지 않다). */
const need = new Map<string, EntityRecord[]>();
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const rec = { ...p, _key: k, product_code: p.product_code || k } as EntityRecord;
  if (isHiddenFromCatalog(rec as Rec) || !priceList(rec).length) continue;
  if (!FIELDS.some((f) => !S((rec as Rec)[f]))) continue;
  const pl = norm(p.car_number);
  if (!pl) continue;
  need.set(pl, [...(need.get(pl) || []), rec]);
}
console.log(`■ 빈 칸을 시트에서 채운다 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  빈 칸이 있는 차 ${need.size}대\n`);

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

type Fill = { plate: string; key: string; from: string; patch: Rec };
const fills: Fill[] = [];
const seen = new Set<string>();
for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  if (NOT_SHEET_BACKED.has(code)) continue;
  const id = S(p.sheet_url).match(/\/d\/([\w-]+)/)?.[1];
  if (!id || seen.has(id)) continue;
  seen.add(id);
  const name = S(p.partner_name || p.name || p.company_name) || code;
  try {
    const grid = await grabGrid(id);
    const { tabs } = readSupplierSheet(grid as never, p as EntityRecord);
    for (const t of tabs) {
      let imported: EntityRecord[] = [];
      try {
        const prof = autoMapHeaders(t.table[0] || []);
        if (prof.car_number === undefined) continue;
        const out = importSheetTable(t.table, {
          profile: prof, providerCode: code, providerName: name, entries, depositRule: p.deposit_rule,
        } as Parameters<typeof importSheetTable>[1]);
        imported = (out as Rec).products || [];
      } catch { continue; }
      for (const src of imported) {
        const pl = norm((src as Rec).car_number);
        const recs = pl ? need.get(pl) : null;
        if (!recs?.length) continue;
        for (const rec of recs) {
          const patch: Rec = {};
          for (const f of FIELDS) {
            const to = S((src as Rec)[f]);
            // ★빈 칸만 채운다 — 값이 있으면 시트가 더 나쁠 수 있으므로 손대지 않는다.
            if (to && !S((rec as Rec)[f])) patch[f] = (src as Rec)[f];
          }
          if (Object.keys(patch).length) {
            fills.push({ plate: pl, key: S((rec as Rec)._key), from: `${name} / ${t.title}`, patch });
          }
        }
      }
    }
  } catch (e) { console.log(`  △ ${name} 시트 못 읽음 — ${String((e as Error).message).slice(0, 60)}`); }
}

console.log(`  채울 차 ${fills.length}대\n`);
for (const f of fills.slice(0, 20)) {
  const cols = Object.keys(f.patch).join('·');
  const name = `${S(f.patch.maker)} ${S(f.patch.sub_model) || S(f.patch.model)}`.trim();
  console.log(`   ${f.plate.padEnd(11)} ${f.from.slice(0, 24).padEnd(26)} ${name.slice(0, 24).padEnd(26)} ${cols.slice(0, 60)}`);
}
if (fills.length > 20) console.log(`   … 외 ${fills.length - 20}대`);
const left = [...need.keys()].filter((pl) => !fills.some((f) => f.plate === pl));
if (left.length) console.log(`\n  시트에서 못 찾은 차 ${left.length}대 — ${left.slice(0, 12).join(' · ')}`);

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/blank-fill.csv', `﻿${[
  ['차량번호', 'RTDB키', '찾은 곳', '채운 칸'].join(','),
  ...fills.map((f) => [f.plate, f.key, f.from, Object.keys(f.patch).join(' ')].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: tmp/blank-fill.csv (${fills.length}행)`);

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const at = new Date().toISOString();
let done = 0; let bad = 0;
for (const f of fills) {
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(f.key)}.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f.patch, updatedAt: at }),
  });
  if (res.ok) done++;
  else { bad++; console.log(`  △ ${f.plate} — ${res.status} ${(await res.text()).slice(0, 100)}`); }
}
console.log(`\n  채움 ${done}대 · 실패 ${bad}대`);
console.log('  다음: 영업자 시트 두 탭을 다시 찍는다.\n');
