/**
 * 정책코드가 없는 매물 — 공급사별로 센다. 읽기 전용.
 *
 * 정책코드가 없으면 심사·보증금·연령·주행 같은 «판매 조건»이 없다. 상품정보만 올라간 상태다.
 * 그런 매물은 화면에 «미입력»으로 드러나야 한다 — 조건이 없는 것과 조건을 못 불러온 것을
 * 손님·영업자가 구분할 수 없으면 잘못된 견적이 나간다.
 *
 * npx tsx scripts/audit-policy-code.mts
 */
import { readFileSync } from 'node:fs';
import { isListableProduct } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [v4s, p3s, p4s, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('policies').get(), db.ref('v4/policies').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  // ★정책도 v3+v4 병합으로 봐야 한다 — 화면이 그렇게 읽는다.
  //  v4 전용 정책(예: 새로 만든 POL-0047)을 v3 만 보고 «끊어진 참조»로 오판했다.
  const policies: Record<string, Rec> = { ...((p3s.val() || {}) as Rec), ...((p4s.val() || {}) as Rec) };
  const live = (pl.val() || {}) as Record<string, Rec>;
  const over = (po.val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };
  const nameOf = (c: string) => S(Object.values(partners).find((x) => S(x.partner_code) === c)?.partner_name
    || Object.values(partners).find((x) => S(x.partner_code) === c)?.company_name);

  const policyKeys = new Set<string>();
  for (const [k, p] of Object.entries(policies)) { policyKeys.add(k); const c = S(p.policy_code); if (c) policyKeys.add(c); }

  const rows = Object.values(v4).filter((p) => !dead(p) && isListableProduct(p as any));

  const by = new Map<string, { total: number; none: number; dangling: number }>();
  let none = 0, dangling = 0;
  for (const p of rows) {
    const co = S(p.provider_company_code) || '(미지정)';
    const e = by.get(co) || { total: 0, none: 0, dangling: 0 };
    e.total++;
    const pc = S(p.policy_code);
    if (!pc) { e.none++; none++; }
    else if (!policyKeys.has(pc)) { e.dangling++; dangling++; }
    by.set(co, e);
  }

  console.log('\n══ 정책코드 미입력 매물 ══\n');
  console.log(`  목록 노출 ${rows.length}대`);
  console.log(`  ├ ❌ 정책코드 없음          ${none}대   ← 판매조건 없이 상품정보만`);
  console.log(`  └ ⚠ 코드는 있는데 정책 없음  ${dangling}대   ← 끊어진 참조\n`);
  console.log(`  등록된 정책 ${Object.keys(policies).length}건\n`);

  console.log('■ 공급사별 — 전체 / 코드없음 / 끊어짐');
  for (const [co, e] of [...by].sort((a, b) => (b[1].none + b[1].dangling) - (a[1].none + a[1].dangling))) {
    const bad = e.none + e.dangling;
    console.log(`   ${bad ? '❌' : '✅'} ${co.padEnd(10)} ${String(e.total).padStart(4)} / ${String(e.none).padStart(4)} / ${String(e.dangling).padStart(4)}   ${nameOf(co)}`);
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
