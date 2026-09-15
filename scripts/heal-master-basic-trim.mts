/**
 * 차종마스터 «기본형» 통일 — 엔카 기준(사장님 2026-09-11).
 *
 * 사장님: 「G80 RG3 같은 엣지 세부트림이 없는 애들은 «기본형»으로. 엔카랑 맞추자.」
 *   원인: 마스터가 «엣지 없음»을 세 철자로 적었다 — «(세부등급 없음)»·«기본»·«기본형».
 *   원문(차명)은 엔카식으로 «기본형»이라 오는데 마스터에 «기본형»이 없어 cleanTrim 이 못 맞추고 공란이 됐다.
 *   ⇒ 마스터의 «(세부등급 없음)» → «기본형» (엔카 철자). 그러면 원문 «기본형»이 마스터에 «복사»된다(지어내기 아님).
 *
 * ★«기본»(×187)은 «안 건드린다» — 그랜저[V6,기본,프리미엄]처럼 «진짜 엔카 등급명»인 경우가 많다.
 *   이 스크립트는 명백한 플레이스홀더 «(세부등급 없음)»만 «기본형»으로 통일하고,
 *   트림칸에 잘못 들어간 세대코드 정리메모(«(세대코드…)»)는 삭제한다.
 *
 * 기본 = 미리보기. --apply 로만 쓴다.
 * 실행: FIREBASE_SERVICE_ACCOUNT_JSON=tmp/firebase-auth/freepasserp5-sa.json \
 *        npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/heal-master-basic-trim.mts [--apply]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();

const keyPath = S(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) || 'tmp/firebase-auth/freepasserp5-sa.json';
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const db = getFirestore();

const PLACEHOLDER = '(세부등급 없음)';
const BASIC = '기본형';
const GARBAGE = /세대코드|gen_code|1세대 차대 코드/;   // 트림칸에 잘못 들어간 정리메모

const snap = await db.collection('vehicle_master').get();
type Change = { id: string; sub: string; before: string[]; after: string[] };
const changes: Change[] = [];
let renamed = 0, deduped = 0, garbageDropped = 0;

for (const doc of snap.docs) {
  const v = doc.data() as Record<string, unknown>;
  const trims = (Array.isArray(v.trims) ? v.trims : []).map(S).filter(Boolean);
  if (!trims.length) continue;

  let touched = false;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of trims) {
    if (GARBAGE.test(t)) { garbageDropped++; touched = true; continue; }
    const mapped = t === PLACEHOLDER ? BASIC : t;
    if (mapped !== t) { renamed++; touched = true; }
    const norm = mapped.toLowerCase().replace(/\s+/g, '');
    if (seen.has(norm)) { deduped++; touched = true; continue; }   // 이미 «기본형» 있던 세부모델 → 중복 제거
    seen.add(norm);
    out.push(mapped);
  }
  if (touched) changes.push({ id: doc.id, sub: `${S(v.maker)} ${S(v.sub_model)}`, before: trims, after: out });
}

console.log(`마스터 세부모델 ${snap.size} · 변경 ${changes.length}건`);
console.log(`  «(세부등급 없음)»→«기본형» 철자통일 ${renamed} · 중복제거 ${deduped} · 세대코드메모 삭제 ${garbageDropped}\n`);
for (const c of changes.slice(0, 20)) console.log(`  ${c.sub}\n    전: [${c.before.join(', ')}]\n    후: [${c.after.join(', ')}]`);
if (changes.length > 20) console.log(`  … 외 ${changes.length - 20}건`);

if (!APPLY) { console.log('\n미리보기 — 안 씀. --apply 로 반영.'); process.exit(0); }

let w = 0;
for (let i = 0; i < changes.length; i += 400) {
  const batch = db.batch();
  for (const c of changes.slice(i, i + 400)) { batch.set(db.collection('vehicle_master').doc(c.id), { trims: c.after, _basic_trim_healed_at: Date.now() }, { merge: true }); w++; }
  await batch.commit();
}
console.log(`\n반영 완료 — 마스터 ${w}건 «기본형» 통일. 다음: 마스터 JSON 재export → 공란 원자 재투영.`);
process.exit(0);
