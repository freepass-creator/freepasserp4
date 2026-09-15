/** ERP5 products.policy_code를 현재 policy 정본에 맞춘다. 기본은 DRY RUN, --apply만 쓴다. */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { groupPoliciesByProvider, reconcilePolicyReference } from '../lib/domain/supplier-policy-link';
import { erp5InventoryAppOptions } from '../lib/server/erp5-inventory-service-account';

const S = (value: unknown) => String(value ?? '').trim();
const APPLY = process.argv.includes('--apply');
const ERP5 = process.argv.includes('--erp5');
if (ERP5) initializeApp(erp5InventoryAppOptions());
else {
  const path = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
  const sa = JSON.parse(readFileSync(path, 'utf8'));
  initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
}
const db = getFirestore();
const [productSnap, policySnap] = await Promise.all([db.collection('products').get(), db.collection('policy').get()]);
const policies = policySnap.docs.map((doc) => ({ _key: doc.id, ...doc.data() }));
const byProvider = groupPoliciesByProvider(policies);
const changes = productSnap.docs.flatMap((doc) => {
  const data = doc.data();
  if (data._deleted === true || S(data.status) === 'deleted') return [];
  const resolved = reconcilePolicyReference(data, byProvider);
  const before = S(data.policy_code);
  return before === resolved.code ? [] : [{ doc, data, before, ...resolved }];
});
const counts = changes.reduce<Record<string, number>>((out, row) => ({ ...out, [row.state]: (out[row.state] || 0) + 1 }), {});
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', products: productSnap.size, policies: policySnap.size, changes: changes.length, counts }, null, 2));
for (const row of changes.slice(0, 20)) console.log(`${row.doc.id} ${row.before || '(blank)'} -> ${row.code || '(미입력)'} [${row.state}]`);
if (!APPLY) process.exit(0);

for (let offset = 0; offset < changes.length; offset += 350) {
  const batch = db.batch();
  for (const row of changes.slice(offset, offset + 350)) {
    const audit = {
      policy_code: row.code,
      policy_reference_state: row.code ? row.state : 'missing',
      policy_reference_checked_at: FieldValue.serverTimestamp(),
      ...(row.before ? { policy_code_source_original: S(row.data.policy_code_source_original) || row.before } : {}),
    };
    batch.set(row.doc.ref, audit, { merge: true });
  }
  await batch.commit();
}

const reread = await db.collection('products').get();
const dangling = reread.docs.filter((doc) => {
  if (doc.data()._deleted === true || S(doc.data().status) === 'deleted') return false;
  const result = reconcilePolicyReference(doc.data(), byProvider);
  return S(doc.data().policy_code) && result.state !== 'valid';
});
if (dangling.length) throw new Error(`정책 참조 재검증 실패: ${dangling.length}건`);
console.log(`✓ 정책 참조 반영 ${changes.length}건 · 재검증 dangling 0건`);
