/**
 * **보증금이 기간마다 다른 차를 찾는다.** 읽기 전용.
 *
 * ★영업자 표에는 보증금 칸이 「단기보증」·「장기보증」 둘뿐이다. 한 값만 찍으므로
 *   **기간마다 보증금이 다른 차는 다른 기간에 틀린 값이 앉는다**
 *   (손오공 구독이 그랬다 — 12개월치 826,000 이 36개월 자리에 서 있었다).
 * ★여기서 그런 차가 몇 대인지, 어느 공급사인지 센다. 고치기 전에 크기부터 알아야 한다.
 *
 *   npx tsx scripts/audit-deposit-gap.mts
 *   npx tsx scripts/audit-deposit-gap.mts --list
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isStockedProduct, priceList } from '../lib/domain/product';
import { companyAlias } from '../lib/domain/identity';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const LIST = process.argv.includes('--list');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const at = async (p: string) => JSON.parse(await (await fetch(`${DB}/${p}.json?access_token=${tok}`)).text());
const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(at));
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const nameOf = new Map<string, string>();
for (const p of Object.values(partners)) {
  const c = S(p.partner_code) || S(p._key);
  const nm = companyAlias(S(p.partner_name || p.name || p.company_name), p.alias);
  if (c && nm && !nameOf.has(c)) nameOf.set(c, nm);
}
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const code = (p: Rec) => S(p.provider_company_code) || S(p.partner_code);
const rows = Object.values<Rec>(prods)
  .filter((p) => p && typeof p === 'object' && !dead(p) && isStockedProduct(p as any))
  .filter((p) => code(p) !== 'RP023');

type Row = { plate: string; sup: string; deps: { m: number; d: number }[] };
const varied: Row[] = [];
let flat = 0, none = 0;
for (const p of rows) {
  const deps = priceList(p as any).filter((e) => e.deposit).map((e) => ({ m: e.m, d: Number(e.deposit) }));
  if (!deps.length) { none++; continue; }
  const uniq = new Set(deps.map((x) => x.d));
  if (uniq.size <= 1) { flat++; continue; }
  varied.push({ plate: S(p.car_number), sup: nameOf.get(code(p)) || code(p), deps: deps.sort((a, b) => a.m - b.m) });
}
console.log(`■ 재고 ${rows.length}대 (오플 제외)\n`);
console.log(`  보증금이 기간마다 **다른** 차 ${varied.length}대  ← 표에 한 값만 찍으면 틀린다`);
console.log(`  보증금이 하나뿐인 차 ${flat}대 · 보증금이 아예 없는 차 ${none}대\n`);

const bySup = new Map<string, Row[]>();
for (const x of varied) (bySup.get(x.sup) || bySup.set(x.sup, []).get(x.sup)!).push(x);
for (const [sup, xs] of [...bySup].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${sup.padEnd(12).slice(0, 12)} ${String(xs.length).padStart(4)}대`);
  const sample = xs[0];
  console.log(`     예) ${sample.plate} — ${sample.deps.map((d) => `${d.m}개월 ${d.d.toLocaleString()}`).join(' · ')}`);
}
if (LIST) {
  console.log('\n■ 전체');
  for (const x of varied) console.log(`   ${x.sup.padEnd(10)} ${x.plate.padEnd(10)} ${x.deps.map((d) => `${d.m}:${d.d.toLocaleString()}`).join(' ')}`);
}
