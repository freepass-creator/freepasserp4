/**
 * **공급사 시트 ↔ 영업자 시트 어긋남 감사.** 읽기 전용.
 *
 * 영업자는 상품리스트를 보고 손님에게 「있다/없다」를 말한다. 공급사 시트에는 출고가능인데
 * 그 차가 상품리스트에 없으면, 팔 수 있는 차를 없다고 하는 셈이다 — 그 손해는 안 보인다.
 *
 * 묻는 것 하나: **시트가 팔 수 있다고 한 차가 영업자 시트에 서 있나.**
 *   · 없는데 ERP 에는 있다  → 상태가 어긋났다(동기화가 안 돌았거나 되살아나지 못했다)
 *   · 없고 ERP 에도 없다    → 아예 유입되지 않았다
 *
 * ⚠ 상태·차량번호 열을 못 찾은 시트는 **0 으로 뜬다.** 0 이 「깨끗하다」는 뜻이 아니다 —
 *   시트행이 0 인 공급사는 헤더가 다른 것이니 먼저 그 시트를 열어 봐라.
 *
 *   npx tsx scripts/audit-sheet-erp-gap.mts
 *   OUT=tmp/gap.csv npx tsx scripts/audit-sheet-erp-gap.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isStockedProduct } from '../lib/domain/product';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, findPlateAndStatusColumns, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import type { EntityRecord } from '../lib/intake/entities';
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database','https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const shT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const [prods, t3, t4] = await Promise.all(['v4/products','partners','v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: any) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const partners: Record<string, any> = {};
for (const src of [t3, t4] as any[]) for (const [k, v] of Object.entries<any>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k]||{}), ...v, _key: k };
const sheets = new Map<string, { name: string; url: string }>();
for (const p of Object.values<any>(partners)) {
  if (dead(p)) continue;
  const c = S(p.partner_code)||S(p._key);
  if (S(p.sheet_url) && !sheets.has(c)) sheets.set(c, { name: S(p.partner_name||p.name||p.company_name)||c, url: S(p.sheet_url) });
}
const all = Object.entries<any>(prods).filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord));
// 영업자 시트·내부 상품찾기에 실제로 실리는 기준과 같게 센다. 가격 미입력 재고도 포함한다.
const onSheet = new Set(all.filter(isStockedProduct).map((p: any) => norm(p.car_number)));
const known = new Map<string, any>();
for (const p of all) { const pl = norm((p as any).car_number); if (pl && !known.has(pl)) known.set(pl, p); }
console.log(`영업자 시트 ${onSheet.size}대 · RTDB 활성 ${all.length}건\n`);

let miss = 0, stale = 0, absent = 0;
/** 못 읽은 시트·탭 — 「0대」가 아니라 「모름」이다. 반드시 사람에게 보인다. */
const unread: string[][] = [];
const lines: string[][] = [];
const perProv: { code: string; name: string; rows: number; sellable: number; gap: number }[] = [];
for (const [code, meta] of sheets) {
  // 시트가 정본이 아닌 공급사는 시트로 재지 않는다(아이언 = 홈페이지 수집).
  if (NOT_SHEET_BACKED.has(code)) continue;
  const id = meta.url.match(/\/d\/([\w-]+)/)?.[1]; if (!id) continue;
  let rows: { plate: string; st: string }[] = [];
  try {
    // ★시트는 규격(`readSupplierSheet`)으로만 읽는다 — 직접 읽으면 숨김 탭·숨김 행이 그대로 들어와
    //   아이카가 227행으로, 오토플러스가 「0대」로 나온다(2026-08-11 실측).
    const grid = await (await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`,
      { headers: { Authorization: `Bearer ${shT}` } })).json();
    if ((grid as any).error) throw new Error((grid as any).error.message);
    const read = readSupplierSheet(grid as any, (partners as any)[code] || { partner_code: code } as any);
    for (const f of read.failures) unread.push([meta.name, code, `${f.title} — ${f.reason.slice(0, 40)}`]);
    for (const t of read.tabs) {
      const hdr = (t.table[0] || []).map(S);
      const { plate: pi, status: si } = findPlateAndStatusColumns(hdr);
      if (si < 0 || pi < 0) continue;
      for (const r of t.table.slice(1)) { const pl = norm(r[pi]); if (pl && pl.length >= 6) rows.push({ plate: pl, st: S(r[si]) }); }
    }
  } catch (e) { unread.push([meta.name, code, String((e as Error).message).slice(0, 50)]); continue; }
  const sellable = rows.filter((r) => canonSheetVehicleStatus(r.st) !== '출고불가');
  const gap = sellable.filter((r) => !onSheet.has(r.plate));
  perProv.push({ code, name: meta.name, rows: rows.length, sellable: sellable.length, gap: gap.length });
  for (const g of gap) {
    const k = known.get(g.plate);
    const why = !k ? 'ERP 에 아예 없음' : `ERP「${S((k as any).vehicle_status)}」`;
    if (!k) absent++; else stale++;
    miss++;
    lines.push([g.plate, code, meta.name, g.st, why]);
  }
}
console.log(`■ 시트는 팔 수 있다는데 영업자 시트에 없는 차 — ${miss}대`);
console.log(`   ERP 에 있는데 상태가 어긋남 ${stale}대 · ERP 에 아예 없음 ${absent}대\n`);
console.log(`  ${'공급사'.padEnd(16)}${'코드'.padEnd(10)}시트행  팔수있음   빠짐`);
for (const p of perProv.sort((a, b) => b.gap - a.gap)) {
  console.log(`  ${p.name.slice(0, 15).padEnd(16)}${p.code.padEnd(10)}${String(p.rows).padStart(5)}${String(p.sellable).padStart(9)}${String(p.gap).padStart(7)}${p.gap ? '  ←' : ''}`);
}
const out = S(process.env.OUT) || 'tmp/sheet-erp-gap.csv';
mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync(out, `﻿${[
  ['차량번호', '공급사코드', '공급사', '시트 상태', 'ERP 상태'].join(','),
  ...lines.map((l) => l.map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: ${out} (${lines.length}행)`);
