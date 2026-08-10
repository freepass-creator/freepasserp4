/**
 * 인피니티·빈 파워트레인 셸·지정 차번 점검 (읽기 전용)
 *   npx tsx scripts/_probe-infiniti-empty-pt.mts
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const out: string[] = [];
const log = (...a: unknown[]) => { out.push(a.map(String).join(' ')); };

const plates = new Set(['133라1401', '192머7372', '321라9324']);
const master = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: any[] = master.entries || master;

const empty: any[] = [];
for (const e of entries) {
  const vars = e.variants || [];
  const bad = vars.filter((v: any) => !String(v.label || '').trim() && !(Number(v.battery_kwh) > 0));
  if (!bad.length) continue;
  empty.push({
    maker: e.maker,
    model: e.model,
    sub: e.sub_model,
    y: `${e.year_start}~${e.year_end}`,
    emptyN: bad.length,
    varN: vars.length,
    trims: (bad[0]?.trims || []).slice(0, 8),
  });
}
log('EMPTY_LABEL_SHELLS', empty.length);
for (const x of empty) {
  log('|', x.maker, '|', x.model, '|', x.sub, '|', x.y, '|', `${x.emptyN}/${x.varN}`, '|', (x.trims || []).join('/'));
}

const inf = entries.filter((e: any) => e.maker === '인피니티');
log('\nINFINITI_MASTER', inf.length);
for (const e of inf) {
  const labs = (e.variants || []).map((v: any) => String(v.label || '').trim() || '(empty)');
  log('|', e.sub_model, '|', `${e.year_start}~${e.year_end}`, '|', labs.join(' · ') || '(no variants)');
}

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const token = (await jwt.getAccessToken()).token!;
const get = async (n: string) => JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {};
const S = (v: unknown) => String(v ?? '').trim();
const [v4, v3, liveP, overP] = await Promise.all([get('v4/products'), get('products'), get('partners'), get('v4/partners')]);
const merge = (a: any, b: any) => {
  const o: Record<string, any> = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) o[k] = { ...(a?.[k] || {}), ...(b?.[k] || {}) };
  return o;
};
const products = merge(v3, v4);
const partners = merge(liveP, overP);

log('\nPLATE_HITS');
let plateHits = 0;
for (const [k, p] of Object.entries(products) as [string, any][]) {
  if (!p || typeof p !== 'object') continue;
  const pl = S(p.car_number).replace(/\s/g, '');
  if (!plates.has(pl) && ![...plates].some((x) => S(k).includes(x) || S(p.product_code).includes(x))) continue;
  plateHits++;
  log('|', k, '|', pl, '|', S(p.maker), '|', S(p.model), '|', S(p.sub_model), '|', S(p.variant) || '(empty-variant)', '|', S(p.fuel_type), '|', S(p.year), '|', S(p.vehicle_status), '|', S(p.provider_company_code), '|', p._deleted || p.deletedAt ? 'DEL' : '');
}
log('plateHits', plateHits);

log('\nPARTNERS_INF');
for (const [k, p] of Object.entries(partners) as [string, any][]) {
  if (!p || typeof p !== 'object') continue;
  const blob = [k, p.partner_code, p.name, p.company_name, p.sheet_url, p.adapter_id].map(S).join(' ');
  if (!/인피|infiniti/i.test(blob)) continue;
  log(JSON.stringify({
    key: k,
    code: p.partner_code,
    name: p.name || p.company_name,
    adapter: p.adapter_id,
    url: S(p.sheet_url).slice(0, 100),
    tab: p.sheet_tab,
    hdr: p.header_row,
    active: p.is_active,
    type: p.partner_type,
  }));
}

log('\nPRODUCTS_MAKER_INF');
const infProd = (Object.entries(products) as [string, any][])
  .filter(([, p]) => p && /인피니티|인피티니|infiniti/i.test(S(p.maker) + S(p.model) + S(p.sub_model)));
log('count', infProd.length);
for (const [, p] of infProd.slice(0, 40)) {
  log('|', S(p.provider_company_code), '|', S(p.car_number), '|', S(p.maker), '|', S(p.model), '|', S(p.sub_model), '|', S(p.variant) || '(empty)', '|', S(p.year), '|', S(p.vehicle_status));
}

// stock where maker/model looks broken (I alone) related to STATUS note
log('\nBROKEN_MODEL_I');
let brokenI = 0;
for (const [, p] of Object.entries(products) as [string, any][]) {
  if (!p || typeof p !== 'object') continue;
  if (S(p.model) === 'I' || S(p.model) === 'i') {
    brokenI++;
    if (brokenI <= 20) log('|', S(p.provider_company_code), '|', S(p.car_number), '|', S(p.maker), '|', S(p.model), '|', S(p.sub_model), '|', S(p.year));
  }
}
log('brokenI', brokenI);

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/probe-infiniti-empty-pt.txt', `${out.join('\n')}\n`, 'utf8');
console.log('wrote tmp/probe-infiniti-empty-pt.txt lines', out.length);
