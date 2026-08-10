import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });
const token = (await jwt.getAccessToken()).token;
const [p, t3, t4] = await Promise.all(['v4/products','partners','v4/partners'].map(async n =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {}));
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k]||{}), ...v, _key: k };
const dead = (v: Rec) => v?._deleted === true || !!v?.deletedAt || S(v?.status) === 'deleted';
const count = new Map<string, number>();
for (const v of Object.values(p as Record<string, Rec>)) {
  if (!v || typeof v !== 'object' || dead(v)) continue;
  const c = S(v.provider_company_code); if (c) count.set(c, (count.get(c) || 0) + 1);
}
const id = (u: string) => (u.match(/\/spreadsheets\/d\/([\w-]+)/) || [])[1] || '';
const rows = Object.values(partners).filter(x => !dead(x))
  .map(x => ({ code: S(x.partner_code) || S(x._key), name: S(x.name || x.partner_name), url: S(x.sheet_url), tab: S(x.sheet_tab), n: count.get(S(x.partner_code) || S(x._key)) || 0 }))
  .sort((a, b) => b.n - a.n);
const withUrl = rows.filter(r => r.url);
console.log(`■ 공급사 시트 — 등록 ${withUrl.length}곳 / 전체 ${rows.length}곳\n`);
const byId = new Map<string, string[]>();
for (const r of withUrl) { const i = id(r.url); if (!byId.has(i)) byId.set(i, []); byId.get(i)!.push(`${r.name}(${r.code}·${r.n}대${r.tab ? ` gid=${r.tab}` : ''})`); }
for (const r of withUrl) console.log(`  ${String(r.n).padStart(4)}대  ${r.code.padEnd(9)} ${r.name.slice(0,16).padEnd(18)} ${r.url}${r.tab ? `  gid=${r.tab}` : ''}`);
console.log('\n■ 한 시트를 여럿이 나눠 쓰는 것(종합시트)');
for (const [i, who] of byId) if (who.length > 1) console.log(`  ${i}\n     ${who.join(' · ')}`);
console.log('\n■ 시트 미등록인데 재고가 있는 곳');
for (const r of rows.filter(x => !x.url && x.n > 0)) console.log(`  ${String(r.n).padStart(4)}대  ${r.code.padEnd(9)} ${r.name}`);
