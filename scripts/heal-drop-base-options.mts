/**
 * `기본옵션` 필드를 원자에서 걷어낸다 — 사장님 2026-09-10 「기본옵션은 우린 안 쓸 거야」.
 *   옵션 = 선택옵션(유료옵션)만. 잠깐 담았던 기본옵션(options 배열)을 지운다.
 *
 *   npx tsx scripts/heal-drop-base-options.mts            드라이런
 *   npx tsx scripts/heal-drop-base-options.mts --apply    반영
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

const docs = (await fs.collection('products').get()).docs;
const hit = docs.filter((d) => '기본옵션' in (d.data() as Record<string, unknown>));
console.log(`기본옵션 남은 원자 ${hit.length}대`);
if (!hit.length) { console.log('✓ 이미 다 없음.'); process.exit(0); }
if (!APPLY) { console.log('\n미리보기 — 반영하려면 --apply'); process.exit(0); }
let w = 0;
for (let i = 0; i < hit.length; i += 400) {
  const batch = fs.batch();
  for (const d of hit.slice(i, i + 400)) { batch.update(d.ref, { 기본옵션: FieldValue.delete() }); w++; }
  await batch.commit();
}
console.log(`\n반영 완료 — ${w}대에서 기본옵션 을 지웠다.`);
process.exit(0);
