/**
 * 손오공 과거 픽업 원자 3대의 선택옵션을 F50 원문 증거대로 바로잡는다.
 *
 * 기본은 드라이런. --apply 때도 트랜잭션 안에서 직전 읽기와 같은지 재확인한다.
 * 기존 options 에 섞인 기본사양은 standard_equipment 와 원문.옵션에 보존한다.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

type Rec = Record<string, unknown>;
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const TARGETS: Record<string, string> = {
  '154어1404': '',
  '264도8211': '',
  '387누8807': '드라이브와이즈, 파노라마선루프',
};
const saPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();
const refs = Object.keys(TARGETS).map((plate) => fs.collection('products').doc(plate));
const snaps = await Promise.all(refs.map((ref) => ref.get()));
const before = new Map<string, Rec>();

for (const snap of snaps) {
  if (!snap.exists) throw new Error(`대상 원자 없음: ${snap.id}`);
  const v = snap.data() as Rec;
  if (S(v.provider_company_code) !== 'RP012' || S(v.product_type) !== '픽업구독') {
    throw new Error(`대상 범위 불일치: ${snap.id} provider=${S(v.provider_company_code)} type=${S(v.product_type)}`);
  }
  const current = S(v.options);
  const expected = TARGETS[snap.id];
  if (current === expected) throw new Error(`이미 목표값인 대상이 있어 중단: ${snap.id}`);
  if (current.split(/[,\n]/).map(S).filter(Boolean).length < 20) {
    throw new Error(`기본사양 혼입 패턴이 아닌 대상이라 중단: ${snap.id}`);
  }
  const existingStd = S(v.standard_equipment);
  if (existingStd && existingStd !== current) throw new Error(`기존 기본사양과 options가 달라 중단: ${snap.id}`);
  before.set(snap.id, v);
  console.log(`${snap.id} options ${current.length}자/${current.split(/[,\n]/).filter(Boolean).length}개 → ${expected || '(빈칸)'}`);
  console.log(`  현재 SHA256 ${createHash('sha256').update(current).digest('hex')}`);
}
if (!APPLY) {
  console.log('\n[드라이런] 정확히 위 3개 원자만 수정. --apply 로 반영.');
  process.exit(0);
}

mkdirSync('tmp', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `tmp/sonokong-option-fix-snapshot-${stamp}.json`;
writeFileSync(backupPath, JSON.stringify({ captured_at: new Date().toISOString(), targets: TARGETS, documents: Object.fromEntries(before) }, null, 2));
console.log(`원자 백업: ${backupPath}`);

await fs.runTransaction(async (tx) => {
  const fresh = await Promise.all(refs.map((ref) => tx.get(ref)));
  for (const snap of fresh) {
    const v = snap.data() as Rec;
    const old = before.get(snap.id)!;
    if (S(v.options) !== S(old.options) || S(v.standard_equipment) !== S(old.standard_equipment)) {
      throw new Error(`드라이런 이후 값 변경 감지: ${snap.id}`);
    }
    const raw = { ...((v['원문'] && typeof v['원문'] === 'object') ? v['원문'] as Rec : {}) };
    raw['옵션'] = S(v.options);
    const paid = TARGETS[snap.id];
    if (paid) raw['유료옵션'] = paid;
    else delete raw['유료옵션'];
    tx.set(snap.ref, {
      options: paid,
      standard_equipment: S(v.options),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.update(snap.ref, { '원문': raw });
  }
});

const verified = await Promise.all(refs.map((ref) => ref.get()));
for (const snap of verified) {
  const v = snap.data() as Rec;
  const raw = (v['원문'] || {}) as Rec;
  const paid = TARGETS[snap.id];
  if (S(v.options) !== paid || S(v.standard_equipment) !== S(before.get(snap.id)!.options)
    || S(raw['옵션']) !== S(before.get(snap.id)!.options) || S(raw['유료옵션']) !== paid) {
    throw new Error(`반영 후 재검증 실패: ${snap.id}`);
  }
  console.log(`✓ ${snap.id} 재검증 options=${paid || '(빈칸)'} · 원문/기본사양 보존`);
}
