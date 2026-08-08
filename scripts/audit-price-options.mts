/**
 * 공급사별 **대여료·옵션 원자화** 전수 점검 — 손님에게 나가는 것만.
 *
 * 시트에서 잘 읽혔다고 끝이 아니다. 기간이 제각각이거나 보증금이 비어 있거나
 * 옵션이 한 덩어리로 뭉쳐 있으면 손님 화면에서 비교가 안 된다.
 *
 *   npx tsx scripts/audit-price-options.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isListableProduct, parseProductOptions, priceList } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [
  'https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email',
]});
const token = (await jwt.getAccessToken()).token;
const get = async (n: string) => JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {};
const [prods, live, over] = await Promise.all([get('v4/products'), get('partners'), get('v4/partners')]);
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const name = new Map<string, string>();
for (const src of [live, over] as Record<string, Rec>[]) {
  for (const [k, v] of Object.entries(src)) {
    const code = S(v?.partner_code) || k;
    const n = S(v?.partner_name) || S(v?.company_name) || S(v?.name);
    if (n) name.set(code, n);
  }
}

type Row = {
  n: number; periods: Set<string>; noDeposit: number; zeroDeposit: number;
  optCars: number; optTotal: number; optLumpy: number; rentMin: number; rentMax: number;
  variantKeys: number;
};
const by = new Map<string, Row>();
for (const p of Object.values(prods) as Rec[]) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  if (!isListableProduct(p as never)) continue;
  const code = S(p.provider_company_code) || S(p.partner_code) || '(없음)';
  if (!by.has(code)) by.set(code, { n: 0, periods: new Set(), noDeposit: 0, zeroDeposit: 0, optCars: 0, optTotal: 0, optLumpy: 0, rentMin: Infinity, rentMax: 0, variantKeys: 0 });
  const r = by.get(code)!;
  r.n++;

  const price = (p.price || {}) as Record<string, Rec>;
  for (const k of Object.keys(price)) {
    r.periods.add(k);
    if (k.includes('_')) r.variantKeys++;
    const rent = N(price[k]?.rent);
    if (rent) { r.rentMin = Math.min(r.rentMin, rent); r.rentMax = Math.max(r.rentMax, rent); }
    const dep = price[k]?.deposit;
    if (dep === undefined || dep === null || dep === '') r.noDeposit++;
    else if (N(dep) === 0) r.zeroDeposit++;
  }

  const opts = parseProductOptions(p.options);
  if (opts.length) { r.optCars++; r.optTotal += opts.length; }
  // 쪼개지지 않고 한 덩어리로 온 것 — 구분자가 없는데 긴 글
  if (opts.length === 1 && opts[0].length > 25) r.optLumpy++;
}

console.log(`\n══ 공급사별 대여료·옵션 원자화 — 손님 노출분 ══\n`);
console.log('코드      이름               대수  기간종  주행변형  보증금없음 보증금0  옵션차  평균옵션  덩어리  최저~최고 대여료');
let tot = 0;
for (const [code, r] of [...by].sort((a, b) => b[1].n - a[1].n)) {
  tot += r.n;
  const nm = (name.get(code) || '').slice(0, 16);
  const avg = r.optCars ? (r.optTotal / r.optCars).toFixed(1) : '0';
  const range = r.rentMax ? `${(r.rentMin / 10000).toFixed(0)}~${(r.rentMax / 10000).toFixed(0)}만` : '-';
  console.log(
    `${code.padEnd(9)} ${nm.padEnd(18)} ${String(r.n).padStart(4)} ${String(r.periods.size).padStart(5)}`
    + ` ${String(r.variantKeys).padStart(8)} ${String(r.noDeposit).padStart(9)} ${String(r.zeroDeposit).padStart(7)}`
    + ` ${String(r.optCars).padStart(6)} ${avg.padStart(8)} ${String(r.optLumpy).padStart(6)}  ${range}`,
  );
}
console.log(`\n합계 ${tot}대`);
console.log('\n기간 어휘(공급사별)');
for (const [code, r] of [...by].sort((a, b) => b[1].n - a[1].n)) {
  const ps = [...r.periods].sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]));
  console.log(`  ${code.padEnd(9)} ${ps.join(' · ') || '(없음)'}`);
}
process.exit(0);
