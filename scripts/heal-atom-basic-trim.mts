/**
 * 공란 세부트림 재투영 — 원문이 «기본형»이라 말하는데 마스터에 «기본형»이 없어 비어 있던 원자를 채운다.
 * (heal-master-basic-trim 로 마스터를 «기본형»으로 통일한 «뒤에» 돈다. 사장님 2026-09-11 엔카 기준.)
 *
 * ★규칙 = «복사»만. 지어내지 않는다.
 *   조건 셋을 «모두» 만족할 때만 trim_name = «기본형»:
 *     ① 지금 trim_name 이 공란(=cleanTrim 이 엣지트림을 못 맞춤)
 *     ② 그 세부모델 마스터에 «기본형»이 «있다»(=엔카가 기본형을 정의한 모델)
 *     ③ 원문 차명이 «기본형» 또는 «세부등급 없음»을 «명시»한다(원천의 적극 근거)
 *   ③이 없으면(맨 모델명·스펙만·옵션패키지만) → «미입력» 유지하고 «보고»만 — 진짜 갭을 기본형으로 덮지 않는다.
 *
 * 기본 = 미리보기. --apply 로만 쓴다.
 * 실행: FIREBASE_SERVICE_ACCOUNT_JSON=tmp/firebase-auth/freepasserp5-sa.json \
 *        npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/heal-atom-basic-trim.mts [--apply]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { makerGroup } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as unknown;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : (masterRaw as { entries?: MasterEntry[] }).entries) || []) as MasterEntry[];
const TRIMS = new Map<string, string[]>();
for (const e of MASTER) { if (!e.trims?.length) continue; for (const a of makerGroup(N(e.maker))) TRIMS.set(`${a}|${N(e.model)}|${N(e.sub_model)}`, e.trims); }
const trimsFor = (mk: unknown, mo: unknown, sm: unknown) => { for (const a of makerGroup(N(mk))) { const t = TRIMS.get(`${a}|${N(mo)}|${N(sm)}`); if (t) return t; } return [] as string[]; };

const keyPath = S(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) || 'tmp/firebase-auth/freepasserp5-sa.json';
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const db = getFirestore();

const snap = await db.collection('products').get();
const BASIC = '기본형';
const saysBasic = (cha: string) => { const n = N(cha); return n.includes(N(BASIC)) || n.includes(N('세부등급 없음')) || n.includes('세부등급없음'); };

const fix: { id: string; car: string; sub: string; cha: string }[] = [];
const gapNoEvidence = new Map<string, string[]>();   // ② 만족하나 ③ 근거 없음 → 미입력 유지, 보고
let listableBlank = 0;

for (const doc of snap.docs) {
  const v = doc.data() as Record<string, unknown>;
  if (!v.listable) continue;
  if (S(v.trim_name)) continue;             // ① 공란만
  listableBlank++;
  const trims = trimsFor(v.maker, v.model, v.sub_model).map(S);
  if (!trims.some((t) => N(t) === N(BASIC))) continue;   // ② 마스터에 기본형 있는 모델만
  const cha = S((v.원문 as { 차명?: string })?.차명);
  if (saysBasic(cha)) fix.push({ id: doc.id, car: S(v.car_number), sub: S(v.sub_model), cha });
  else { const k = `${S(v.maker)} ${S(v.sub_model)}`; (gapNoEvidence.get(k) || gapNoEvidence.set(k, []).get(k)!).push(`${S(v.car_number)}「${cha.slice(0, 34)}」`); }
}

console.log(`listable 공란 트림 ${listableBlank} · «기본형» 복사 대상 ${fix.length} · 근거없어 미입력 유지 ${[...gapNoEvidence.values()].reduce((a, b) => a + b.length, 0)}\n`);
const bySub = new Map<string, number>();
for (const f of fix) bySub.set(f.sub, (bySub.get(f.sub) || 0) + 1);
console.log('── «기본형» 채울 세부모델 ──');
for (const [k, n] of [...bySub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${k} ×${n}`);
console.log('\n── 근거없어 «미입력» 유지(맨모델명·스펙·옵션만 · 사람검수) ──');
for (const [k, cars] of [...gapNoEvidence.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15)) console.log(`  ${k} ×${cars.length}: ${cars.slice(0, 3).join(' · ')}`);

if (!APPLY) { console.log('\n미리보기 — 안 씀. --apply 로 반영.'); process.exit(0); }

let w = 0;
for (let i = 0; i < fix.length; i += 400) {
  const batch = db.batch();
  for (const f of fix.slice(i, i + 400)) { batch.set(db.collection('products').doc(f.id), { trim_name: BASIC, _basic_trim_healed_at: Date.now() }, { merge: true }); w++; }
  await batch.commit();
}
console.log(`\n반영 완료 — 원자 ${w}건 세부트림 «기본형» 복사(원문 근거·마스터 보유). 근거없는 갭은 미입력 유지.`);
process.exit(0);
