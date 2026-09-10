/** T카 상세 화면의 jsonData.paidOptList를 ERP 원자의 선택옵션에 정확히 반영한다. 기본 드라이런. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

type Rec = Record<string, unknown>;
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const source = (JSON.parse(readFileSync('sonokong/lib/wonja/손오공차량.json', 'utf8')) as { 차량?: Rec[] }).차량 || [];
const targets = source.filter((row) => S(row.버킷) === 'TCAR_EXTERNAL'
  && S(row.유료옵션출처) === 'tcar:jsonData.paidOptList'
  && Array.isArray(row.유료옵션원문));
if (!targets.length || targets.length > 300) throw new Error(`대상 수 비정상: ${targets.length}`);
if (new Set(targets.map((row) => S(row.차번))).size !== targets.length) throw new Error('T카 차번 중복');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();
const before: Array<{ plate: string; document: Rec; source: Rec }> = [];
for (const row of targets) {
  const plate = S(row.차번);
  const snap = await fs.collection('products').doc(plate).get();
  if (!snap.exists) throw new Error(`원자 없음: ${plate}`);
  const document = snap.data() as Rec;
  if (S(document.provider_company_code) !== 'RP012') throw new Error(`공급사 불일치: ${plate}`);
  before.push({ plate, document, source: row });
}
const changes = before.filter(({ document, source: row }) => S(document.options) !== S(row.유료옵션));
console.log(`T카 직접 선택옵션 확인 ${targets.length}대 · 옵션 있음 ${targets.filter((row) => S(row.유료옵션)).length}대 · 원자 변경 ${changes.length}대`);
for (const x of changes) console.log(`${x.plate}: ${S(x.document.options) || '(빈칸)'} → ${S(x.source.유료옵션) || '(빈칸)'}`);
if (!APPLY) { console.log('[드라이런] --apply 로 options와 원문, updated_at만 반영'); process.exit(0); }

mkdirSync('tmp', { recursive: true });
const backupPath = `tmp/tcar-direct-paid-option-fix-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backupPath, JSON.stringify({ captured_at: new Date().toISOString(), records: changes }, null, 2));
for (const { plate, document, source: row } of changes) {
  const ref = fs.collection('products').doc(plate);
  await fs.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as Rec;
    if (S(current.options) !== S(document.options)) throw new Error(`쓰기 직전 값 변경: ${plate}`);
    tx.update(ref, { options: S(row.유료옵션), 원문: row, updated_at: FieldValue.serverTimestamp() });
  });
}
for (const { plate, source: row } of changes) {
  const after = (await fs.collection('products').doc(plate).get()).data() as Rec;
  const raw = after.원문 as Rec;
  if (S(after.options) !== S(row.유료옵션)
    || S(raw?.유료옵션) !== S(row.유료옵션)
    || S(raw?.유료옵션출처) !== 'tcar:jsonData.paidOptList'
    || !Array.isArray(raw?.유료옵션원문)) throw new Error(`반영 후 재검증 실패: ${plate}`);
}
console.log(`✓ ${changes.length}대 재검증 · 백업 ${backupPath}`);
