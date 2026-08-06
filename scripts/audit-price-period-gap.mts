/**
 * 「기존 가격기간 누락」이 어느 차인가 — ERP 에는 있는 기간이 시트에 없다. 읽기 전용.
 *
 * 시트 동기화가 멈추는 이유 중 하나다. 시트를 그대로 반영하면 ERP 에만 있던 기간(예: 36개월)이
 * 사라지므로, 기존가를 유지할지 사람이 승인해야 한다. 어느 차인지 차번으로 낸다.
 *
 *   npx tsx scripts/audit-price-period-gap.mts
 *   npx tsx scripts/audit-price-period-gap.mts --code=RP013
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { HEADER_ALIASES } from '../lib/domain/sheet-import';
import { priceList } from '../lib/domain/product';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');
const PLATE = /\d{2,3}[가-힣]\d{4}/;
const plate = (p: Rec, key = '') => {
  for (const src of [p?.car_number, key, p?.product_code]) {
    const m = S(src).replace(/\s/g, '').match(PLATE);
    if (m) return m[0];
  }
  return '';
};
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';
/** 헤더가 「36개월」처럼 기간을 뜻하나 */
const PERIOD_HDR = /^(\d{1,2})\s*개월$/;

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

async function main() {
  const only = (process.argv.find((a) => a.startsWith('--code=')) || '').split('=')[1] || '';
  const db = getDatabase();
  const [v4s, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const live = (pl.val() || {}) as Record<string, Rec>;
  const over = (po.val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };
  const nameOf = (c: string) => S(Object.values(partners).find((x) => S(x.partner_code) === c)?.partner_name
    || Object.values(partners).find((x) => S(x.partner_code) === c)?.company_name) || c;

  /** ERP: 차번 → 유효 기간 집합 */
  const erp = new Map<string, { co: string; name: string; months: Set<number> }>();
  for (const [k, r] of Object.entries(v4)) {
    if (dead(r)) continue;
    const pn = plate(r, k);
    if (!pn) continue;
    const months = new Set(priceList(r as any).filter((x) => x.rent > 0).map((x) => x.m));
    if (!months.size) continue;
    erp.set(pn, { co: S(r.provider_company_code), name: `${S(r.maker)} ${S(r.model)}`.trim(), months });
  }

  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const api = async (p: string) => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<any>;
  };
  const idOf = (u: string) => (u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || '';

  /** 차번 → 시트에서 값이 있던 기간 */
  const sheetMonths = new Map<string, Set<number>>();
  for (const p of Object.values(partners)) {
    if (!S(p.sheet_url) || dead(p)) continue;
    const code = S(p.partner_code);
    if (only && code !== only) continue;
    const id = idOf(S(p.sheet_url));
    if (!id) continue;
    let meta: any;
    try { meta = await api(`${id}?fields=sheets.properties.title`); } catch { continue; }
    for (const tab of meta.sheets.map((s: any) => s.properties.title) as string[]) {
      let vals: any;
      try { vals = await api(`${id}/values/${encodeURIComponent(`${tab}!A1:BZ2000`)}`); } catch { continue; }
      const rows: string[][] = vals.values || [];
      if (!rows.length) continue;
      let best = 0, hits = -1;
      rows.forEach((r, i) => { const h = r.filter((c) => (HEADER_ALIASES as Rec)[norm(c)]).length; if (h > hits) { hits = h; best = i; } });
      const hdr = rows[best] || [];
      const iPlate = hdr.findIndex((c) => (HEADER_ALIASES as Rec)[norm(c)] === 'car_number');
      if (iPlate < 0) continue;
      const periodCols: { i: number; m: number }[] = [];
      hdr.forEach((c, i) => { const m = S(c).match(PERIOD_HDR); if (m) periodCols.push({ i, m: Number(m[1]) }); });
      if (!periodCols.length) continue;
      for (const r of rows.slice(best + 1)) {
        const pn = plate({ car_number: r[iPlate] });
        if (!pn) continue;
        const set = sheetMonths.get(pn) || new Set<number>();
        for (const pc of periodCols) {
          const raw = S(r[pc.i]).replace(/[,\s원]/g, '');
          if (raw && Number(raw) > 0) set.add(pc.m);
        }
        sheetMonths.set(pn, set);
      }
    }
  }

  console.log('\n══ 기존 가격기간 누락 — ERP 에는 있는데 시트에 없는 기간 ══\n');
  const byCo = new Map<string, { pn: string; name: string; miss: number[] }[]>();
  for (const [pn, e] of erp) {
    if (only && e.co !== only) continue;
    const s = sheetMonths.get(pn);
    if (!s) continue;                      // 시트에 그 차가 아예 없으면 이 문제 아님
    const miss = [...e.months].filter((m) => !s.has(m)).sort((a, b) => a - b);
    if (!miss.length) continue;
    byCo.set(e.co, [...(byCo.get(e.co) || []), { pn, name: e.name, miss }]);
  }

  let total = 0;
  for (const [co, list] of [...byCo].sort((a, b) => b[1].length - a[1].length)) {
    total += list.length;
    console.log(`■ ${co} ${nameOf(co)} — ${list.length}대`);
    for (const x of list) console.log(`   ${x.pn.padEnd(11)} ${x.name.padEnd(18)} 없는 기간 ${x.miss.join('·')}개월`);
    console.log('');
  }
  console.log(`  합계 ${total}대\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
