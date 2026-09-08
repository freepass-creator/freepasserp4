/**
 * **RTDB 원자에서 채운 값을 Firestore 의 «빈 칸»에만 건넨다.** 기본 dry-run · `--apply`.
 *
 * ★왜(사장님 2026-09-08 「넣을 때마다 시트에서 빠진다」 · 「빠진 거 채워 넣어봐」)
 *   ⑬½ 치유는 v4/products(RTDB)만 채운다. 그런데 손오공·오플·미러4곳은 2026-09-04 부터
 *   **직접수집이 Firestore 의 주인**이라 ⑭ 미러가 그 차들을 건너뛴다(1,339건).
 *   그래서 치유한 구분·세부트림이 Firestore 로 못 건너가고, ⑯ 본시트 발행이 **낡은 값으로 시트를 덮어**
 *   채운 칸이 다시 빈다. 실측 2026-09-08 — 구분 ERP 4 vs Firestore 370 · 트림 66 vs 191.
 *
 * ★**빈 칸만 채운다.** 주인(직접수집)이 적어 둔 값은 «절대» 안 덮는다 — 이 다리는 «구멍만» 메운다.
 * ⚠ 상태·요금은 안 건넨다. 그건 매시간 연동·가격블록이 소유한다.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\n/g, '\n') }),
  databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const rtdb = getDatabase(app); const fs = getFirestore(app);

/** 건네는 칸 — «그 차가 무엇인가»를 말하는 불변 축만. */
const FIELDS = ['product_type', 'trim_name', 'sub_model', 'model', 'maker', 'ext_color', 'int_color', 'fuel_type', 'displacement', 'drive_type', 'seats', 'vehicle_class'] as const;
const docId = (car: string) => S(car).replace(/\s/g, '').replace(/[/#.$[\]]/g, '_');

const v4 = (await rtdb.ref('v4/products').get()).val() as Record<string, any> || {};
const byPlate = new Map<string, any>();
for (const v of Object.values(v4)) {
  if (!v || typeof v !== 'object') continue;
  if (/삭제|폐기/.test(S(v.record_status))) continue;
  const id = docId(S(v.car_number)); if (id) byPlate.set(id, v);
}
const snap = await fs.collection('products').get();
const plan: { id: string; patch: Record<string, string>; }[] = [];
const stat: Record<string, number> = {};
for (const d of snap.docs) {
  const cur = d.data() as Record<string, any>;
  const src = byPlate.get(d.id); if (!src) continue;
  const patch: Record<string, string> = {};
  for (const f of FIELDS) {
    if (S(cur[f])) continue;              // 주인이 적은 값은 안 덮는다
    const v = S(src[f]); if (!v) continue;
    patch[f] = v; stat[f] = (stat[f] || 0) + 1;
  }
  if (Object.keys(patch).length) plan.push({ id: d.id, patch });
}
console.log(`Firestore ${snap.size}건 · RTDB ${byPlate.size}건 · 채울 문서 ${plan.length}`);
console.log(`  칸별: ${Object.entries(stat).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}`);
for (const p of plan.slice(0, 8)) console.log(`   ${p.id.padEnd(12)} ${Object.entries(p.patch).map(([k, v]) => `${k}=${v}`).join(' · ').slice(0, 90)}`);
if (!APPLY) { console.log('\n※ dry-run — --apply 로 채운다.\n'); process.exit(0); }
let n = 0;
for (let i = 0; i < plan.length; i += 400) {
  const batch = fs.batch();
  for (const { id, patch } of plan.slice(i, i + 400)) { batch.set(fs.collection('products').doc(id), patch, { merge: true }); n++; }
  await batch.commit();
}
console.log(`\n반영 완료 — ${n}건 채웠다(빈 칸만).`);
process.exit(0);
