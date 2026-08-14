/**
 * **보증금이 공급사 시트와 맞나** — ERP 값과 시트 원문을 차 한 대씩 견준다. 읽기 전용.
 *
 * ★표에 어떻게 담을지보다 **숫자가 맞는지가 먼저다**(사장님 2026-08-13 — 「데이터 정합성부터」).
 *   보증금은 한 번 받는 돈이라 틀리면 그대로 손님에게 잘못 말한다.
 *
 * ★대조하는 법 — 공급사가 쓴 «보증」이 든 열을 전부 모아 ERP 보증금과 견준다.
 *   열 이름이 제각각이라(단기보증·장기보증·보증금·보증금 반납형 …) 이름을 맞추려 들지 않고
 *   **그 줄에 적힌 보증금 값들의 집합**과 ERP 가 들고 있는 값들의 집합을 견준다.
 *   ⚠ 이름을 맞추려 들면 공급사마다 규칙을 새로 짜야 하고, 그러다 틀린다.
 *
 * 판정
 *   ✓        ERP 값이 시트에 있는 값들 안에 다 있다
 *   ✗없는값   ERP 에 시트에 없는 보증금이 있다  ← 우리가 지어냈거나 옛 값이 남았다
 *   ✗빠짐     시트에 있는데 ERP 가 안 들고 있다
 *   ?원문없음  그 차 줄을 시트에서 못 찾았다(홈피 수집 등)
 *
 *   npx tsx scripts/audit-deposit-vs-sheet.mts
 *   npx tsx scripts/audit-deposit-vs-sheet.mts --code=RP021 --list
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isStockedProduct, priceList } from '../lib/domain/product';
import { companyAlias } from '../lib/domain/identity';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONLY = arg('code');
const LIST = process.argv.includes('--list');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
/** 만원 미만 차이는 표기 흔들림으로 본다(1,000,000 ↔ 100만). */
const NEAR = 10000;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const shT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
const at = async (p: string) => JSON.parse(await (await fetch(`${DB}/${p}.json?access_token=${dbT}`)).text());
const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(at));
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const nameOf = new Map<string, string>();
for (const p of Object.values(partners)) {
  const c = S(p.partner_code) || S(p._key);
  const nm = companyAlias(S(p.partner_name || p.name || p.company_name), p.alias);
  if (c && nm && !nameOf.has(c)) nameOf.set(c, nm);
}
const code = (p: Rec) => S(p.provider_company_code) || S(p.partner_code);
const rows = Object.values<Rec>(prods)
  .filter((p) => p && typeof p === 'object' && !dead(p) && isStockedProduct(p as any))
  .filter((p) => !ONLY || code(p) === ONLY);

/** 차번 → 그 줄에 적힌 보증금 값들. 공급사 시트를 한 번씩만 읽는다. */
const sheetDeps = new Map<string, number[]>();
const readFailed: string[] = [];
{
  const codes = new Set(rows.map((p) => code(p)));
  for (const p of Object.values(partners)) {
    const c = S(p.partner_code) || S(p._key);
    if (!codes.has(c) || dead(p)) continue;
    const id = S(p.sheet_url).match(/\/spreadsheets\/d\/([\w-]+)/)?.[1];
    if (!id) { readFailed.push(`${c} ${nameOf.get(c)} — 시트 없음(홈피 수집 등)`); continue; }
    try {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`, { headers: { Authorization: `Bearer ${shT}` } });
      /**
       * ⚠ res.ok 를 안 보면 403/404/5xx 가 「?원문없음」이라는 «데이터 문제»로 둔갑한다.
       *   읽기 실패와 값 없음은 전혀 다른 일이다 — 섞으면 감사가 거짓말한다.
       */
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
      const read = readSupplierSheet(await res.json(), p as EntityRecord);
      for (const tab of read.tabs) {
        const hdr = (tab.table[0] || []).map(S);
        const pi = hdr.findIndex((h) => /차량번호|차번/.test(h));
        if (pi < 0) continue;
        // 「보증」이 든 열 전부 — 이름은 안 맞춘다.
        const di = hdr.map((h, i) => (/보증/.test(h) ? i : -1)).filter((i) => i >= 0);
        if (!di.length) continue;
        for (const row of tab.table.slice(1)) {
          const pl = norm(row[pi]);
          if (!pl) continue;
          const vals = di.map((i) => Number(S(row[i]).replace(/[^\d]/g, ''))).filter((n) => n > 0);
          if (!vals.length) continue;
          sheetDeps.set(pl, [...new Set([...(sheetDeps.get(pl) || []), ...vals])]);
        }
      }
    } catch (e) { readFailed.push(`${c} ${nameOf.get(c)} — ${(e as Error).message.slice(0, 60)}`); }
  }
}

const near = (a: number, list: number[]) => list.some((b) => Math.abs(a - b) <= NEAR);
type V = '✓' | '✗없는값' | '✗빠짐' | '?원문없음' | '-보증금없음';
const tally = new Map<V, number>();
const bySup = new Map<string, string[]>();
for (const p of rows) {
  const plate = norm(p.car_number);
  const erp = [...new Set(priceList(p as any).filter((e) => e.deposit).map((e) => Number(e.deposit)))];
  const sheet = sheetDeps.get(plate) || [];
  let v: V;
  let note = '';
  if (!erp.length && !sheet.length) v = '-보증금없음';
  else if (!sheet.length) { v = '?원문없음'; }
  else {
    const extra = erp.filter((x) => !near(x, sheet));
    const missing = sheet.filter((x) => !near(x, erp));
    if (extra.length) { v = '✗없는값'; note = `ERP ${extra.map((n) => n.toLocaleString()).join('·')} 가 시트에 없다 · 시트 ${sheet.map((n) => n.toLocaleString()).join('·')}`; }
    else if (missing.length) { v = '✗빠짐'; note = `시트 ${missing.map((n) => n.toLocaleString()).join('·')} 를 ERP 가 안 들고 있다`; }
    else v = '✓';
  }
  tally.set(v, (tally.get(v) || 0) + 1);
  if (v.startsWith('✗')) {
    const sup = nameOf.get(code(p)) || code(p);
    (bySup.get(sup) || bySup.set(sup, []).get(sup)!).push(`${plate.padEnd(10)} ${v.padEnd(7)} ${note}`);
  }
}
console.log(`■ 보증금 대조 — 재고 ${rows.length}대\n`);
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(10)} ${String(n).padStart(4)}대  ${(n / rows.length * 100).toFixed(1)}%`);
if (readFailed.length) {
  console.log(`\n  시트를 못 읽은 공급사 ${readFailed.length}곳`);
  for (const f of [...new Set(readFailed)]) console.log(`     ${f}`);
}
console.log('\n■ 어긋난 차');
for (const [sup, xs] of [...bySup].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  ── ${sup} ${xs.length}대`);
  for (const x of (LIST ? xs : xs.slice(0, 5))) console.log(`     ${x}`);
  if (!LIST && xs.length > 5) console.log(`     … 그 밖 ${xs.length - 5}대 (--list 로 전부)`);
}

/**
 * ★**감사가 제 일을 못 했으면 초록불을 주지 않는다.**
 *   ⚠ 단 «시트가 아예 없는 곳»(아이언=홈피 수집)과 «읽다가 실패한 곳»을 가른다.
 *     앞엣것은 알려진 현실이라 늘 빨간불이 되고, 그러면 아무도 안 본다.
 *   ⚠ 「어긋난 차」 수로도 실패시키지 않는다 — 기간마다 보증금이 다른 차가 실제로 있다.
 *     그건 목록으로 보여 주는 것까지가 이 도구의 몫이다.
 */
const readError = readFailed.filter((x) => !/시트 없음/.test(x));
if (readError.length) {
  console.log('');
  console.log(`  ⛔ 시트를 읽다 실패한 곳 ${new Set(readError).size} — 대조가 반쪽이라 「맞다」고 말할 수 없다.`);
  process.exitCode = 1;
}
