/** 공급사 하나가 v3·v4 각각 몇 대인지 — 어느 쪽에 있는지 확정. 읽기 전용.
 *   npx tsx scripts/count-partner-both.mts RP031
 */
import { readFileSync } from 'node:fs';
import { priceList } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

async function main() {
  const code = S(process.argv[2]) || 'RP031';
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [v4s, v3s, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('products').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);

  console.log(`\n══ ${code} — v3 / v4 어디에 있나 ══\n`);

  for (const [label, snap] of [['v3 products', v3s], ['v4/products', v4s]] as const) {
    const rows = Object.entries((snap.val() || {}) as Record<string, Rec>)
      .filter(([, p]) => S(p.provider_company_code) === code);
    const alive = rows.filter(([, p]) => !dead(p));
    const sell = alive.filter(([, p]) => S(p.vehicle_status).replace(/\s/g, '') !== '출고불가' && priceList(p as any).length > 0);
    console.log(`■ ${label}`);
    console.log(`   전체 ${rows.length} · 살아있음 ${alive.length} · 팔 수 있음 ${sell.length}`);
    for (const [k, p] of sell.slice(0, 3)) console.log(`     ${k}  ${S(p.maker)} ${S(p.model)} · ${S(p.vehicle_status)}`);
    console.log('');
  }

  for (const [label, snap] of [['partners(v3)', pl], ['v4/partners', po]] as const) {
    const hit = Object.entries((snap.val() || {}) as Record<string, Rec>).find(([, p]) => S(p.partner_code) === code);
    console.log(`■ ${label} 레코드 ${hit ? `있음 — ${S(hit[1].partner_name || hit[1].company_name)} · 시트 ${S(hit[1].sheet_url) ? 'O' : 'X'}` : '없음'}`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
