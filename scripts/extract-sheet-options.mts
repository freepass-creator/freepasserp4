/**
 * 공급사 시트에 적힌 옵션을 전부 뽑는다 — 차번 기준. 읽기 전용.
 *
 * 옵션은 손님 견적서에 그대로 나가는 값인데 ERP 에 3분의 2가 비어 있다.
 * 채워 넣기 전에 «시트에 뭐가 적혀 있는지»를 통째로 본다. 시트가 정본이다.
 *
 * 같은 차번이 여러 탭에 나오면(종합시트·공급사 탭 중복) 값이 갈릴 수 있어 전부 보여준다.
 *
 *   npx tsx scripts/extract-sheet-options.mts
 *   npx tsx scripts/extract-sheet-options.mts --csv tmp/sheet-options.csv
 *   npx tsx scripts/extract-sheet-options.mts --code=RP021
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const csvCell = (v: unknown) => `"${S(v).replace(/"/g, '""')}"`;

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

async function main() {
  const only = (process.argv.find((a) => a.startsWith('--code=')) || '').split('=')[1] || '';
  const csvOut = process.argv.includes('--csv') ? process.argv[process.argv.indexOf('--csv') + 1] : '';

  const db = getDatabase();
  const [v4s, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const live = (pl.val() || {}) as Record<string, Rec>;
  const over = (po.val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };

  /** ERP: 차번 → { 옵션, 차명, 살아있나 } */
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

  type Row = { code: string; supplier: string; tab: string; plate: string; opts: string; erpName: string; erpOpts: string; inErp: boolean };
  const out: Row[] = [];

  for (const p of Object.values(partners)) {
    if (!S(p.sheet_url) || dead(p)) continue;
    const code = S(p.partner_code);
    if (only && code !== only) continue;
    const supplier = S(p.partner_name || p.company_name);
    const id = idOf(S(p.sheet_url));
    if (!id) continue;
    let meta: any;
    try { meta = await api(`${id}?fields=sheets.properties.title`); } catch { console.log(`   ⚠ ${supplier}: 시트 읽기 실패`); continue; }
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
        const e = erp.get(pn);
        out.push({ code, supplier, tab, plate: pn, opts: so, erpName: e?.name || '', erpOpts: e?.opts || '', inErp: !!e });
      }
    }
  }

  console.log(`\n══ 시트에 적힌 옵션 전량 ══\n`);
  console.log(`  옵션이 적힌 행 ${out.length}건 · 차번 ${new Set(out.map((r) => r.plate)).size}대\n`);

  // 공급사별
  const byCo = new Map<string, { rows: number; inErp: number; filled: number }>();
  for (const r of out) {
    const e = byCo.get(`${r.code} ${r.supplier}`) || { rows: 0, inErp: 0, filled: 0 };
    e.rows++; if (r.inErp) e.inErp++; if (r.inErp && r.erpOpts) e.filled++;
    byCo.set(`${r.code} ${r.supplier}`, e);
  }
  console.log('■ 공급사별 — 시트 옵션행 / ERP에 있는 차 / 그중 옵션이 채워진 것');
  for (const [k, e] of [...byCo].sort((a, b) => b[1].rows - a[1].rows)) {
    const gap = e.inErp - e.filled;
    console.log(`   ${String(e.rows).padStart(5)} / ${String(e.inErp).padStart(4)} / ${String(e.filled).padStart(4)}   ${gap ? `❌ ${gap}건 비어있음` : '✅'}   ${k}`);
  }

  // 같은 차번인데 탭마다 옵션이 다른 것 — 어느 값을 쓸지 사람이 정해야 한다
  const byPlate = new Map<string, Set<string>>();
  for (const r of out) byPlate.set(r.plate, (byPlate.get(r.plate) || new Set()).add(r.opts));
  const conflict = [...byPlate].filter(([, s]) => s.size > 1);
  console.log(`\n■ 같은 차번인데 탭마다 옵션이 다른 것 — ${conflict.length}대`);
  for (const [pn, s] of conflict.slice(0, 8)) {
    console.log(`   ${pn}`);
    for (const v of s) console.log(`      «${v.slice(0, 70)}»`);
  }
  if (conflict.length > 8) console.log(`   … 그 외 ${conflict.length - 8}대`);

  if (csvOut) {
    mkdirSync(csvOut.replace(/[^/\\]+$/, '') || '.', { recursive: true });
    const head = '공급사코드,공급사명,탭,차번,시트옵션,ERP차명,ERP옵션,ERP에있음\n';
    const body = out.map((r) => [r.code, r.supplier, r.tab, r.plate, r.opts, r.erpName, r.erpOpts, r.inErp ? 'Y' : 'N'].map(csvCell).join(',')).join('\n');
    writeFileSync(csvOut, head + body, 'utf8');
    console.log(`\n전량 → ${csvOut}`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
