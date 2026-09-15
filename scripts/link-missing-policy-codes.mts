/**
 * **정책 코드가 안 붙은 원자에 그 공급사 정책을 붙인다** — 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-16 「정책들은 다 있는지 … 할 수 있는 거 다 해줘」.
 *   실측(07:29 스냅샷) — 오토플러스 66대 전부·이안카 57대가 `policy_code` 가 비어 시트·하허호·손님 화면의
 *   보험·정책 칸이 통째로 비었다. `reconcile-product-policy-references` 는 이 차들을 «변경 0건»으로 둔다.
 *
 * ⚠ **지어내지 않는다.** 붙이는 경우는 둘뿐:
 *   ① 표에 사람이 못 박은 공급사(아래 `PINNED`) — 사장님이 고른 정책
 *   ② 같은 공급사·같은 상품구분에서 이미 «한 가지» 정책만 쓰고 있을 때(그 코드를 따른다)
 *   그 밖(정책 문서가 없거나 여러 개라 못 고르는 공급사)은 건드리지 않고 목록으로 보고한다.
 *
 * 기록 — 바꾼 원자에 `policy_code` · `policy_reference_state='linked_by_operator'` ·
 *   `policy_reference_checked_at` · `policy_code_linked_reason` 을 남긴다(누가 왜 붙였는지 되짚게).
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/link-missing-policy-codes.mts [--apply]
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { erp5InventoryAppOptions } from '../lib/server/erp5-inventory-service-account';
import { isOpenInventoryAtom } from '../lib/domain/inventory-contract';

const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');

/** 사장님이 고른 것(2026-09-16) — 공급사코드 → 정책. 여기 없는 공급사는 «자동으로 한 가지일 때»만 붙인다. */
const PINNED: Record<string, { code: string; why: string }> = {
  RP023: { code: 'POL-0047', why: '사장님 2026-09-16 선택 — 오토플러스 정책 문서 중 보험·연령·정비·분납 필드가 다 찬 것' },
  RP031: { code: 'RP031_S01', why: '사장님 2026-09-16 선택 — 같은 공급사 97대가 이미 쓰는 정책' },
};

initializeApp(erp5InventoryAppOptions());
const db = getFirestore();
const [products, policies] = await Promise.all([db.collection('products').get(), db.collection('policy').get()]);
const polKeys = new Set<string>();
for (const d of policies.docs) { polKeys.add(d.id); const c = S(d.data().policy_code); if (c) polKeys.add(c); }
const polByProvider = new Map<string, string[]>();
for (const d of policies.docs) {
  const prov = S(d.data().provider_company_code); if (!prov) continue;
  polByProvider.set(prov, [...(polByProvider.get(prov) || []), d.id]);
}

type Row = { id: string; car: string; prov: string; type: string };
const missing: Row[] = [];
const usedBy = new Map<string, Map<string, number>>();   // 공급사·상품구분 → 쓰는 코드 수
for (const d of products.docs) {
  const a = d.data() as any;
  if (!isOpenInventoryAtom(a)) continue;
  const prov = S(a.provider_company_code); if (!prov) continue;
  const type = S(a.product_type);
  const code = S(a.policy_code);
  if (code) {
    const k = `${prov}|${type}`;
    const m = usedBy.get(k) || new Map<string, number>();
    m.set(code, (m.get(code) || 0) + 1); usedBy.set(k, m);
  } else missing.push({ id: d.id, car: S(a.car_number), prov, type });
}

const plan: (Row & { code: string; why: string })[] = [];
const skipped = new Map<string, { n: number; why: string }>();
for (const r of missing) {
  const pinned = PINNED[r.prov];
  if (pinned && polKeys.has(pinned.code)) { plan.push({ ...r, code: pinned.code, why: pinned.why }); continue; }
  const used = [...(usedBy.get(`${r.prov}|${r.type}`) || new Map()).entries()];
  if (used.length === 1) { plan.push({ ...r, code: used[0][0], why: `같은 공급사·같은 상품구분 ${used[0][1]}대가 쓰는 단 하나의 정책` }); continue; }
  const docs = polByProvider.get(r.prov) || [];
  const why = used.length > 1 ? `같은 공급사가 정책 ${used.length}가지를 쓴다(${used.map(([c, n]) => `${c}×${n}`).join(', ')}) — 사람이 골라야 한다`
    : docs.length ? `정책 문서 ${docs.length}개(${docs.slice(0, 4).join(', ')}) 중 무엇인지 모른다 — 사람이 골라야 한다`
      : '이 공급사의 정책 문서가 없다 — 공급사에서 받아야 한다';
  const key = `${r.prov} ${r.type}`;
  const e = skipped.get(key) || { n: 0, why }; e.n++; skipped.set(key, e);
}

const byPlan = new Map<string, number>();
for (const p of plan) byPlan.set(`${p.prov} ${p.type} → ${p.code}`, (byPlan.get(`${p.prov} ${p.type} → ${p.code}`) || 0) + 1);
console.log(`\n■ 정책 코드 없는 판매 대상 ${missing.length}대 — 붙일 수 있는 ${plan.length}대 · 사람이 정해야 하는 ${missing.length - plan.length}대 (${APPLY ? '반영' : 'dry-run'})`);
for (const [k, n] of [...byPlan].sort((a, b) => b[1] - a[1])) console.log(`  붙임 ${String(n).padStart(3)}대  ${k}`);
for (const [k, e] of [...skipped].sort((a, b) => b[1].n - a[1].n)) console.log(`  보류 ${String(e.n).padStart(3)}대  ${k} — ${e.why}`);
for (const p of plan.slice(0, 8)) console.log(`     표본 ${p.car} (${p.id}) → ${p.code}`);
if (!APPLY) { console.log('\n※ dry-run — --apply 로 붙인다.\n'); process.exit(0); }

for (let i = 0; i < plan.length; i += 300) {
  const batch = db.batch();
  for (const p of plan.slice(i, i + 300)) {
    batch.set(db.collection('products').doc(p.id), {
      policy_code: p.code,
      policy_reference_state: 'linked_by_operator',
      policy_reference_checked_at: FieldValue.serverTimestamp(),
      policy_code_linked_reason: p.why,
    }, { merge: true });
  }
  await batch.commit();
}
console.log(`\n✓ 정책 붙임 ${plan.length}대 — 보류 ${missing.length - plan.length}대는 사람이 정해야 한다\n`);
process.exit(0);
