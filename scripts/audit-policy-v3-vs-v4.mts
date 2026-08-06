/**
 * 정책코드 연결을 erp3 과 대조 — 같은 차를 두 노드에서. 읽기 전용.
 *
 * 옵션과 같은 구도다. v3 에 정책이 붙어 있는데 v4 에 없으면 후퇴다.
 * 정책 «레코드»가 아니라 매물에 붙은 «연결»을 본다 — 정책 자체는 이미 53건 있다.
 *
 * npx tsx scripts/audit-policy-v3-vs-v4.mts
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
  const [v4s, v3s, p3, p4] = await Promise.all([
    db.ref('v4/products').get(), db.ref('products').get(),
    db.ref('policies').get(), db.ref('v4/policies').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const v3 = (v3s.val() || {}) as Record<string, Rec>;
  const policies: Record<string, Rec> = { ...((p3.val() || {}) as Rec), ...((p4.val() || {}) as Rec) };
  const known = new Set<string>();
  for (const [k, p] of Object.entries(policies)) { known.add(k); const c = S(p.policy_code); if (c) known.add(c); }

  const byPlate4 = new Map<string, { key: string; r: Rec }>();
  for (const [k, r] of Object.entries(v4)) {
    if (dead(r)) continue;
    const pn = plate(r, k);
    if (pn && !byPlate4.has(pn)) byPlate4.set(pn, { key: k, r });
  }

  let both = 0, v3Has = 0, v4Has = 0, onlyV3 = 0, dangling = 0;
  const fixable: string[] = [];
  const byCo = new Map<string, number>();

  for (const [k3, r3] of Object.entries(v3)) {
    if (dead(r3)) continue;
    const pn = plate(r3, k3);
    if (!pn) continue;
    const hit = byPlate4.get(pn);
    if (!hit) continue;
    both++;
    const a = S(r3.policy_code);
    const b = S(hit.r.policy_code);
    if (a) v3Has++;
    if (b) v4Has++;
    if (a && !b) {
      onlyV3++;
      if (!known.has(a)) dangling++;
      const co = S(hit.r.provider_company_code) || '(미지정)';
      byCo.set(co, (byCo.get(co) || 0) + 1);
      if (fixable.length < 12) fixable.push(`   ${pn.padEnd(10)} ${`${S(hit.r.maker)} ${S(hit.r.model)}`.trim().padEnd(16)} v3«${a}»${known.has(a) ? '' : ' ⚠정책 레코드 없음'}`);
    }
  }

  const pct = (n: number) => (both ? Math.round((n / both) * 100) : 0);
  console.log('\n══ 정책 연결 — erp3 대비 ══\n');
  console.log(`  양쪽에 살아있는 같은 차   ${both}대\n`);
  console.log(`  erp3(v3) 정책 붙음       ${String(v3Has).padStart(4)}대  (${pct(v3Has)}%)`);
  console.log(`  erp4(v4) 정책 붙음       ${String(v4Has).padStart(4)}대  (${pct(v4Has)}%)`);
  console.log(`  ${v4Has >= v3Has ? '✅ erp3 이상' : `❌ erp3 보다 ${v3Has - v4Has}대 부족`}\n`);
  console.log(`  ├ v3 에만 붙어 있음      ${onlyV3}대   ← 가져올 수 있는 것`);
  console.log(`  └ 그중 정책 레코드 없음   ${dangling}대   ⚠ 가져와도 끊어진 참조\n`);

  if (byCo.size) {
    console.log('■ 가져올 수 있는 것 — 공급사별');
    for (const [c, n] of [...byCo].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대  ${c}`);
  }
  if (fixable.length) { console.log('\n■ 표본'); for (const f of fixable) console.log(f); }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
