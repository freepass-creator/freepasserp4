/**
 * 옵션 채움 수준을 erp3(v3) 과 맞췄나 — 같은 차를 두 노드에서 대조. 읽기 전용.
 *
 * 기준은 «erp3 와 동일한 수준»이다. v3 에 옵션이 있는데 v4 에 없으면 후퇴다.
 * 키 규약이 갈려 있으므로(v3 `EXT_해시` / v4 `공급사_차번`) **차번**으로 맞춘다.
 *
 * npx tsx scripts/audit-options-v3-vs-v4.mts
 */
import { readFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /\d{2,3}[가-힣]\d{4}/;
const plate = (p: Rec, key: string) => {
  for (const src of [p?.car_number, key, p?.product_code]) {
    const m = S(src).replace(/\s/g, '').match(PLATE);
    if (m) return m[0];
  }
  return '';
};
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

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

  /** 차번 → v4 살아있는 레코드 */
  const byPlate4 = new Map<string, { key: string; r: Rec }>();
  for (const [k, r] of Object.entries(v4)) {
    if (dead(r)) continue;
    const pn = plate(r, k);
    if (pn && !byPlate4.has(pn)) byPlate4.set(pn, { key: k, r });
  }

  let bothAlive = 0, v3Has = 0, v4Has = 0, onlyV3 = 0, onlyV4 = 0, neither = 0;
  const regress: string[] = [];

  for (const [k3, r3] of Object.entries(v3)) {
    if (dead(r3)) continue;
    const pn = plate(r3, k3);
    if (!pn) continue;
    const hit = byPlate4.get(pn);
    if (!hit) continue;
    bothAlive++;
    const a = !!S(r3.options);
    const b = !!S(hit.r.options);
    if (a) v3Has++;
    if (b) v4Has++;
    if (a && !b) {
      onlyV3++;
      if (regress.length < 12) regress.push(`   ${pn.padEnd(10)} ${`${S(hit.r.maker)} ${S(hit.r.model)}`.trim().padEnd(18)} v3«${S(r3.options).slice(0, 40)}» → v4 빈칸`);
    } else if (!a && b) onlyV4++;
    else if (!a && !b) neither++;
  }

  const pct = (n: number) => (bothAlive ? Math.round((n / bothAlive) * 100) : 0);
  console.log('\n══ 옵션 채움 — erp3 대비 ══\n');
  console.log(`  양쪽에 살아있는 같은 차   ${bothAlive}대\n`);
  console.log(`  erp3(v3) 옵션 있음       ${String(v3Has).padStart(4)}대  (${pct(v3Has)}%)`);
  console.log(`  erp4(v4) 옵션 있음       ${String(v4Has).padStart(4)}대  (${pct(v4Has)}%)`);
  console.log(`  ${v4Has >= v3Has ? '✅ erp3 이상' : `❌ erp3 보다 ${v3Has - v4Has}대 부족`}\n`);
  console.log(`  ├ v3 에만 있음(후퇴)      ${onlyV3}대`);
  console.log(`  ├ v4 에만 있음(전진)      ${onlyV4}대`);
  console.log(`  └ 둘 다 없음             ${neither}대\n`);

  if (regress.length) { console.log('■ 후퇴 표본 — v3 엔 있는데 v4 엔 없다'); for (const r of regress) console.log(r); if (onlyV3 > regress.length) console.log(`   … 그 외 ${onlyV3 - regress.length}대`); console.log(''); }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
