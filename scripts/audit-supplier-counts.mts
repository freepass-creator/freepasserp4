/**
 * **공급사별 재고 검수표.** 읽기 전용.
 *
 * 「시트에 몇 대인데 우리 목록엔 몇 대인가」를 공급사별로 나란히 놓는다.
 * 두 숫자가 다르면 그만큼 영업자가 못 보거나, 없는 차를 보고 있다는 뜻이다.
 *
 * 시트는 `supplier-sheet-read` 규격대로 읽는다 — 숨긴 행·숨긴 탭 제외, 공급사 어댑터.
 * 아이언은 시트가 아니라 ironrentcar.com 수집이 정본이라 시트칸을 「—」로 둔다.
 *
 *   npx tsx scripts/audit-supplier-counts.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isHiddenFromCatalog, priceList } from '../lib/domain/product';
import { dedupeProductsByVehicle, isExcludedProduct } from '../lib/firebase/rtdb-products';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, findPlateAndStatusColumns, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const shT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };

const live = Object.entries<Rec>(prods).filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord));
const sell = live.filter((p) => !isHiddenFromCatalog(p as Rec) && priceList(p).length > 0);
const clientEligible = live.filter((p) => !isExcludedProduct(p as Rec));
const clientDeduped = dedupeProductsByVehicle(clientEligible);
const clientSell = clientDeduped.filter((p) => !isHiddenFromCatalog(p as Rec) && priceList(p).length > 0);
const byCode = new Map<string, EntityRecord[]>();
for (const p of sell) {
  const c = S((p as Rec).provider_company_code) || '(코드없음)';
  byCode.set(c, [...(byCode.get(c) || []), p]);
}

type Sheet = { sell: number; total: number; tabs: string[]; fail: number };
const sheetOf = new Map<string, Sheet>();
const seen = new Set<string>();
for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  if (NOT_SHEET_BACKED.has(code)) continue;
  const id = S(p.sheet_url).match(/\/d\/([\w-]+)/)?.[1];
  if (!id || seen.has(id)) continue;
  seen.add(id);
  try {
    const grid = await (await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`,
      { headers: { Authorization: `Bearer ${shT}` } })).json();
    const { tabs, failures } = readSupplierSheet(grid, p as EntityRecord);
    let sellN = 0; let total = 0; const names: string[] = [];
    for (const t of tabs) {
      const c = findPlateAndStatusColumns(t.table[0] || []);
      if (c.plate < 0) continue;
      names.push(t.title);
      for (const r of t.table.slice(1)) {
        const pl = norm(r[c.plate]);
        if (!pl || pl.length < 6) continue;
        total++;
        if (canonSheetVehicleStatus(c.status >= 0 ? S(r[c.status]) : '') !== '출고불가') sellN++;
      }
    }
    sheetOf.set(code, { sell: sellN, total, tabs: names, fail: failures.length });
  } catch { sheetOf.set(code, { sell: -1, total: -1, tabs: [], fail: 1 }); }
}

const rows = [...new Set([...byCode.keys(), ...sheetOf.keys()])].map((code) => {
  const p = Object.values(partners).find((x) => S(x.partner_code) === code);
  const erp = byCode.get(code) || [];
  const sh = sheetOf.get(code);
  const types = new Map<string, number>();
  for (const x of erp) { const k = canonProductType((x as Rec).product_type) || '(빈)'; types.set(k, (types.get(k) || 0) + 1); }
  return {
    code, nm: S(p?.partner_name || p?.name || p?.company_name) || code,
    erp: erp.length, sheet: sh ? sh.sell : null, tabs: sh?.tabs || [],
    types: [...types].sort((a, b) => b[1] - a[1]),
  };
}).filter((r) => r.erp || (r.sheet ?? 0) > 0).sort((a, b) => b.erp - a.erp);

const kst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
console.log(`■ 공급사별 재고 검수 — ${kst}\n`);
console.log(`${'공급사'.padEnd(18)}${'코드'.padEnd(10)}${'시트'.padStart(5)}${'ERP'.padStart(5)}  차이   구분`);
console.log('─'.repeat(92));
for (const r of rows) {
  const gap = r.sheet === null || r.sheet < 0 ? '' : (r.sheet === r.erp ? '' : `${r.erp - r.sheet > 0 ? '+' : ''}${r.erp - r.sheet}`);
  console.log(`${r.nm.slice(0, 17).padEnd(18)}${r.code.padEnd(10)}${(r.sheet === null ? '—' : r.sheet < 0 ? '?' : String(r.sheet)).padStart(5)}${String(r.erp).padStart(5)}  ${gap.padEnd(5)}${r.types.map(([k, v]) => `${k} ${v}`).join(' · ')}`);
}
console.log('─'.repeat(92));
console.log(`${'합계'.padEnd(28)}${String(rows.reduce((n, r) => n + Math.max(0, r.sheet ?? 0), 0)).padStart(5)}${String(sell.length).padStart(5)}`);
const all = new Map<string, number>();
for (const p of sell) { const k = canonProductType((p as Rec).product_type) || '(빈)'; all.set(k, (all.get(k) || 0) + 1); }
console.log(`\n구분별   ${[...all].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`차번 있는 차 ${new Set(sell.map((p) => norm((p as Rec).car_number)).filter(Boolean)).size}대 · 번호미정 ${sell.filter((p) => !norm((p as Rec).car_number)).length}대`);
console.log(`\n[상품찾기 클라이언트 동일 판정] 원천 판매가능 ${sell.length} · 공급사 제외 후 ${clientEligible.filter((p) => !isHiddenFromCatalog(p as Rec) && priceList(p).length > 0).length} · 차량 중복 제거 후 ${clientSell.length}`);
const clientCodes = new Set(clientSell.map((p) => S(p.product_code || p._key)));
const dropped = sell.filter((p) => !clientCodes.has(S(p.product_code || p._key)));
const droppedByProvider = new Map<string, number>();
for (const p of dropped) {
  const code = S((p as Rec).provider_company_code) || '(코드없음)';
  droppedByProvider.set(code, (droppedByProvider.get(code) || 0) + 1);
}
console.log(`[화면에서 빠진 ${dropped.length}대] ${[...droppedByProvider].sort((a, b) => b[1] - a[1]).map(([code, count]) => `${code} ${count}`).join(' · ') || '없음'}`);
console.log(`\n· 시트 = 공급사 시트(보이는 행·탭)에서 출고불가 뺀 대수`);
console.log(`· ERP  = 상품찾기에 서는 대수 — 출고불가가 아니고 대여료가 있는 차`);
console.log(`· 아이언은 ironrentcar.com 수집이 정본이라 시트칸이 「—」`);
