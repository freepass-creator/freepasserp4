/**
 * **공급사 × 상품구분 → 정책** 실태와 규칙 적용 — 기본 dry-run, 반영은 `--apply`.
 *
 *   npx tsx scripts/audit-policy-rules.mts            # 지금 무엇을 쓰고 있나 · 규칙이 무엇을 채울까
 *   npx tsx scripts/audit-policy-rules.mts --apply    # 빈칸만 채운다
 *   npx tsx scripts/audit-policy-rules.mts --only=RP012
 *
 * ★규칙표는 `lib/domain/supplier-policy-rules.ts` 다. 여기서 정하지 않는다 — 이 도구는 «보고 적용»만.
 * ★★**빈칸만 채운다.** 적힌 값은 사람이 정한 것일 수 있어 절대 안 덮는다(정책은 계약서에 실린다).
 *
 * ★같이 알린다 — **코드는 적혀 있는데 그 정책 레코드가 없는 차.**
 *   규칙으로는 못 고치는 종류의 구멍이고, 손님 화면에서는 「빈칸」과 똑같이 조건이 안 뜬다.
 *   실측 2026-09-04: `pol_freepassstd`·`RP031_S1` 처럼 레코드 없는 코드를 수백 대가 달고 있었다.
 */
import { readFileSync } from 'node:fs';
import { policyByRule, SUPPLIER_POLICY_RULES } from '../lib/domain/supplier-policy-rules';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const ONLY = new Set(arg('only').split(',').map(S).filter(Boolean));

const { initializeApp, cert, getApps } = await import('firebase-admin/app');
const { getDatabase } = await import('firebase-admin/database');
if (!getApps().length) {
  const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
}
const db = getDatabase();
const [pSnap, v3p, v4p, v3t, v4t] = await Promise.all([
  db.ref('v4/products').get(),
  db.ref('policies').get().catch(() => null),
  db.ref('v4/policies').get().catch(() => null),
  db.ref('partners').get().catch(() => null),
  db.ref('v4/partners').get().catch(() => null),
]);

/** 있는 정책코드 — 키로도 policy_code 로도 찾을 수 있게 모은다. */
const pol = { ...((v3p?.val() || {}) as Record<string, Rec>), ...((v4p?.val() || {}) as Record<string, Rec>) };
const known = new Set<string>();
const polName = new Map<string, string>();
for (const [k, v] of Object.entries(pol)) {
  for (const c of [k, S(v?.policy_code)]) if (c) { known.add(c); polName.set(c, S(v?.policy_name)); }
}
const pt = { ...((v3t?.val() || {}) as Record<string, Rec>), ...((v4t?.val() || {}) as Record<string, Rec>) };
const ptName = new Map<string, string>();
for (const [k, v] of Object.entries(pt)) {
  const nm = S(v?.partner_name) || S(v?.company_name) || S(v?.name);
  for (const c of [k, S(v?.partner_code), S(v?.company_code)]) if (c) ptName.set(c, nm);
}

console.log(`■ 공급사 × 상품구분 → 정책 ${APPLY ? '(반영)' : '(dry-run)'}\n`);

const tree = new Map<string, Map<string, Map<string, number>>>();
const fills: { key: string; plate: string; code: string; to: string }[] = [];
const orphan = new Map<string, number>();   // 코드는 있는데 정책 레코드가 없는 것

for (const [key, raw] of Object.entries((pSnap.val() || {}) as Record<string, Rec>)) {
  const p = raw as Rec;
  if (!p || typeof p !== 'object' || p._deleted === true || p.deletedAt) continue;
  const code = S(p.provider_company_code) || S(p.partner_code) || '(공급사없음)';
  if (ONLY.size && !ONLY.has(code)) continue;
  const type = S(p.product_type) || '(구분없음)';
  const pc = S(p.policy_code);

  const a = tree.get(code) || new Map(); tree.set(code, a);
  const b = a.get(type) || new Map(); a.set(type, b);
  const label = pc || '(빈칸)';
  b.set(label, (b.get(label) || 0) + 1);

  if (pc && !known.has(pc)) orphan.set(pc, (orphan.get(pc) || 0) + 1);
  if (!pc) {
    const to = policyByRule(code, type);
    if (to) fills.push({ key, plate: S(p.car_number) || key, code, to });
  }
}

for (const [code, types] of [...tree].sort()) {
  const total = [...types.values()].reduce((n, m) => n + [...m.values()].reduce((x, y) => x + y, 0), 0);
  const hasRule = SUPPLIER_POLICY_RULES[code] ? ' ★규칙 있음' : '';
  console.log(`■ ${code}  ${ptName.get(code) || ''}   총 ${total}대${hasRule}`);
  for (const [type, codes] of [...types].sort()) {
    const entries = [...codes].sort((a, b) => b[1] - a[1]);
    const rule = policyByRule(code, type);
    console.log(`   [${type}]${rule ? `  규칙 → ${rule}` : ''}`);
    for (const [k, n] of entries) {
      const note = k === '(빈칸)' ? (rule ? '→ 규칙이 채운다' : '→ ✗ 규칙 없음(사람이 정해야 한다)')
        : known.has(k) ? polName.get(k) || '' : '→ ✗ 그 정책 레코드가 없다';
      console.log(`      ${String(n).padStart(4)}  ${k.padEnd(20)} ${note}`);
    }
  }
  console.log('');
}

if (orphan.size) {
  console.log('⚠ 코드는 적혀 있는데 «그 정책 레코드가 없는» 차 — 손님 화면에서는 빈칸과 똑같다');
  for (const [k, n] of [...orphan].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`);
  console.log('   정책을 만들거나, 있는 코드로 고쳐야 한다. 규칙표로는 못 고친다.\n');
}

console.log(`■ 규칙이 채울 빈칸 ${fills.length}대`);
const byTo = new Map<string, number>();
for (const f of fills) byTo.set(`${f.code} → ${f.to}`, (byTo.get(`${f.code} → ${f.to}`) || 0) + 1);
for (const [k, n] of byTo) console.log(`   ${String(n).padStart(4)}  ${k}`);

if (!APPLY) { console.log('\n(dry-run — 반영하려면 --apply)'); process.exit(0); }
if (!fills.length) { console.log('\n채울 것이 없다.'); process.exit(0); }

/**
 * 한 번에 몰아 쓴다. 빈칸만 쓰므로 서로 덮을 일이 없다.
 * ★`policy_source: 'rule'` 을 같이 남긴다 — **이 값이 «규칙이 채운 것»임을 나중에 알아야 한다.**
 *   사람이 적은 값과 규칙이 채운 값이 섞이면, 규칙을 고쳐야 할 때 무엇을 고쳐도 되는지 모른다.
 *   되돌릴 때도 이 표식만 보고 정확히 골라낼 수 있다.
 * ⚠ `updatedAt` 은 건드리지 않는다 — 시트에서 새로 들어온 것처럼 보이면 관제탑이 거짓말을 한다.
 */
const updates: Record<string, string> = {};
for (const f of fills) {
  updates[`v4/products/${f.key}/policy_code`] = f.to;
  updates[`v4/products/${f.key}/policy_source`] = 'rule';
}
await db.ref().update(updates);
console.log(`\n✓ ${fills.length}대에 정책을 채웠다(빈칸만 · policy_source=rule 표식).`);
process.exit(0);
