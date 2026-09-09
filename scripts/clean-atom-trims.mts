/**
 * 원자 잔결 정리 — 트림을 «차종마스터 규격»으로 (사장님 2026-09-04 「규격상 비우기가 맞다」).
 *
 * ① 마스터에 없는 트림(「기본형」·「그랜저GN7」·모델/세대가 트림칸에 든 것 등)은 «비운다».
 *    규격 = 「트림은 그 세부모델 마스터 trims[]에서만」(원자-원천지도). 원문(차명)은 그대로 두어 근거 보존.
 *    정체(제조사·모델·세부모델)는 안 건드린다 — 트림만.
 * ② 같은 원문인데 세부모델(세대)이 «갈린» 차를 뽑아 준다(검수용). W213/W214 처럼. 자동으로 안 고친다.
 *
 * 기본 = 미리보기. --apply 로만 트림을 비운다.
 * 실행: GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/clean-atom-trims.mts [--apply]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { makerGroup } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import { cleanTrim } from '../lib/domain/clean-trim';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as unknown;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : (masterRaw as { entries?: MasterEntry[] }).entries) || []) as MasterEntry[];
const TRIMS = new Map<string, string[]>();
for (const e of MASTER) { if (!e.trims?.length) continue; for (const a of makerGroup(N(e.maker))) TRIMS.set(`${a}|${N(e.model)}|${N(e.sub_model)}`, e.trims); }
const trimsFor = (mk: unknown, mo: unknown, sm: unknown) => { for (const a of makerGroup(N(mk))) { const t = TRIMS.get(`${a}|${N(mo)}|${N(sm)}`); if (t) return t; } return [] as string[]; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

const snap = await fs.collection('products').get();
type Doc = { id: string; d: Record<string, unknown> };
const docs: Doc[] = snap.docs.map((x) => ({ id: x.id, d: x.data() as Record<string, unknown> }));
console.log(`products ${docs.length}`);

// ① 트림 = «마스터에서 복사 or 공란» — 수집기·미러가 쓰는 cleanTrim «한 함수»로 통일한다.
//   ★Codex 2026-09-09: 정규화기가 마스터밖 «진짜같은» 값을 «보존»하고 직접수집 cleanTrim 은 «공란»이라
//     경로별 결과가 갈렸다(같은 Premium 이 한쪽은 남고 한쪽은 비었다). 이제 셋(ingest·mirror·정규화기)이
//     «같은 규칙»을 쓴다 — 트림은 마스터 정본철자 복사, 아니면 공란(원문은 보존, 갭은 보고).
const PLACEHOLDER = /^(기본형|기본\s*사양|기본|기본형태|없음|미정|해당없음|n\/a|-{1,}|\.+)$/i;
const isJunkish = (t: string, mo: unknown, sm: unknown) =>
  PLACEHOLDER.test(t) || (N(mo) && N(t).includes(N(mo))) || (N(sm) && N(t).includes(N(sm))) || /\d\s*세대/.test(t) || t.length > 20;
const 고칠것: { id: string; to: string }[] = [];   // to='' 비움 · to=마스터트림 철자교정(복사)
const kept: string[] = [];
const gap = new Map<string, number>();   // 공란으로 비운 것 중 «진짜같은데 마스터에 없음» — 값은 공란, 마스터 보강 후보로 보고만
let 교정 = 0, 쓰레기 = 0;
for (const { id, d } of docs) {
  const t = S(d.trim_name); if (!t) continue;
  const trims = trimsFor(d.maker, d.model, d.sub_model);
  const to = cleanTrim(t, d.maker, d.model, d.sub_model, trims);   // 복사(정본철자) or 공란
  if (to === t) { kept.push(t); continue; }                        // 이미 정본
  고칠것.push({ id, to });
  if (to) 교정++;                                                   // 마스터 트림으로 철자교정(복사)
  else if (isJunkish(t, d.model, d.sub_model)) 쓰레기++;             // 명백한 쓰레기 → 공란
  else { const key = `${S(d.maker)} ${S(d.sub_model)} 「${t}」`; gap.set(key, (gap.get(key) || 0) + 1); }   // 마스터 갭 → 공란 + 보고
}
console.log(`\n① 트림 = 마스터 복사 or 공란(cleanTrim 통일) — 유지 ${kept.length} · 철자교정(복사) ${교정} · 쓰레기 비움 ${쓰레기} · 마스터갭 비움 ${[...gap.values()].reduce((a, b) => a + b, 0)}`);
console.log('  ── 마스터갭(비움 · 마스터에 넣으면 다음 회차 복사됨) 표본 ──');
for (const [k, v] of [...gap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${k} ×${v}`);

// ② 같은 원문 ↔ 세대(세부모델) 갈림 검수
const byRaw = new Map<string, Set<string>>();
const rawCars = new Map<string, string[]>();
for (const { d } of docs) {
  const raw = N((d.원문 as { 차명?: string })?.차명); const sm = S(d.sub_model); if (!raw || !sm) continue;
  if (!byRaw.has(raw)) { byRaw.set(raw, new Set()); rawCars.set(raw, []); }
  byRaw.get(raw)!.add(sm); rawCars.get(raw)!.push(`${S(d.car_number)}=${sm}(${S(d.year)})`);
}
const split = [...byRaw.entries()].filter(([, set]) => set.size > 1);
console.log(`\n② 같은 원문인데 세대 갈림 ${split.length}건 (검수 — 자동으로 안 고침):`);
for (const [raw, set] of split.slice(0, 12)) console.log(`  「${raw.slice(0, 26)}」 → ${[...set].join(' / ')}  [${(rawCars.get(raw) || []).slice(0, 6).join(' · ')}]`);

if (!APPLY) { console.log(`\n미리보기 — 안 씀. --apply 로 트림을 마스터 정본으로(복사 or 공란). ②는 사람 검수.`); process.exit(0); }
let w = 0;
for (let i = 0; i < 고칠것.length; i += 400) {
  const batch = fs.batch();
  for (const { id, to } of 고칠것.slice(i, i + 400)) { batch.set(fs.collection('products').doc(id), { trim_name: to, _trim_cleaned_at: Date.now() }, { merge: true }); w++; }
  await batch.commit();
}
console.log(`\n반영 완료 — 트림 ${w}건 정본화(cleanTrim: 복사 or 공란, 원문 보존). 정체·②는 안 건드림.`);
process.exit(0);
