/**
 * 세대 오류 교정 — «원문이 세대를 명시했는데 다른 세대로 박힌」 것을 원문대로 (사장님 2026-09-04).
 *   추측이 아니다 — 원문(차명)에 세대코드가 «적혀 있고» 원자 세대가 그와 다를 때만 고친다.
 *
 * 안전 조건(모두 만족해야 고침):
 *   ① 원문에 세대코드가 있다(3자 이상 — CN7·GN7·KA4·NQ5·JK1·W213… · AD·YP 같은 2자는 오탐 위험이라 제외).
 *   ② 그 코드가 원자 현재 세부모델의 세대코드와 «다르다».
 *   ③ (제조사·모델) 안에서 그 코드의 마스터 세부모델이 «유일»하다(페이스리프트로 여럿이면 애매 → 검수로 남김).
 *
 * 기본 = 미리보기. --apply 로만 세부모델 교정. 트림은 새 세대 마스터 트림 밖이면 같이 비운다.
 * 실행: GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/fix-generation-from-raw.mts [--apply]
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

// (제조사별칭|모델) → 세대코드(대문자N) → 세부모델[]  ·  세부모델 → 세대코드 · 연식범위
const byGen = new Map<string, Map<string, Set<string>>>();
const genOfSub = new Map<string, string>();
const trimsOfSub = new Map<string, string[]>();
const yearsOfSub = new Map<string, [number, number]>();
for (const e of MASTER) {
  const g = S((e as { gen_code?: string }).gen_code); if (!g) continue;
  const mo = N(e.model), sm = S(e.sub_model);
  const ys = Number((e as { year_start?: unknown }).year_start) || 0;
  const ye = Number((e as { year_end?: unknown }).year_end) || 9999;
  for (const a of makerGroup(N(e.maker))) {
    const mk = `${a}|${mo}`;
    if (!byGen.has(mk)) byGen.set(mk, new Map());
    const gm = byGen.get(mk)!; const key = N(g);
    if (!gm.has(key)) gm.set(key, new Set());
    gm.get(key)!.add(sm);
    genOfSub.set(`${a}|${mo}|${N(sm)}`, N(g));
    yearsOfSub.set(`${a}|${mo}|${N(sm)}`, [ys, ye]);
    if (e.trims?.length) trimsOfSub.set(`${a}|${mo}|${N(sm)}`, e.trims);
  }
}
const yearsOf = (mk: unknown, mo: unknown, sm: string): [number, number] => { for (const a of makerGroup(N(mk))) { const y = yearsOfSub.get(`${a}|${N(mo)}|${N(sm)}`); if (y) return y; } return [0, 9999]; };
const genCodesFor = (mk: unknown, mo: unknown) => { for (const a of makerGroup(N(mk))) { const gm = byGen.get(`${a}|${N(mo)}`); if (gm) return gm; } return null; };
const genOf = (mk: unknown, mo: unknown, sm: unknown) => { for (const a of makerGroup(N(mk))) { const g = genOfSub.get(`${a}|${N(mo)}|${N(sm)}`); if (g) return g; } return ''; };
const trimsOf = (mk: unknown, mo: unknown, sm: string) => { for (const a of makerGroup(N(mk))) { const t = trimsOfSub.get(`${a}|${N(mo)}|${N(sm)}`); if (t) return t; } return [] as string[]; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();
const snap = await fs.collection('products').get();

type Fix = { id: string; car: string; from: string; to: string; g: string; raw: string; blankTrim: boolean };
const fixes: Fix[] = [];
const ambiguous: string[] = [];
for (const doc of snap.docs) {
  const d = doc.data() as Record<string, unknown>;
  const maker = d.maker, model = d.model, sub = S(d.sub_model);
  const raw = N((d.원문 as { 차명?: string })?.차명); if (!sub || !raw) continue;
  const gm = genCodesFor(maker, model); if (!gm) continue;
  const curGen = genOf(maker, model, sub);
  // 원문에 든 세대코드(3자 이상, 그 모델의 코드 중) 찾기
  const present = [...gm.keys()].filter((g) => g.length >= 3 && raw.includes(g));
  if (present.length !== 1) continue;                 // 없거나 여럿이면 건드리지 않음
  const g = present[0];
  if (g === curGen) continue;                         // 이미 그 세대면 OK
  let subs = [...gm.get(g)!];
  if (subs.length > 1) {
    // 페이스리프트로 여럿 → «연식»으로 가른다(원문 코드 + 연식 = 추측 아님). 연식이 한 세부모델에만 들면 그것.
    const yr = Number(S(d.year)) || 0;
    if (yr) { const inRange = subs.filter((s) => { const [ys, ye] = yearsOf(maker, model, s); return yr >= ys && yr <= ye; }); if (inRange.length === 1) subs = inRange; }
  }
  if (subs.length !== 1) { ambiguous.push(`  ? ${S(d.car_number)} 「${raw.slice(0, 26)}」 코드 ${g.toUpperCase()} → 세부모델 여럿 [${[...gm.get(g)!].join('·')}] 연식 ${S(d.year) || '?'} (검수)`); continue; }
  const to = subs[0];
  const trims = trimsOf(maker, model, to); const t = S(d.trim_name);
  const blankTrim = !!t && !trims.some((x) => N(x) === N(t));
  fixes.push({ id: doc.id, car: S(d.car_number), from: sub, to, g: g.toUpperCase(), raw, blankTrim });
}

console.log(`■ 세대 교정(원문 명시) — 고칠 것 ${fixes.length} · 애매(검수) ${ambiguous.length}`);
for (const f of fixes.slice(0, 20)) console.log(`  ✓ ${f.car} 「${f.raw.slice(0, 26)}」 [${f.g}]  ${f.from} → ${f.to}${f.blankTrim ? ' (+트림 비움)' : ''}`);
if (ambiguous.length) { console.log('  ── 애매(안 고침) ──'); for (const l of ambiguous.slice(0, 10)) console.log(l); }

if (!APPLY) { console.log(`\n미리보기 — 안 씀. 고치려면 --apply.`); process.exit(0); }
let w = 0;
for (let i = 0; i < fixes.length; i += 400) {
  const batch = fs.batch();
  for (const f of fixes.slice(i, i + 400)) {
    const upd: Record<string, unknown> = { sub_model: f.to, _gen_fixed_at: Date.now() };
    if (f.blankTrim) upd.trim_name = '';
    batch.set(fs.collection('products').doc(f.id), upd, { merge: true });
    w++;
  }
  await batch.commit();
}
console.log(`\n반영 완료 — 세대 ${w}건 원문대로 교정. 애매 ${ambiguous.length}건은 검수로 남김.`);
process.exit(0);
