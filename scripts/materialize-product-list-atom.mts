/**
 * 상품리스트용 원자 «materialize» — raw 원자(products·policy·partner·overrides)를 규격(spec/product_list_columns)대로
 *   «한 줄 한 줄» 정제해 Firestore `product_list_atom` 에 박는다. 시트·ERP·손님은 이 컬렉션을 «고스란히» 읽는다.
 *
 * ★사장님 2026-09-08 — 「한 줄 한 줄 뽑아 시트랑 ERP에 고스란히 넣는다 그래야 안 틀린다」·「파이어스토어에 박으면서 해 틀려지지 않게」.
 *   ⇒ product_list_atom 이 «단일 원천». 시트/ERP가 각자 세지 않고 이걸 읽어야 갈리지 않는다.
 *   규격(spec)이나 raw 원자가 바뀌면 이 잡만 다시 돌린다.
 *
 *   npx tsx scripts/materialize-product-list-atom.mts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildProductListRow } from '../lib/domain/product-list-atom';
import { companyAlias } from '../lib/domain/identity';

const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const db = getFirestore();

// 회사명(짧은 이름) — 코드는 보조. companyAlias 로 주식회사·(주)·렌터카 제거.
const names = new Map<string, string>();
for (const d of (await db.collection('partner').get()).docs) {
  const x = d.data() as Record<string, unknown>;
  const c = S(x.partner_code) || S(x.provider_company_code) || d.id;
  const nm = companyAlias(S(x.partner_name) || S(x.name));
  if (c && nm) names.set(c, nm);
}
// 할증·연령 오버라이드(사장님 확인값 = 최우선).
const ovRaw = JSON.parse(readFileSync('public/data/supplier-policy-overrides.json', 'utf8')) as Record<string, Record<string, string>>;
const ovMap = new Map<string, Record<string, string>>();
for (const [k, v] of Object.entries(ovRaw)) if (!k.startsWith('_')) ovMap.set(k, v);
// 정책(policy_code 조인).
const pol = new Map<string, Record<string, unknown>>();
(await db.collection('policy').get()).docs.forEach((d) => pol.set(S((d.data() as Record<string, unknown>).policy_code || d.id), d.data() as Record<string, unknown>));

const prods = (await db.collection('products').get()).docs.map((d) => ({ id: d.id, x: d.data() as Record<string, unknown> }));
let n = 0, batch = db.batch(), inB = 0, listable = 0;
for (const { id, x } of prods) {
  const row = buildProductListRow(x, pol, names, ovMap);
  const isList = x.listable !== false && !/출고불가/.test(S(x.vehicle_status));
  if (isList) listable++;
  batch.set(db.collection('product_list_atom').doc(id), { car_number: S(x.car_number), listable: isList, row, _from: 'spec/product_list_columns', _built_at: new Date().toISOString() });
  inB++; n++;
  if (inB >= 400) { await batch.commit(); batch = db.batch(); inB = 0; process.stdout.write('.'); }
}
if (inB > 0) await batch.commit();
console.log(`\n■ product_list_atom ${n}개 materialize — listable ${listable} · 회사명 ${names.size} · 오버라이드 ${ovMap.size} · 정책 ${pol.size}`);
console.log('  시트·ERP·손님은 이 컬렉션을 «고스란히» 읽는다. 규격/원자 바뀌면 이 잡만 다시 돌린다.');
