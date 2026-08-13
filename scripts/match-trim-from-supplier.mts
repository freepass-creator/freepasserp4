/**
 * **세부트림이 빈 차를 공급사 시트 원문에서 찾아 준다.** 읽기 전용(고치지 않는다).
 *
 * ★왜(사장님 2026-08-13 — 「공급사거에서 갖고 올 수 있는 것만 보자고」)
 *   트림은 지어낼 수 없다. 공급사가 적어 둔 글자에 **이미 들어 있는 경우에만** 가져온다.
 *
 * ★어떻게 — 지어내지 않기 위해 **차종마스터 트림 목록에 있는 말만** 인정한다.
 *   손오공은 「아이오닉 5 런칭 자가용 전기모터 5인승 2WD 롱레인지 19인치(EXCLUSIVE)」처럼
 *   차명·파워트레인·트림을 한 칸에 뭉쳐 쓴다. 그 문자열에서 마스터가 아는 트림을 찾는 것이다.
 *   ⚠ 마스터에 없는 말은 **가져오지 않는다.** 그건 「못 찾음」으로 남겨 사람이 본다.
 *   ⚠ 긴 말부터 맞춘다 — 「노블레스 라이트」가 있는데 「라이트」를 집으면 등급이 내려간다.
 *
 *   npx tsx scripts/match-trim-from-supplier.mts
 *   npx tsx scripts/match-trim-from-supplier.mts --code=RP012
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isStockedProduct } from '../lib/domain/product';
import { makerDisplay } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '').toLowerCase();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONLY = arg('code');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
/** 트림 자리에 앉은 «트림이 아닌 말» — 그 차는 트림이 없다는 뜻이다(요즘 제네시스가 그렇다). */
const NOT_A_TRIM = /^\(?세부등급\s*없음\)?$|^없음$|^-$/;

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

const parsed = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as unknown;
const entries = (Array.isArray(parsed) ? parsed : ((parsed as Rec)?.entries || Object.values(parsed as Rec))) as MasterEntry[];
const mk = (v: unknown) => norm(makerDisplay(v));
const byMaker = new Map<string, MasterEntry[]>();
for (const e of entries) { const k = mk(e.maker); (byMaker.get(k) || byMaker.set(k, []).get(k)!).push(e); }

const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const nameOf = new Map<string, string>();
for (const p of Object.values(partners)) { const c = S(p.partner_code) || S(p._key); if (c && !nameOf.has(c)) nameOf.set(c, S(p.partner_name || p.name)); }

const code = (p: Rec) => S(p.provider_company_code) || S(p.partner_code);
const rows = Object.values<Rec>(prods)
  .filter((p) => p && typeof p === 'object' && !dead(p) && isStockedProduct(p as any))
  .filter((p) => code(p) !== 'RP023' && !(code(p) === 'RP012' && /구독/.test(canonProductType(p.product_type) || '')))
  .filter((p) => { const t = S(p.trim_name); return !t || NOT_A_TRIM.test(t); })
  .filter((p) => !ONLY || code(p) === ONLY);
console.log(`■ 세부트림이 빈 차 ${rows.length}대\n`);

/** 그 차의 마스터 트림 후보 — 세부모델까지 좁혀서 모은다. */
const trimsFor = (p: Rec): string[] => {
  const pool = byMaker.get(mk(p.maker)) || [];
  const model = norm(p.model);
  const sub = norm(p.sub_model);
  const hit = pool.filter((e) => norm(e.model) === model)
    .filter((e) => !sub || norm(e.sub_model) === sub || norm(`${e.sub_model}${e.gen_code}`) === sub);
  const list = new Set<string>();
  for (const e of (hit.length ? hit : pool.filter((x) => norm(x.model) === model))) {
    for (const t of e.trims || []) list.add(S(t));
    for (const v of e.variants || []) for (const t of v.trims || []) list.add(S(t));
  }
  // 긴 말부터 — 「노블레스 라이트」가 있는데 「라이트」를 집으면 등급이 내려간다.
  return [...list].filter(Boolean).sort((a, b) => norm(b).length - norm(a).length);
};

/** 공급사 시트에서 그 차의 줄을 통째로 읽어 온다(어느 칸에 적혔는지 모르므로 줄 전체를 본다). */
const sheetTextByPlate = new Map<string, string>();
{
  const get = async (u: string) => { const r = await fetch(u, { headers: { Authorization: `Bearer ${shT}` } }); if (!r.ok) throw new Error(`${r.status}`); return r.json() as Promise<Rec>; };
  const want = new Set(rows.map((p) => norm(p.car_number)));
  const codes = new Set(rows.map((p) => code(p)));
  for (const p of Object.values(partners)) {
    const c = S(p.partner_code) || S(p._key);
    if (!codes.has(c) || dead(p)) continue;
    const id = S(p.sheet_url).match(/\/spreadsheets\/d\/([\w-]+)/)?.[1];
    if (!id) { console.log(`  (${c} ${nameOf.get(c)} — 시트 없음. 홈피 수집이라 여기서는 못 가져온다)`); continue; }
    try {
      const meta = await get(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(title,hidden)`);
      for (const s of (meta.sheets || []) as Rec[]) {
        if (s.properties.hidden) continue;
        const t = S(s.properties.title);
        const v = await get(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`);
        for (const r of ((v.values || []) as string[][])) {
          const plate = r.map(norm).find((x) => want.has(x));
          if (plate && !sheetTextByPlate.has(plate)) sheetTextByPlate.set(plate, r.map(S).join(' | '));
        }
      }
    } catch { /* 못 읽는 시트는 아래에서 «원문 못 찾음»으로 드러난다 */ }
  }
}

let found = 0, noText = 0, noHit = 0;
const bySup = new Map<string, string[]>();
for (const p of rows) {
  const c = code(p);
  const sup = nameOf.get(c) || c;
  const text = sheetTextByPlate.get(norm(p.car_number)) || '';
  const cands = trimsFor(p);
  const hit = text ? cands.find((t) => norm(text).includes(norm(t))) : '';
  let line: string;
  if (!text) { noText++; line = `✗원문없음  ${S(p.car_number).padEnd(10)} ${S(p.model)} ${S(p.sub_model)}`; }
  else if (hit) { found++; line = `✓${hit.padEnd(14)} ${S(p.car_number).padEnd(10)} ${S(p.model)} ${S(p.sub_model)}`; }
  else { noHit++; line = `✗못찾음    ${S(p.car_number).padEnd(10)} ${S(p.model)} ${S(p.sub_model)}  · 후보 ${cands.length}종 · 원문 ${text.replace(/\s+/g, ' ').slice(0, 80)}`; }
  (bySup.get(sup) || bySup.set(sup, []).get(sup)!).push(line);
}
for (const [sup, list] of [...bySup].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n── ${sup} ${list.length}대`);
  for (const l of list) console.log(`   ${l}`);
}
console.log(`\n■ 가져올 수 있음 ${found}대 · 원문에 트림이 없음 ${noHit}대 · 공급사 원문 자체를 못 찾음 ${noText}대`);
