/**
 * v3 에 있는 옵션을 v4 로 채운다 — 시트로 못 채운 나머지. 기본 dry-run, 반영은 --apply.
 *
 * 시트에서 274대를 채워 30%→74% 가 됐지만, erp3 기준(91%)에 66대가 모자란다.
 * 그 66대는 «시트 동기화 범위 밖»이라 시트로는 닿지 않는다 — 그런데 v3 에는 값이 있다.
 * 같은 차의 확정된 값이므로 옮기면 된다.
 *
 * 시트에서 채우는 것을 먼저 하고 이걸 나중에 하는 순서가 중요하다 —
 * 시트가 정본이고 v3 는 «과거 스냅샷»이다. 시트로 채운 것을 v3 로 덮으면 안 된다.
 *
 * ★안전 계약 — v4 에 옵션이 이미 있으면 건드리지 않는다. 쓰는 필드는 `options` 하나.
 *
 *   npx tsx scripts/apply-options-from-v3.mts
 *   npx tsx scripts/apply-options-from-v3.mts --apply
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
  const [v4s, v3s] = await Promise.all([db.ref('v4/products').get(), db.ref('products').get()]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const v3 = (v3s.val() || {}) as Record<string, Rec>;

  /** 차번 → v3 옵션(있는 것만) */
  const opt3 = new Map<string, string>();
  for (const [k, r] of Object.entries(v3)) {
    if (dead(r)) continue;
    const o = S(r.options);
    if (!o) continue;
    const pn = plate(r, k);
    if (pn && !opt3.has(pn)) opt3.set(pn, o);
  }

  const plans: { key: string; plate: string; name: string; opts: string }[] = [];
  for (const [k, r] of Object.entries(v4)) {
    if (dead(r) || S(r.options)) continue;              // 이미 있으면 유지
    const pn = plate(r, k);
    if (!pn) continue;
    const o = opt3.get(pn);
    if (!o) continue;
    plans.push({ key: k, plate: pn, name: `${S(r.maker)} ${S(r.model)}`.trim(), opts: o });
  }

  console.log(`\n══ v3 옵션으로 나머지 채우기 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  v3 에 옵션이 있는 차 ${opt3.size}대 · v4 가 비어 채울 수 있는 것 ${plans.length}대\n`);
  console.log('■ 표본');
  for (const p of plans.slice(0, 12)) console.log(`   ${p.plate.padEnd(10)} ${p.name.padEnd(18)} «${p.opts.slice(0, 46)}»`);
  if (plans.length > 12) console.log(`   … 그 외 ${plans.length - 12}대`);

  if (!apply) { console.log(`\n※ dry-run. 반영은 --apply\n`); return; }

  let done = 0;
  const errors: string[] = [];
  for (const p of plans) {
    try { await db.ref(`v4/products/${p.key}`).update({ options: p.opts }); done++; }
    catch (e) { errors.push(`${p.key}: ${(e as Error)?.message || String(e)}`); }
  }
  console.log(`\n  반영 ${done}대`);
  if (errors.length) { console.log(`  ❌ 오류 ${errors.length}건`); for (const e of errors.slice(0, 10)) console.log(`     ${e}`); }
  console.log(`\n끝. 확인: npx tsx scripts/audit-options-v3-vs-v4.mts\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
