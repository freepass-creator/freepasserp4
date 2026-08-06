/**
 * 공급사 정책이 «하나뿐»인 매물에 정책코드를 붙인다 — 기본 dry-run, 반영은 --apply.
 *
 * 정책코드가 없으면 심사·연령·보증금 같은 판매조건이 통째로 없다(화면 「미입력」).
 * 그런데 정책은 이미 53건 등록돼 있고, 공급사에 정책이 하나뿐이면 고를 여지가 없다.
 *
 * ★안전 계약
 *   · 이미 `policy_code` 가 있으면 건드리지 않는다.
 *   · 그 공급사 정책이 **정확히 하나일 때만** 붙인다. 여럿이면 건너뛴다 —
 *     심사조건은 돈이 걸린 약속이라 추측으로 고르면 안 된다.
 *   · 쓰는 필드는 `policy_code` 하나.
 *
 *   npx tsx scripts/apply-policy-link.mts
 *   npx tsx scripts/apply-policy-link.mts --apply
 */
import { readFileSync } from 'node:fs';
import { isListableProduct } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
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

  /** 공급사 → 정책코드들 */
  const byCo = new Map<string, { code: string; screening: string }[]>();
  for (const [k, p] of Object.entries(policies)) {
    if (dead(p)) continue;
    const code = S(p.policy_code) || k;
    const co = S(p.provider_company_code) || S(p.partner_code) || (code.includes('_') ? code.split('_')[0] : '');
    if (!co) continue;
    byCo.set(co, [...(byCo.get(co) || []), { code, screening: S(p.screening_criteria) }]);
  }

  const plans: { key: string; co: string; code: string; screening: string; name: string }[] = [];
  const skipped = new Map<string, number>();
  for (const [key, r] of Object.entries(v4)) {
    if (dead(r) || !isListableProduct(r as any) || S(r.policy_code)) continue;
    const co = S(r.provider_company_code);
    const list = byCo.get(co) || [];
    if (list.length !== 1) { skipped.set(co || '(미지정)', (skipped.get(co || '(미지정)') || 0) + 1); continue; }
    plans.push({ key, co, code: list[0].code, screening: list[0].screening, name: `${S(r.maker)} ${S(r.model)}`.trim() });
  }

  console.log(`\n══ 정책코드 붙이기 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  붙일 대상 ${plans.length}대 · 건너뜀 ${[...skipped.values()].reduce((a, b) => a + b, 0)}대\n`);

  const byTarget = new Map<string, { n: number; code: string; screening: string }>();
  for (const p of plans) {
    const e = byTarget.get(p.co) || { n: 0, code: p.code, screening: p.screening };
    e.n++; byTarget.set(p.co, e);
  }
  console.log('■ 공급사별 — 붙일 정책과 심사조건');
  for (const [co, e] of [...byTarget].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`   ${String(e.n).padStart(4)}대  ${co.padEnd(10)} ${e.code.padEnd(14)} 심사«${e.screening || '-'}»  ${nameOf(co)}`);
  }
  if (skipped.size) {
    console.log('\n■ 건너뜀 — 정책이 여럿이거나 없음');
    for (const [co, n] of [...skipped].sort((a, b) => b[1] - a[1])) {
      const cnt = (byCo.get(co) || []).length;
      console.log(`   ${String(n).padStart(4)}대  ${co.padEnd(10)} 정책 ${cnt}건  ${nameOf(co)}`);
    }
  }

  if (!apply) { console.log(`\n※ dry-run. 반영은 --apply\n`); return; }

  let done = 0;
  const errors: string[] = [];
  for (const p of plans) {
    try { await db.ref(`v4/products/${p.key}`).update({ policy_code: p.code }); done++; }
    catch (e) { errors.push(`${p.key}: ${(e as Error)?.message || String(e)}`); }
  }
  console.log(`\n  반영 ${done}대`);
  if (errors.length) { console.log(`  ❌ 오류 ${errors.length}건`); for (const e of errors.slice(0, 10)) console.log(`     ${e}`); }
  console.log(`\n끝. 확인: npx tsx scripts/audit-policy-code.mts\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
