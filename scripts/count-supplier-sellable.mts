/**
 * **공급사 시트 원본 기준**으로 «출고불가 빼고» 몇 대인가. 읽기 전용.
 *
 * ERP·영업자 시트를 거치지 않고 **시트 그 자체**만 센다 — 유입이 새는지 보려면
 * 들어오기 전 숫자를 알아야 한다. ERP 쪽 숫자와 견주는 건 `audit-sheet-erp-gap`.
 *
 * 세는 법
 *   · 상태 열이 「출고불가」로 판정되는 행을 뺀다(`canonSheetVehicleStatus`).
 *   · **차량번호로 접는다** — 같은 차가 렌트·구독 탭에 두 번 있으면 한 대다.
 *   · 상태 열·차번 열을 못 찾은 시트는 **0 이 아니라 「못 읽음」**으로 낸다.
 *     0 을 깨끗하다고 읽으면 안 된다.
 *
 *   npx tsx scripts/count-supplier-sellable.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, findPlateAndStatusColumns, readSupplierSheet } from '../lib/domain/supplier-sheet-read';

const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const shT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;

const [t3, t4] = await Promise.all(['partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: any) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, any> = {};
for (const src of [t3, t4] as any[]) for (const [k, v] of Object.entries<any>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const sheets = new Map<string, { name: string; url: string }>();
for (const p of Object.values<any>(partners)) {
  if (dead(p)) continue;
  const c = S(p.partner_code) || S(p._key);
  if (S(p.sheet_url) && !sheets.has(c)) sheets.set(c, { name: S(p.partner_name || p.name || p.company_name) || c, url: S(p.sheet_url) });
}

type Out = { code: string; name: string; tabs: string[]; tabErrs: string[]; rows: number; sellable: number; plates: number; err: string; by: Map<string, number> };
const out: Out[] = [];
const detail: string[][] = [];

for (const [code, meta] of sheets) {
  // 시트가 정본이 아닌 공급사는 시트로 세지 않는다(아이언 = 홈페이지 수집).
  if (NOT_SHEET_BACKED.has(code)) continue;
  const id = meta.url.match(/\/d\/([\w-]+)/)?.[1];
  const o: Out = { code, name: meta.name, tabs: [], tabErrs: [], rows: 0, sellable: 0, plates: 0, err: '', by: new Map() };
  if (!id) { o.err = '시트 주소 없음'; out.push(o); continue; }
  const seen = new Set<string>();
  try {
    // ★시트는 규격(`readSupplierSheet`)으로만 읽는다.
    //   2026-08-11 까지 이 도구는 raw values 를 1행 헤더로 읽어 숨김 행·숨김 탭을 그대로 셌고,
    //   오토플러스를 「못 읽음」으로 냈다. 규격 파일 머리말의 네 가지가 그래서 있다.
    const grid = await (await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`,
      { headers: { Authorization: `Bearer ${shT}` } })).json();
    if ((grid as any).error) throw new Error((grid as any).error.message);
    const { tabs: readTabs, failures } = readSupplierSheet(grid as any, partners[code] || { partner_code: code } as any);
    for (const f of failures) o.tabErrs.push(`${f.title} — ${f.reason.slice(0, 30)}`);
    for (const rt of readTabs) {
      const tab = rt.title;
      const t = rt.table;
      const hdr = (t[0] || []).map(S);
      const { plate: pi, status: si } = findPlateAndStatusColumns(hdr);
      if (si < 0 || pi < 0) continue;
      o.tabs.push(tab);
      for (const r of t.slice(1)) {
        const pl = norm(r[pi]);
        if (!pl || pl.length < 6) continue;
        o.rows++;
        const raw = S(r[si]);
        const canon = canonSheetVehicleStatus(raw);
        if (canon === '출고불가') continue;
        o.sellable++;
        o.by.set(canon, (o.by.get(canon) || 0) + 1);
        if (!seen.has(pl)) { seen.add(pl); detail.push([pl, code, meta.name, tab, raw, canon]); }
      }
    }
    o.plates = seen.size;
    if (!o.tabs.length) o.err = '상태·차번 열을 못 찾음';
  } catch (e) { o.err = String((e as Error).message).slice(0, 60); }
  out.push(o);
}

const ok = out.filter((o) => !o.err);
const bad = out.filter((o) => o.err);
console.log('■ 공급사 시트 원본 — 출고불가 빼고 몇 대인가\n');
console.log(`  ${'공급사'.padEnd(16)}${'코드'.padEnd(10)}${'시트행'.padStart(7)}${'출고불가뺀행'.padStart(13)}${'차량대수'.padStart(10)}   탭`);
for (const o of [...ok].sort((a, b) => b.plates - a.plates)) {
  console.log(`  ${o.name.slice(0, 15).padEnd(16)}${o.code.padEnd(10)}${String(o.rows).padStart(7)}${String(o.sellable).padStart(13)}${String(o.plates).padStart(10)}   ${o.tabs.join(' · ').slice(0, 30)}`);
}
const total = ok.reduce((n, o) => n + o.plates, 0);
console.log(`\n  ─────────────────────────────────────────────────────────`);
console.log(`  합계  ${total}대   (공급사 ${ok.length}곳 · 시트행 ${ok.reduce((n, o) => n + o.rows, 0)}줄)\n`);

const byStatus = new Map<string, number>();
for (const o of ok) for (const [k, v] of o.by) byStatus.set(k, (byStatus.get(k) || 0) + v);
console.log('  상태별(행 기준):');
for (const [k, v] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(6)}  ${k}`);

if (bad.length) {
  console.log(`\n  ⚠ 못 읽은 시트 ${bad.length}곳 — 이건 «0대»가 아니라 «모름»이다`);
  for (const o of bad) console.log(`   ${o.name.slice(0, 15).padEnd(16)}${o.code.padEnd(10)}${o.err}`);
}

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/supplier-sellable.csv', `﻿${[
  ['차량번호', '공급사코드', '공급사', '탭', '시트 상태(원문)', '판정'].join(','),
  ...detail.map((d) => d.map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: tmp/supplier-sellable.csv (${detail.length}행)\n`);
