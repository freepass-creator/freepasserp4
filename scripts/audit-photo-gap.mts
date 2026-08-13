/**
 * **우리 상품에 사진이 다 있나** — 상품리스트에 서는 차 기준으로 센다. 읽기 전용.
 *
 * ★사진이 오는 길은 셋이다(사장님 2026-08-13 — 「우리 상품에 있는 거는 다 있어야지」).
 *     ① 프리패스픽스 드라이브   차번 폴더가 있나
 *     ② 공급사 시트 셀 링크     차번 칸에 걸린 하이퍼링크·스마트칩
 *     ③ ERP `photo_link`        ②를 옮겨 담은 값
 *   하나라도 있으면 «있다»로 본다. 셋 다 없으면 그 차는 손님에게 보여 줄 사진이 없는 것이다.
 *
 *   npx tsx scripts/audit-photo-gap.mts
 *   npx tsx scripts/audit-photo-gap.mts --list        (없는 차 전부 찍기)
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isStockedProduct } from '../lib/domain/product';
import { companyAlias } from '../lib/domain/identity';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const LIST = process.argv.includes('--list');
const PICS = arg('pics', '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const PLATE_HEAD = /^\s*(\d{2,3}[가-힣]\d{4})/;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const drT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const nameOf = new Map<string, string>();
for (const p of Object.values(partners)) {
  const c = S(p.partner_code) || S(p._key);
  const nm = companyAlias(S(p.partner_name || p.name || p.company_name), p.alias);
  if (c && nm && !nameOf.has(c)) nameOf.set(c, nm);
}

/** ① 프리패스픽스 — 공급사 폴더 아래 «차번…» 폴더를 전부 훑는다. */
const inDrive = new Set<string>();
{
  const drive = async (u: string) => {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${drT}` } });
    const t = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
    return JSON.parse(t) as Rec;
  };
  const kids = async (parent: string) => {
    const out: Rec[] = [];
    let page = '';
    do {
      const r = await drive(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${parent}' in parents and trashed = false`)}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&includeItemsFromAllDrives=true&supportsAllDrives=true${page ? `&pageToken=${page}` : ''}`);
      out.push(...(r.files || []));
      page = S(r.nextPageToken);
    } while (page);
    return out;
  };
  for (const sup of await kids(PICS)) {
    if (sup.mimeType !== 'application/vnd.google-apps.folder') continue;
    for (const car of await kids(sup.id)) {
      const m = S(car.name).match(PLATE_HEAD);
      if (m) inDrive.add(norm(m[1]));
    }
  }
}
/** ② 공급사 시트 셀 링크 — 발행기가 만들어 둔 캐시를 쓴다. */
const inSheet = new Set<string>();
try {
  const cache = JSON.parse(readFileSync('tmp/sheet-cell-cache.json', 'utf8')) as { rows: Record<string, Rec> };
  for (const [k, v] of Object.entries(cache.rows || {})) if (S(v.photo)) inSheet.add(k);
} catch { /* 캐시가 없으면 ②는 0 으로 나온다 */ }

const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const code = (p: Rec) => S(p.provider_company_code) || S(p.partner_code);
const rows = Object.values<Rec>(prods)
  .filter((p) => p && typeof p === 'object' && !dead(p) && isStockedProduct(p as any))
  .filter((p) => code(p) !== 'RP023' && !(code(p) === 'RP012' && /구독/.test(canonProductType(p.product_type) || '')));

console.log(`■ 상품리스트에 서는 ${rows.length}대\n`);
console.log(`  프리패스픽스에 든 차 ${inDrive.size}대 · 시트 셀링크 ${inSheet.size}대 (재고 밖 차 포함)\n`);

type Row = { plate: string; sup: string; d: boolean; s: boolean; e: boolean };
const list: Row[] = rows.map((p) => {
  const plate = norm(p.car_number);
  return {
    plate,
    sup: nameOf.get(code(p)) || code(p) || '(없음)',
    d: inDrive.has(plate),
    s: inSheet.has(plate),
    e: S(p.photo_link).startsWith('http'),
  };
});
const have = list.filter((x) => x.d || x.s || x.e);
console.log(`  사진 있는 차 ${have.length}/${list.length} (${(have.length / list.length * 100).toFixed(1)}%)`);
console.log(`    ① 프리패스픽스 ${list.filter((x) => x.d).length} · ② 시트 셀링크 ${list.filter((x) => x.s).length} · ③ photo_link ${list.filter((x) => x.e).length}`);

const bySup = new Map<string, Row[]>();
for (const x of list) (bySup.get(x.sup) || bySup.set(x.sup, []).get(x.sup)!).push(x);
console.log(`\n  공급사        대수   사진있음   없음   ①픽스  ②시트  ③ERP`);
for (const [sup, xs] of [...bySup].sort((a, b) => b[1].length - a[1].length)) {
  const h = xs.filter((x) => x.d || x.s || x.e).length;
  console.log(`  ${sup.padEnd(12).slice(0, 12)} ${String(xs.length).padStart(4)}  ${String(h).padStart(6)}  ${String(xs.length - h).padStart(5)}  ${String(xs.filter((x) => x.d).length).padStart(5)} ${String(xs.filter((x) => x.s).length).padStart(6)} ${String(xs.filter((x) => x.e).length).padStart(6)}`);
}
if (LIST) {
  console.log('\n■ 사진이 하나도 없는 차');
  for (const [sup, xs] of [...bySup].sort((a, b) => b[1].length - a[1].length)) {
    const none = xs.filter((x) => !x.d && !x.s && !x.e);
    if (!none.length) continue;
    console.log(`  ── ${sup} ${none.length}대`);
    console.log(`     ${none.map((x) => x.plate).join(' · ')}`);
  }
}
