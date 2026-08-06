/**
 * v3 매물에 붙어 있던 정책 «연결»을 v4 로 가져온다 — 기본 dry-run, 반영은 --apply.
 *
 * 정책 «레코드» 자체는 이미 v4 것이다(살아있는 25건이 전부 `v4/policies` 에 있고 v3 전용은 0건).
 * 남은 것은 매물 → 정책 연결이다. v3 에는 붙어 있는데 v4 에 없는 것이 127대다.
 * 이걸 가져오면 v3 를 계속 쳐다볼 필요가 없다 — v4 단독으로 완결된다.
 *
 * ★안전 계약
 *   · v4 에 이미 `policy_code` 가 있으면 건드리지 않는다.
 *   · 가져올 코드가 `v4/policies` 에 **실재할 때만** 쓴다. 끊어진 참조를 만들지 않는다.
 *   · 그 정책의 소유 공급사가 매물 공급사와 다르면 건너뛴다 — 남의 심사조건을 붙이면 사고다.
 *   · 쓰는 필드는 `policy_code` 하나.
 *
 *   npx tsx scripts/apply-policy-from-v3.mts
 *   npx tsx scripts/apply-policy-from-v3.mts --apply
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
  const apply = process.argv.includes('--apply');
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [v4s, v3s, p4s] = await Promise.all([
    db.ref('v4/products').get(), db.ref('products').get(), db.ref('v4/policies').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const v3 = (v3s.val() || {}) as Record<string, Rec>;
  const pol4 = (p4s.val() || {}) as Record<string, Rec>;

  /** 정책코드 → 소유 공급사. v4 에 실재하는 것만 담는다. */
  const owner = new Map<string, string>();
  for (const [k, p] of Object.entries(pol4)) {
    if (dead(p)) continue;
    const co = S(p.provider_company_code) || S(p.partner_code);
    for (const c of [k, S(p.policy_code)]) if (c) owner.set(c, co);
  }

  /** 차번 → v3 정책코드 */
  const pol3 = new Map<string, string>();
  for (const [k, r] of Object.entries(v3)) {
    if (dead(r)) continue;
    const c = S(r.policy_code);
    if (!c) continue;
    const pn = plate(r, k);
    if (pn && !pol3.has(pn)) pol3.set(pn, c);
  }

  const plans: { key: string; plate: string; code: string; co: string; name: string }[] = [];
  const skipMissing: string[] = [];
  const skipOwner: string[] = [];

  for (const [k, r] of Object.entries(v4)) {
    if (dead(r) || S(r.policy_code)) continue;
    const pn = plate(r, k);
    if (!pn) continue;
    const code = pol3.get(pn);
    if (!code) continue;
    const label = `${S(r.maker)} ${S(r.model)}`.trim();
    if (!owner.has(code)) { skipMissing.push(`   ${pn.padEnd(10)} «${code}» — v4/policies 에 없음`); continue; }
    const co = S(r.provider_company_code);
    const polCo = owner.get(code) || '';
    if (polCo && co && polCo !== co) { skipOwner.push(`   ${pn.padEnd(10)} «${code}»(${polCo}) ≠ 매물 공급사 ${co}`); continue; }
    plans.push({ key: k, plate: pn, code, co, name: label });
  }

  console.log(`\n══ v3 정책 연결 가져오기 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  v4/policies 살아있는 정책 ${[...new Set(owner.keys())].length}개 코드`);
  console.log(`  가져올 대상 ${plans.length}대`);
  console.log(`  ├ ⏸ 정책 레코드 없음      ${skipMissing.length}대`);
  console.log(`  └ ⏸ 소유 공급사 불일치     ${skipOwner.length}대\n`);

  const byCode = new Map<string, number>();
  for (const p of plans) byCode.set(`${p.co} · ${p.code}`, (byCode.get(`${p.co} · ${p.code}`) || 0) + 1);
  console.log('■ 붙을 정책');
  for (const [c, n] of [...byCode].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대  ${c}`);
  console.log('\n■ 표본');
  for (const p of plans.slice(0, 10)) console.log(`   ${p.plate.padEnd(10)} ${p.name.padEnd(16)} → ${p.code}`);
  if (plans.length > 10) console.log(`   … 그 외 ${plans.length - 10}대`);
  if (skipOwner.length) { console.log('\n■ 소유 불일치로 건너뜀'); for (const s of skipOwner.slice(0, 10)) console.log(s); if (skipOwner.length > 10) console.log(`   … 그 외 ${skipOwner.length - 10}대`); }
  if (skipMissing.length) { console.log('\n■ 정책 레코드 없어 건너뜀'); for (const s of skipMissing.slice(0, 10)) console.log(s); }

  if (!apply) { console.log(`\n※ dry-run. 반영은 --apply\n`); return; }

  let done = 0;
  const errors: string[] = [];
  for (const p of plans) {
    try { await db.ref(`v4/products/${p.key}`).update({ policy_code: p.code }); done++; }
    catch (e) { errors.push(`${p.key}: ${(e as Error)?.message || String(e)}`); }
  }
  console.log(`\n  반영 ${done}대`);
  if (errors.length) { console.log(`  ❌ 오류 ${errors.length}건`); for (const e of errors.slice(0, 10)) console.log(`     ${e}`); }
  console.log(`\n끝. 확인: npx tsx scripts/audit-policy-v3-vs-v4.mts\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
