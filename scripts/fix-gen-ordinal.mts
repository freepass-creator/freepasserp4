/**
 * 세대 교정 (원문의 「N세대」) — 원문이 세대를 «숫자»로 명시했는데 다른 세대로 박힌 것을 원문대로.
 *   사장님 2026-09-04 「E클래스 6세대가 뭐가 애매하냐 · 원문에 웬만하면 다 있다」.
 *   벤츠 E-클래스 = 마스터 연식순 W123(1세대)…W213(6세대)·W214(7세대). 원문 「6세대」 = W213.
 *
 * N세대 → 그 모델의 N번째 세대(마스터 연식순, 세대코드 중복제거). 현재와 다르면 교정.
 * 기본 = 미리보기. --apply 로만 씀. 트림이 새 세대 마스터 트림 밖이면 같이 비운다.
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

// (제조사별칭|모델) → 연식순 세대 [{sub, gen, ys}] (세대코드 중복제거) · 세부모델→트림
const gensRaw = new Map<string, { sub: string; gen: string; ys: number }[]>();
const trimsOfSub = new Map<string, string[]>();
for (const e of MASTER) {
  const g = S((e as { gen_code?: string }).gen_code); if (!g) continue;
  const ys = Number((e as { year_start?: unknown }).year_start) || 0;
  for (const a of makerGroup(N(e.maker))) {
    const k = `${a}|${N(e.model)}`;
    if (!gensRaw.has(k)) gensRaw.set(k, []);
    gensRaw.get(k)!.push({ sub: S(e.sub_model), gen: N(g), ys });
    if (e.trims?.length) trimsOfSub.set(`${a}|${N(e.model)}|${N(e.sub_model)}`, e.trims);
  }
}
const ordered = (mk: unknown, mo: unknown) => {
  for (const a of makerGroup(N(mk))) {
    const g = gensRaw.get(`${a}|${N(mo)}`); if (!g) continue;
    const seen = new Set<string>(); const ord: { sub: string; gen: string; ys: number }[] = [];
    for (const x of [...g].sort((p, q) => p.ys - q.ys)) { if (seen.has(x.gen)) continue; seen.add(x.gen); ord.push(x); }
    return ord;
  }
  return [] as { sub: string; gen: string; ys: number }[];
};
const trimsOf = (mk: unknown, mo: unknown, sm: string) => { for (const a of makerGroup(N(mk))) { const t = trimsOfSub.get(`${a}|${N(mo)}|${N(sm)}`); if (t) return t; } return [] as string[]; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();
const snap = await fs.collection('products').get();

type Fix = { id: string; car: string; from: string; to: string; n: number; blankTrim: boolean };
const fixes: Fix[] = [];
for (const doc of snap.docs) {
  const d = doc.data() as Record<string, unknown>;
  const raw = N((d.원문 as { 차명?: string })?.차명); const sub = S(d.sub_model); if (!sub || !raw) continue;
  const m = raw.match(/(\d+)세대/); if (!m) continue;
  const n = Number(m[1]);
  const ord = ordered(d.maker, d.model); if (n < 1 || n > ord.length) continue;
  const to = ord[n - 1].sub;
  if (N(to) === N(sub)) continue;
  // ★안전판 — «세대코드·페이스리프트(더 뉴/올 뉴)만 빼면 나머지가 같을 때»만 고친다.
  //   E-클래스 W214→W213·더 뉴 카니발 KA4→카니발 KA4 는 OK(같은 라인). 쿠퍼 C→쿠퍼 일렉트릭·
  //   2시리즈 그란쿠페→액티브투어러 처럼 «바디가 다른» 것은 세대전환이 아니라 오탐이므로 건너뛴다.
  const stripGen = (s: string) => N(S(s).replace(/(더\s*뉴|올\s*뉴|뉴|the)\s*/gi, ' ').replace(/\b[A-Za-z]+\d+[A-Za-z0-9/\-]*\b/g, ' '));
  if (stripGen(sub) !== stripGen(to)) continue;
  const t = S(d.trim_name);
  const blankTrim = !!t && !trimsOf(d.maker, d.model, to).some((x) => N(x) === N(t));
  fixes.push({ id: doc.id, car: S(d.car_number), from: sub, to, n, blankTrim });
}
console.log(`■ 세대 교정(원문 「N세대」) — 고칠 것 ${fixes.length}`);
for (const f of fixes.slice(0, 20)) console.log(`  ✓ ${f.car} ${f.n}세대  ${f.from} → ${f.to}${f.blankTrim ? ' (+트림 비움)' : ''}`);

if (!APPLY) { console.log(`\n미리보기 — 안 씀. 고치려면 --apply.`); process.exit(0); }
let w = 0;
for (let i = 0; i < fixes.length; i += 400) {
  const batch = fs.batch();
  for (const f of fixes.slice(i, i + 400)) { const upd: Record<string, unknown> = { sub_model: f.to, _gen_fixed_at: Date.now() }; if (f.blankTrim) upd.trim_name = ''; batch.set(fs.collection('products').doc(f.id), upd, { merge: true }); w++; }
  await batch.commit();
}
console.log(`\n반영 완료 — 세대 ${w}건 원문 「N세대」대로 교정.`);
process.exit(0);
