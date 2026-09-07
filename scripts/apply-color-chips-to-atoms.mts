/**
 * 상품 원자에 «색칩 코드»를 박는다 — 사장님 2026-09-05 「색상 칩 데이터를 원자에 반영, 코드 같이 쓰게」.
 *   ext_color/int_color(이름) → color-chips SSOT 로 hex 계산 → ext_color_code/int_color_code 저장.
 *   그래서 B2C·카드·화이트라벨 어디서 원자를 당겨가도 색 견본을 바로 그린다.
 * 기본 드라이런 · --apply 로 Firestore products 쓰기. 원본 이름칸(ext_color)은 안 건드린다.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { colorCode } from '../lib/domain/color-chips';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const fs = getFirestore();

const snap = await fs.collection('products').get();
const edits: { id: string; patch: Record<string, string> }[] = [];
let extN = 0, intN = 0, noChip = 0;
for (const d of snap.docs) {
  const x = d.data() as Record<string, unknown>;
  const ec = colorCode(x.ext_color);
  const ic = colorCode(x.int_color);
  const patch: Record<string, string> = {};
  if (ec && ec !== S(x.ext_color_code)) { patch.ext_color_code = ec; extN++; }
  if (ic && ic !== S(x.int_color_code)) { patch.int_color_code = ic; intN++; }
  if (!ec && S(x.ext_color) && S(x.ext_color) !== '-' && S(x.ext_color) !== '기타') noChip++;
  if (Object.keys(patch).length) edits.push({ id: d.id, patch });
}
console.log(`상품 ${snap.size}대 · 외장코드 채울 것 ${extN} · 내장코드 채울 것 ${intN} · 칩없는 색이름(기타/- 제외) ${noChip}`);
console.log(`쓸 문서 ${edits.length}건 · 예: ${edits.slice(0, 4).map((e) => `${e.id} ${JSON.stringify(e.patch)}`).join(' · ')}`);

if (!APPLY) { console.log('\n[드라이런] --apply 로 반영.'); process.exit(0); }
let done = 0;
for (let i = 0; i < edits.length; i += 400) {
  const batch = fs.batch();
  for (const e of edits.slice(i, i + 400)) batch.set(fs.collection('products').doc(e.id), e.patch, { merge: true });
  await batch.commit();
  done += Math.min(400, edits.length - i);
}
console.log(`✓ 색칩 코드 반영 ${done}건`);
process.exit(0);
