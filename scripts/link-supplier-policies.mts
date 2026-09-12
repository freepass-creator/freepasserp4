/**
 * 공급사 «입력 정책» → 매물 자동연결 «연동 스텝» (데이터 주도).
 *
 * ★사장님 2026-09-08 「모든 공급사 정책 입력시킬 거니까, 입력하면 연동 돌 때 들어갈 수 있게끔」.
 *   공급사가 정책탭에 정책을 넣으면, 이 스텝이 매물의 «빈» policy_code 를 그 공급사 정책으로 채운다.
 *   규칙은 `lib/domain/supplier-policy-link.ts` — 공급사코드 «매칭»으로만 하므로 코드를 갈아엎어도 산다.
 *
 *   npx tsx scripts/link-supplier-policies.mts           # dry-run: 무엇을 붙일지
 *   npx tsx scripts/link-supplier-policies.mts --apply    # 빈칸 매물에 policy_code 반영(merge)
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { planPolicyLinks, groupPoliciesByProvider } from '../lib/domain/supplier-policy-link';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const db = getFirestore();

const policies = (await db.collection('policy').get()).docs.map((d) => ({ _key: d.id, ...(d.data() as Record<string, unknown>) }));
const products = (await db.collection('products').get()).docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));

const byProv = groupPoliciesByProvider(policies);
console.log(`정책 ${policies.length} · 공급사별 정책 있는 곳 ${byProv.size} · 매물 ${products.length}`);
const single = [...byProv.entries()].filter(([, v]) => v.length === 1);
console.log(`  «정책 1개» 공급사 ${single.length}곳(자동연결 확실): ${single.slice(0, 8).map(([k, v]) => `${k}→${v[0].policy_name || v[0].policy_code}`).join(' · ')}`);

const plan = planPolicyLinks(products, policies);
// 공급사별 붙일 수
const byNm: Record<string, number> = {};
for (const p of plan) { const k = `${p.policy_name || p.policy_code}`; byNm[k] = (byNm[k] || 0) + 1; }
console.log(`\n빈칸 매물에 «자동으로 붙일» 건수: ${plan.length}`);
for (const [k, n] of Object.entries(byNm).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

if (!APPLY) { console.log('\n미리보기(dry-run). 반영 = --apply (빈칸만 merge, 적힌 값 안 덮음).'); process.exit(0); }
let batch = db.batch(), inB = 0, n = 0;
for (const p of plan) { batch.set(db.collection('products').doc(p.id), { policy_code: p.policy_code }, { merge: true }); inB++; n++; if (inB >= 400) { await batch.commit(); batch = db.batch(); inB = 0; } }
if (inB > 0) await batch.commit();
console.log(`\n■ ${n}대 policy_code 자동연결(빈칸만). 이어서 materialize-product-list-atom 로 원자 재생성.`);
