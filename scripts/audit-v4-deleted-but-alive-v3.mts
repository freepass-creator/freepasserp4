/**
 * 「erp3 엔 나오는데 erp4 엔 안 나온다」 전수 — v3 는 살아있는데 v4 에서 삭제 표시된 차. 읽기 전용.
 *
 * 키 규약이 갈려 있어(v3 `EXT_해시` / v4 `공급사_차번`) 키로는 못 맞춘다.
 * **차번(실번호판)으로 맞춘다** — 같은 실물인지 판단할 유일한 공통 신호다.
 *
 * npx tsx scripts/audit-v4-deleted-but-alive-v3.mts
 */
import { readFileSync } from 'node:fs';
import { priceList } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /\d{2,3}[가-힣]\d{4}/;
const plateOf = (p: Rec, key: string) => {
  for (const src of [p?.car_number, key, p?.product_code]) {
    const m = S(src).replace(/\s/g, '').match(PLATE);
    if (m) return m[0];
  }
  return '';
};
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';
const sellable = (p: Rec) => S(p?.vehicle_status).replace(/\s/g, '') !== '출고불가' && priceList(p as any).length > 0;

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [v4s, v3s] = await Promise.all([db.ref('v4/products').get(), db.ref('products').get()]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const v3 = (v3s.val() || {}) as Record<string, Rec>;

  /** 차번 → v4 레코드들 */
  const v4ByPlate = new Map<string, { key: string; p: Rec }[]>();
  for (const [k, p] of Object.entries(v4)) {
    const pl = plateOf(p, k);
    if (pl) v4ByPlate.set(pl, [...(v4ByPlate.get(pl) || []), { key: k, p }]);
  }

  const gone: { plate: string; co: string; name: string; status: string }[] = [];
  const missing: { plate: string; co: string; name: string }[] = [];

  for (const [k, p] of Object.entries(v3)) {
    if (dead(p) || !sellable(p)) continue;         // v3 에서 팔 수 있는 차만
    const pl = plateOf(p, k);
    if (!pl) continue;
    const hits = v4ByPlate.get(pl) || [];
    const name = `${S(p.maker)} ${S(p.model)} ${S(p.sub_model)}`.trim();
    if (!hits.length) { missing.push({ plate: pl, co: S(p.provider_company_code), name }); continue; }
    if (hits.every(({ p: q }) => dead(q))) {
      gone.push({ plate: pl, co: S(p.provider_company_code), name, status: S(p.vehicle_status) });
    }
  }

  console.log('\n══ v3 엔 살아있는데 v4 엔 없는/삭제된 차 ══\n');
  console.log(`  ❌ v4 에서 삭제 표시   ${gone.length}대`);
  console.log(`  ❌ v4 에 아예 없음     ${missing.length}대`);
  console.log(`  ─────────────────────────────`);
  console.log(`     합계               ${gone.length + missing.length}대\n`);

  const byCo = new Map<string, number>();
  for (const g of [...gone, ...missing]) byCo.set(g.co || '(없음)', (byCo.get(g.co || '(없음)') || 0) + 1);
  console.log('■ 공급사별');
  for (const [c, n] of [...byCo].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대  ${c}`);

  console.log('\n■ 삭제 표시된 것 표본');
  for (const g of gone.slice(0, 15)) console.log(`   ${g.plate.padEnd(10)} ${g.co.padEnd(9)} ${g.name.padEnd(28)} ${g.status}`);
  if (gone.length > 15) console.log(`   … 그 외 ${gone.length - 15}대`);

  console.log('\n■ v4 에 아예 없는 것 표본');
  for (const m of missing.slice(0, 15)) console.log(`   ${m.plate.padEnd(10)} ${m.co.padEnd(9)} ${m.name}`);
  if (missing.length > 15) console.log(`   … 그 외 ${missing.length - 15}대`);
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
