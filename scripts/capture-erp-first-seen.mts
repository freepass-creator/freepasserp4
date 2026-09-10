import './lib/disabled-rtdb.mts';

/**
 * **RTDB 에만 있는 «처음 본 날»을 원자로 한 번 옮겨 담는다.** 기본 미리보기 · 반영은 `--apply`.
 *
 * > 사장님 2026-09-10 「**RTDB 를 왜 못 지우는지**」
 *
 * ★**왜 이게 필요한가** — 회차가 RTDB 를 읽는 곳은 대부분 «ERP 와 대조하려고»라 앱 이관 전엔 못 끊는다.
 *   그런데 「입고일자」(`fill-intake-date`)는 다르다. 거기서 RTDB 를 읽는 까닭은 **대조가 아니라 «역사»**다 —
 *   그 차번이 우리 쪽에 «처음 올라온 날»이 옛 ERP 이관분(4~7월)까지 RTDB 에만 남아 있다.
 *   역사는 **한 번 옮겨 담으면 끝난다.** 그러면 그 스크립트는 RTDB 를 안 봐도 된다.
 *
 * ★**덮지 않는다.** 이미 원자에 값이 있으면 손대지 않는다 — 역사는 나중에 «생기는» 것이 아니다.
 * ★**지어내지 않는다.** RTDB 에 `createdAt` 이 없는 차는 그냥 넘어간다(빈칸 = 모른다).
 * ★차번이 여러 문서에 있으면 **가장 이른 날**을 쓴다(옛 ERP 는 같은 차가 여러 줄인 적이 있다).
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/capture-erp-first-seen.mts [--apply]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const P = (v: unknown) => S(v).replace(/\s/g, '');
const APPLY = process.argv.includes('--apply');
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
const app = initializeApp({
  credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }),
  databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
});
const fs = getFirestore(app);

/** KST 날짜(YYYY-MM-DD) — 「처음 본 날」은 시각이 아니라 날이다. */
const kstDate = (ms: number) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

const prods = ((await getDatabase(app).ref('v4/products').get()).val() || {}) as Record<string, Record<string, unknown>>;
const 처음본날 = new Map<string, string>();
for (const p of Object.values(prods)) {
  const plate = P(p.car_number || p.car_number_snapshot || ''); if (!plate) continue;
  const c = p.createdAt ?? p.created_at; if (c == null) continue;
  const ms = typeof c === 'number' ? c : Date.parse(String(c));
  if (!Number.isFinite(ms)) continue;
  const d = kstDate(ms);
  const prev = 처음본날.get(plate);
  if (!prev || d < prev) 처음본날.set(plate, d);
}
console.log(`\n■ RTDB 에서 읽은 «처음 본 날» — 차번 ${처음본날.size}개 (RTDB 문서 ${Object.keys(prods).length})`);

const docs = (await fs.collection('products').get()).docs;
type Fix = { ref: FirebaseFirestore.DocumentReference; car: string; day: string };
const 채울것: Fix[] = [];
let 이미있음 = 0, 근거없음 = 0;
for (const d of docs) {
  const v = d.data() as Record<string, unknown>;
  if (S(v.erp_first_seen_date)) { 이미있음++; continue; }        // 역사는 덮지 않는다
  const day = 처음본날.get(P(v.car_number));
  if (!day) { 근거없음++; continue; }                             // 지어내지 않는다
  채울것.push({ ref: d.ref, car: S(v.car_number), day });
}
console.log(`  원자 ${docs.length}대 — 이미 있음 ${이미있음} · 채울 것 ${채울것.length} · RTDB 에도 근거 없음 ${근거없음}`);
const 해별 = new Map<string, number>();
for (const x of 채울것) 해별.set(x.day.slice(0, 7), (해별.get(x.day.slice(0, 7)) || 0) + 1);
console.log(`  달별 — ${[...해별].sort().map(([m, n]) => `${m} ${n}`).join(' · ')}`);
for (const x of 채울것.slice(0, 5)) console.log(`     ${x.car.padEnd(11)} ${x.day}`);

if (!APPLY) { console.log(`\n미리보기 — 쓰려면 --apply\n`); process.exit(0); }
if (!채울것.length) { console.log(`\n✓ 옮겨 담을 것 없음 — 이미 다 원자에 있다\n`); process.exit(0); }
let n = 0;
for (let i = 0; i < 채울것.length; i += 400) {
  const batch = fs.batch();
  for (const x of 채울것.slice(i, i + 400)) { batch.set(x.ref, { erp_first_seen_date: x.day }, { merge: true }); n++; }
  await batch.commit();
}
console.log(`\n✓ 원자 ${n}대에 «처음 본 날»을 옮겨 담았다 — 이제 입고일자는 RTDB 를 안 봐도 된다\n`);
process.exit(0);
