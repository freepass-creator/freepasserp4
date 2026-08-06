/**
 * 옵션이 시트대로 들어왔나 — 시트 원문과 ERP 를 «차번»으로 대조. 읽기 전용.
 *
 * `_raw_vehicle` 은 차종 매칭용 필드만 담아(옵션 없음) 원본 대조에 못 쓴다.
 * 그래서 공급사 시트를 직접 읽어 «시트엔 옵션이 있는데 ERP 엔 없는» 매물을 센다.
 *
 *   npx tsx scripts/audit-options-vs-sheet.mts
 *   npx tsx scripts/audit-options-vs-sheet.mts --code=RP021
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { HEADER_ALIASES } from '../lib/domain/sheet-import';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');
const PLATE = /\d{2,3}[가-힣]\d{4}/;
const plate = (v: unknown) => (S(v).replace(/\s/g, '').match(PLATE) || [''])[0];
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

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

  /** ERP: 차번 → 옵션 */
  const erp = new Map<string, { opts: string; name: string }>();
  for (const [k, p] of Object.entries(v4)) {
    if (dead(p)) continue;
    const pn = plate(p.car_number) || plate(k);
    if (pn) erp.set(pn, { opts: S(p.options), name: `${S(p.maker)} ${S(p.model)}`.trim() });
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

  const targets = Object.values(partners)
    .filter((p) => S(p.sheet_url) && !dead(p) && (!only || S(p.partner_code) === only));

  console.log('\n══ 옵션이 시트대로 들어왔나 ══\n');

  let sheetHas = 0, erpHas = 0, missing = 0, notInErp = 0;
  const samples: string[] = [];

  for (const p of targets) {
    const id = idOf(S(p.sheet_url));
    if (!id) continue;
    const name = S(p.partner_name || p.company_name);
    let meta: any;
    try { meta = await api(`${id}?fields=sheets.properties.title`); } catch { console.log(`   ${name}: 시트 읽기 실패`); continue; }
    for (const tab of meta.sheets.map((s: any) => s.properties.title) as string[]) {
      let vals: any;
      try { vals = await api(`${id}/values/${encodeURIComponent(`${tab}!A1:BZ2000`)}`); } catch { continue; }
      const rows: string[][] = vals.values || [];
      if (!rows.length) continue;
      let best = 0, hits = -1;
      rows.forEach((r, i) => { const h = r.filter((c) => (HEADER_ALIASES as Rec)[norm(c)]).length; if (h > hits) { hits = h; best = i; } });
      const hdr = rows[best] || [];
      const iPlate = hdr.findIndex((c) => (HEADER_ALIASES as Rec)[norm(c)] === 'car_number');
      const iOpts = hdr.findIndex((c) => (HEADER_ALIASES as Rec)[norm(c)] === 'options');
      if (iPlate < 0 || iOpts < 0) continue;
      for (const r of rows.slice(best + 1)) {
        const pn = plate(r[iPlate]);
        const so = S(r[iOpts]);
        if (!pn || !so) continue;
        sheetHas++;
        const e = erp.get(pn);
        if (!e) { notInErp++; continue; }
        if (S(e.opts)) erpHas++;
        else {
          missing++;
          if (samples.length < 12) samples.push(`   ${pn.padEnd(10)} ${e.name.padEnd(18)} 시트 «${so.slice(0, 40)}» → ERP 빈칸`);
        }
      }
    }
  }

  console.log(`  시트에 옵션이 적힌 행        ${sheetHas}건`);
  console.log(`  ├ ✅ ERP 에도 옵션 있음      ${erpHas}건`);
  console.log(`  ├ ❌ ERP 엔 비어 있음        ${missing}건`);
  console.log(`  └ · ERP 에 그 차가 없음      ${notInErp}건\n`);
  if (samples.length) { console.log('■ 옵션이 안 들어간 표본'); for (const s of samples) console.log(s); console.log(''); }
}

main().catch((e) => { console.error(e); process.exit(1); });
