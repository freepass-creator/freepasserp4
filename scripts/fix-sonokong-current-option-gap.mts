/** 현재 손오공 원천의 옵션/유료옵션이 모두 빈데 옛 기본장비가 options에 남은 1대를 교정한다. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
type Rec = Record<string, unknown>;
const APPLY = process.argv.includes('--apply');
const PLATE = '349더2317';
const S = (v: unknown) => String(v ?? '').trim();
const source = (JSON.parse(readFileSync('sonokong/lib/wonja/손오공차량.json', 'utf8')) as { 차량?: Rec[] }).차량 || [];
const row = source.find((v) => S(v.차량번호 || v.차번) === PLATE);
if (!row || S(row.유료옵션) || S(row.옵션)) throw new Error(`${PLATE}: 현재 원천 옵션/유료옵션이 모두 빈 상태가 아니라 중단`);
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore(), ref = fs.collection('products').doc(PLATE), snap = await ref.get();
if (!snap.exists) throw new Error(`원자 없음: ${PLATE}`);
const before = snap.data() as Rec, oldOptions = S(before.options);
if (S(before.provider_company_code) !== 'RP012' || oldOptions.split(/[,\n]/).filter(Boolean).length < 20) throw new Error(`교정 패턴 불일치: ${PLATE}`);
console.log(`${PLATE}: 원천 유료옵션 빈칸 · 원자 기본장비 ${oldOptions.split(/[,\n]/).length}개 → options 빈칸`);
if (!APPLY) { console.log('[드라이런] --apply 로 반영'); process.exit(0); }
mkdirSync('tmp', { recursive: true });
const backupPath = `tmp/sonokong-current-option-gap-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backupPath, JSON.stringify({ captured_at: new Date().toISOString(), document: before }, null, 2));
await fs.runTransaction(async (tx) => {
  const current = (await tx.get(ref)).data() as Rec;
  if (S(current.options) !== oldOptions) throw new Error('쓰기 직전 값 변경 감지');
  const raw = { ...((current.원문 && typeof current.원문 === 'object') ? current.원문 as Rec : {}) };
  raw.옵션 = S(raw.옵션) || oldOptions;
  delete raw.유료옵션;
  tx.set(ref, { options: '', standard_equipment: S(current.standard_equipment) || oldOptions, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  tx.update(ref, { 원문: raw });
});
const after = (await ref.get()).data() as Rec;
if (S(after.options) || S(after.standard_equipment) !== oldOptions || !S((after.원문 as Rec)?.옵션)) throw new Error('반영 후 재검증 실패');
console.log(`✓ ${PLATE} 재검증 · 백업 ${backupPath}`);
