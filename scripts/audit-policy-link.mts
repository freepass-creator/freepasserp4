/**
 * 정책을 매물에 붙일 수 있나 — 등록된 정책과 공급사를 대조. 읽기 전용.
 *
 * 목록 366대 중 338대에 `policy_code` 가 없다. 그런데 정책은 53건 등록돼 있고
 * 코드가 `RP004_P01` 처럼 «공급사_정책» 꼴이다. 공급사별로 정책이 하나뿐이면
 * 그 공급사 매물에 그대로 붙일 수 있다.
 *
 * npx tsx scripts/audit-policy-link.mts
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
  const [v4s, p3, p4, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('policies').get(), db.ref('v4/policies').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const policies: Record<string, Rec> = { ...((p3.val() || {}) as Rec), ...((p4.val() || {}) as Rec) };
  const live = (pl.val() || {}) as Record<string, Rec>;
  const over = (po.val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };
  const nameOf = (c: string) => S(Object.values(partners).find((x) => S(x.partner_code) === c)?.partner_name
    || Object.values(partners).find((x) => S(x.partner_code) === c)?.company_name) || c;

  console.log(`\n══ 정책을 매물에 붙일 수 있나 ══\n`);
  console.log(`  등록된 정책 ${Object.keys(policies).length}건\n`);

  /** 공급사 → 그 공급사 정책들 */
  const byCo = new Map<string, { code: string; name: string; screening: string }[]>();
  for (const [k, p] of Object.entries(policies)) {
    if (dead(p)) continue;
    const code = S(p.policy_code) || k;
    // 소유 공급사 = 필드 우선, 없으면 코드 접두사
    const co = S(p.provider_company_code) || S(p.partner_code) || (code.includes('_') ? code.split('_')[0] : '');
    if (!co) continue;
    byCo.set(co, [...(byCo.get(co) || []), { code, name: S(p.policy_name), screening: S(p.screening_criteria) }]);
  }

  console.log('■ 공급사별 등록 정책');
  for (const [co, list] of [...byCo].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`   ${co.padEnd(10)} ${String(list.length).padStart(2)}건  ${nameOf(co)}`);
    for (const p of list.slice(0, 3)) console.log(`        ${p.code.padEnd(16)} ${p.name.padEnd(20).slice(0, 20)} 심사«${p.screening || '-'}»`);
    if (list.length > 3) console.log(`        … 그 외 ${list.length - 3}건`);
  }

  // ── 붙일 수 있나 ──
  const rows = Object.values(v4).filter((p) => !dead(p) && isListableProduct(p as any) && !S(p.policy_code));
  const can = new Map<string, number>();
  let single = 0, multi = 0, none = 0;
  for (const p of rows) {
    const co = S(p.provider_company_code);
    const list = byCo.get(co) || [];
    if (list.length === 1) { single++; can.set(co, (can.get(co) || 0) + 1); }
    else if (list.length > 1) multi++;
    else none++;
  }
  console.log(`\n■ 정책코드 없는 목록 매물 ${rows.length}대`);
  console.log(`   ✅ 그 공급사 정책이 «하나뿐» — 자동으로 붙일 수 있음   ${single}대`);
  console.log(`   ⚠ 정책이 여러 개 — 어느 것인지 골라야 함             ${multi}대`);
  console.log(`   ❌ 그 공급사 정책이 아예 없음                        ${none}대\n`);
  if (can.size) {
    console.log('■ 자동으로 붙일 수 있는 공급사');
    for (const [co, n] of [...can].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대  ${co.padEnd(10)} ${nameOf(co)}`);
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
