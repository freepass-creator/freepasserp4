/** Reborn carOption 기본장비가 선택옵션에 들어간 오토플러스 14대를 교정한다. 기본 드라이런. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

type Rec = Record<string, unknown>;
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const PLATES = ['35서5793', '169루1079', '390버9300', '241마8124', '317누8253', '176서2754', '282나2079', '146오7914', '07어4389', '133라1401', '138모8017', '192머7372', '25구1926', '311저1956'];
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();
const sourceRows = JSON.parse(readFileSync('tmp/reborncar-cars.json', 'utf8')) as Rec[];
const source = new Map(sourceRows.map((v) => [S(v.car_number), S(v.standard_equipment)]));
const refs = PLATES.map((plate) => fs.collection('products').doc(plate));
const snaps = await Promise.all(refs.map((ref) => ref.get()));
const before = new Map<string, Rec>();

for (const snap of snaps) {
  if (!snap.exists) throw new Error(`대상 원자 없음: ${snap.id}`);
  const v = snap.data() as Rec, current = S(v.options), src = source.get(snap.id) || '';
  if (S(v.provider_company_code) !== 'RP023' || S(v.product_type) !== '오플구독') throw new Error(`대상 범위 불일치: ${snap.id}`);
  if (!src || current !== src || current.split(',').length < 50 || !/에어백/.test(current) || !/(ABS|잠김 방지)/i.test(current)) {
    throw new Error(`Reborn 기본장비와 정확히 같은 오염 패턴이 아니라 중단: ${snap.id}`);
  }
  if (S(v.standard_equipment) && S(v.standard_equipment) !== current) throw new Error(`기존 표준사양 충돌: ${snap.id}`);
  before.set(snap.id, v);
  console.log(`${snap.id}: 선택옵션 ${current.split(',').length}개 기본장비 목록 → 빈칸, standard_equipment로 보존`);
}
if (!APPLY) { console.log(`\n[드라이런] 정확히 ${PLATES.length}대만 교정. --apply 로 반영.`); process.exit(0); }

mkdirSync('tmp', { recursive: true });
const backupPath = `tmp/autoplus-option-fix-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backupPath, JSON.stringify({ captured_at: new Date().toISOString(), documents: Object.fromEntries(before) }, null, 2));
console.log(`원자 백업: ${backupPath}`);
await fs.runTransaction(async (tx) => {
  const fresh = await Promise.all(refs.map((ref) => tx.get(ref)));
  for (const snap of fresh) {
    const v = snap.data() as Rec, old = before.get(snap.id)!;
    if (S(v.options) !== S(old.options) || S(v.standard_equipment) !== S(old.standard_equipment)) throw new Error(`값 변경 감지: ${snap.id}`);
    const raw = { ...((v['원문'] && typeof v['원문'] === 'object') ? v['원문'] as Rec : {}) };
    raw['옵션'] = S(v.options);
    raw['reborncar_carOption'] = S(v.options);
    tx.set(snap.ref, { options: '', standard_equipment: S(v.options), updated_at: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(snap.ref, { '원문': raw });
  }
});
for (const snap of await Promise.all(refs.map((ref) => ref.get()))) {
  const v = snap.data() as Rec, raw = (v['원문'] || {}) as Rec, old = before.get(snap.id)!;
  if (S(v.options) || S(v.standard_equipment) !== S(old.options) || S(raw['옵션']) !== S(old.options) || S(raw['reborncar_carOption']) !== S(old.options)) {
    throw new Error(`반영 후 재검증 실패: ${snap.id}`);
  }
  console.log(`✓ ${snap.id} 재검증`);
}
