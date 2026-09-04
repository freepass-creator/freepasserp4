/**
 * 정제 신원 → RTDB 보강 — Firestore 원자의 «세부모델·세부트림·제조사·모델·원산지»를 RTDB v4/products 에 되씀.
 *   ERP 가 아직 RTDB 를 읽어서(마이그레이션 전), 정제된 트림(모던 등)·교정된 세부모델(K8 GL3→더 뉴 K8)이
 *   화면에 바로 뜨게 한다. 값이 «다를 때만」 쓴다. 사장님 2026-09-03 「정제 트림 RTDB 보강」.
 * ★신원 5필드만 건드린다 — 가격·상태·기타 안 건드림. 기본 dry-run · --apply.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const NK = (c: unknown) => S(c).replace(/\s/g, '');
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const rtdb = getDatabase(app), fs = getFirestore(app);
const FIELDS = ['maker', 'model', 'sub_model', 'trim_name', 'origin'];

const fdocs = (await fs.collection('products').get()).docs.map((d) => d.data());
const refByCar = new Map<string, any>();
for (const d of fdocs) { if (d['확정'] === true && NK(d.car_number)) refByCar.set(NK(d.car_number), d); }  // 확정된 것만 되씀
const prod = (await rtdb.ref('v4/products').get()).val() as Record<string, any> || {};

const updates: Record<string, any> = {}; const samples: string[] = [];
let n = 0, trimN = 0, subN = 0;
for (const [key, v] of Object.entries(prod)) {
  if (!v || typeof v !== 'object' || (v as any)._deleted) continue;
  const ref = refByCar.get(NK((v as any).car_number)); if (!ref) continue;
  const diff: Record<string, any> = {};
  for (const f of FIELDS) { const a = S((v as any)[f]), b = S(ref[f]); if (b && a !== b) diff[f] = b; }
  if (!Object.keys(diff).length) continue;
  if (diff.trim_name !== undefined) trimN++;
  if (diff.sub_model !== undefined) subN++;
  for (const [f, val] of Object.entries(diff)) updates[`${key}/${f}`] = val;
  n++;
  if (samples.length < 8) samples.push(`${S((v as any).car_number)}: ${Object.entries(diff).map(([f, val]) => `${f}「${S((v as any)[f]) || '빈'}」→「${val}」`).join(' · ')}`);
}
console.log(`RTDB 신원 보강 대상 ${n}대 (트림 ${trimN} · 세부모델 ${subN})`);
console.log('표본:'); samples.forEach((x) => console.log('  ' + x));
if (!APPLY) { console.log(`\n미리보기 — 값 다른 신원필드만 씀. 실제: --apply`); process.exit(0); }
const keys = Object.keys(updates);
for (let i = 0; i < keys.length; i += 2000) { const chunk: Record<string, any> = {}; for (const k of keys.slice(i, i + 2000)) chunk[k] = updates[k]; await rtdb.ref('v4/products').update(chunk); }
console.log(`\n반영 완료 — RTDB v4/products 신원필드 ${keys.length}개 갱신(${n}대).`);
process.exit(0);
