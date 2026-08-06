/**
 * 매물에 공급사 정책을 붙인다 — 기본 dry-run, 반영은 --apply.
 *
 * 정책코드가 없으면 심사·연령·보증금 같은 판매조건이 통째로 없다(화면 「미입력」).
 * 정책은 이미 등록돼 있으므로 만들 게 아니라 잇는 문제다.
 *
 * ★부여 규칙 (2026-08-06 사용자 결정)
 *   · 공급사 정책이 **하나뿐이면 그 정책으로 일괄 통일**한다. 비어 있는 것뿐 아니라
 *     **다른 정책이 붙어 있는 것도 덮는다** — 정책이 하나인 회사에 남의 정책이 붙어 있으면
 *     그건 틀린 것이다(실측: 남의 공급사 정책이 붙은 매물 26대).
 *   · 정책이 **둘 이상이면 «먼저 등록한»**(`created_at` 최소) 것을 쓴다.
 *     단 이미 그 공급사 정책 중 하나가 붙어 있으면 유지한다 — 손오공 구독/렌트처럼
 *     의미 있게 갈린 것을 뭉개지 않는다.
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

  /** 공급사 → 정책코드들. 먼저 등록한 것이 앞에 오도록 `created_at` 오름차순. */
  const byCo = new Map<string, { code: string; screening: string; at: number }[]>();
  for (const [k, p] of Object.entries(policies)) {
    if (dead(p)) continue;
    const code = S(p.policy_code) || k;
    const co = S(p.provider_company_code) || S(p.partner_code) || (code.includes('_') ? code.split('_')[0] : '');
    if (!co) continue;
    const at = Number(p.created_at ?? p.createdAt ?? 0) || Number.MAX_SAFE_INTEGER;
    byCo.set(co, [...(byCo.get(co) || []), { code, screening: S(p.screening_criteria), at }]);
  }
  for (const list of byCo.values()) list.sort((a, b) => a.at - b.at);

  const plans: { key: string; co: string; code: string; screening: string; name: string; was: string }[] = [];
  const skipped = new Map<string, number>();
  for (const [key, r] of Object.entries(v4)) {
    if (dead(r) || !isListableProduct(r as any)) continue;
    const co = S(r.provider_company_code);
    const list = byCo.get(co) || [];
    if (!list.length) { skipped.set(co || '(미지정)', (skipped.get(co || '(미지정)') || 0) + 1); continue; }
    const cur = S(r.policy_code);
    const own = new Set(list.map((x) => x.code));
    let pick: typeof list[number] | null = null;
    if (list.length === 1) {
      // 하나뿐 = 일괄 통일. 다른 정책이 붙어 있으면 그건 남의 것이라 덮는다.
      if (cur !== list[0].code) pick = list[0];
    } else if (!cur) {
      // 여럿 = 먼저 등록한 것. 이미 그 공급사 정책이 붙어 있으면 손대지 않는다.
      pick = list[0];
    } else if (!own.has(cur)) {
      // 여럿인데 «남의» 정책이 붙어 있다 — 이것도 틀린 것이므로 먼저 등록한 것으로 되돌린다.
      pick = list[0];
    }
    if (!pick) continue;
    plans.push({ key, co, code: pick.code, screening: pick.screening, name: `${S(r.maker)} ${S(r.model)}`.trim(), was: cur });
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
