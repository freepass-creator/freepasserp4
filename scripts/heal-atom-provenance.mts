/** 오래된 원자의 빠진 출처 표식만 보충한다. 차량 원문과 정제값은 건드리지 않는다. */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (value: unknown) => String(value ?? '').trim();
const APPLY = process.argv.includes('--apply');
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const db = getFirestore();

const docs = (await db.collection('products').get()).docs;
const patches: Array<{ ref: FirebaseFirestore.DocumentReference; car: string; patch: Record<string, unknown> }> = [];
const unresolved: string[] = [];
for (const doc of docs) {
  const atom = doc.data() as Record<string, unknown>;
  const provider = S(atom.provider_company_code) || S(atom.partner_code);
  const source = S(atom.source);
  const schema = S(atom.source_schema);
  if (!provider) {
    unresolved.push(S(atom.car_number) || doc.id);
    continue;
  }
  const patch: Record<string, unknown> = {};
  // 정확한 과거 운송경로를 지어내지 않는다. 공급사 원자였다는 경계와 공급사 코드만 기록한다.
  if (!source) patch.source = 'legacy_provider_atom';
  if (!schema) patch.source_schema = provider;
  if (Object.keys(patch).length) patches.push({ ref: doc.ref, car: S(atom.car_number) || doc.id, patch });
}

console.log(`\n원자 ${docs.length} · 출처 표식 보충 ${patches.length} · 공급사 식별 불가 ${unresolved.length}`);
for (const row of patches.slice(0, 12)) console.log(`  ${row.car} → ${S(row.patch.source) || '(기존 source)'} / ${S(row.patch.source_schema) || '(기존 schema)'}`);
if (unresolved.length) {
  console.error(`⛔ 공급사 코드가 없는 원자 ${unresolved.length}대 — ${unresolved.slice(0, 10).join(' · ')}`);
  process.exit(1);
}
if (!patches.length) { console.log('✓ 원천 표식이 이미 갖춰졌다.'); process.exit(0); }
if (!APPLY) { console.log('미리보기 — 쓰려면 --apply'); process.exit(0); }
let written = 0;
for (let i = 0; i < patches.length; i += 400) {
  const batch = db.batch();
  for (const row of patches.slice(i, i + 400)) {
    batch.set(row.ref, { ...row.patch, _provenance_healed_at: Date.now() }, { merge: true });
    written++;
  }
  await batch.commit();
}
console.log(`✓ 원자 ${written}대의 빠진 출처 표식만 보충했다.`);
