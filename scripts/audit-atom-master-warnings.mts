/**
 * 원자 경고 리포트 — «우리 원자가 마스터를 벗어난 것»만 사람 눈에 읽히게 (사장님 2026-09-09).
 *
 * 사장님: 「우리 원자에 수집된 내용만 시트에 쏴주는 개념으로 가고, 우리 원자만 잘못됐는지 잘됐는지 체크하면 되지.」
 *   ⇒ 원자(Firestore products)를 마스터 대조 불변식으로 훑어, «틀린 원자»를 세부모델별로 묶어 보여준다.
 *
 * ★두 갈래로 나눠 보여준다 — 사장님 판단이 갈리는 지점이라(「마스터를 고칠지 못 찾는건지」):
 *   ㉠ IDENT   = 세부모델이 마스터에 «없다» → 마스터에 세부모델을 만들거나, 원자 매칭이 틀린 것.
 *   ㉡ TRIM    = 세부모델은 맞는데 트림이 마스터 트림 «밖» → ⓐ 오염(렌터카·연식·배기량 섞임)이면 정제 버그,
 *              ⓑ 멀쩡한 트림인데 마스터에 없으면 «마스터 구멍» → 마스터에 그 트림을 채우면 복사돼 들어간다.
 *   판정 힌트: 트림에 렌터카/MY/배기량/연료가 섞였으면 «오염», 아니면 «마스터 구멍 후보».
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { makerGroup } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import { atomViolations, type MasterIndex, type AtomView } from '../lib/domain/atom-invariants';
import { isTrimContaminated } from '../lib/domain/clean-trim';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as unknown;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : (masterRaw as { entries?: MasterEntry[] }).entries) || []) as MasterEntry[];
const SUB = new Set<string>(); const TRIMS = new Map<string, string[]>();
for (const e of MASTER) {
  const mo = N(e.model), sm = N(e.sub_model); if (!mo || !sm) continue;
  for (const a of makerGroup(N(e.maker))) { SUB.add(`${a}|${mo}|${sm}`); if (e.trims?.length) TRIMS.set(`${a}|${mo}|${sm}`, e.trims); }
}
const idx: MasterIndex = {
  validSub: (mk, mo, sm) => { for (const a of makerGroup(N(mk))) if (SUB.has(`${a}|${N(mo)}|${N(sm)}`)) return true; return false; },
  trimsOf: (mk, mo, sm) => { for (const a of makerGroup(N(mk))) { const t = TRIMS.get(`${a}|${N(mo)}|${N(sm)}`); if (t) return t; } return []; },
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const snap = await getFirestore().collection('products').get();

type Row = { car: string; maker: string; model: string; sub: string; trim: string; raw: string; confirmed: boolean };
const ident: Row[] = [];                                   // 세부모델이 마스터에 없음
const trimDirty = new Map<string, Row[]>();                // 오염 트림 (세부모델별)
const trimGap = new Map<string, Row[]>();                  // 멀쩡한데 마스터에 없는 트림 = 마스터 구멍 후보

for (const d of snap.docs) {
  const x = d.data() as Record<string, unknown> & AtomView;
  const vio = atomViolations(x, idx);
  if (!vio.length) continue;
  const row: Row = {
    car: S(x.car_number), maker: S(x.maker), model: S(x.model), sub: S(x.sub_model),
    trim: S(x.trim_name), raw: S((x.원문 as { 차명?: unknown })?.차명), confirmed: (x as any).확정 === true,
  };
  if (vio.some((w) => w.code === 'IDENT')) ident.push(row);
  if (vio.some((w) => w.code === 'TRIM')) {
    const key = `${row.maker} ${row.model} ${row.sub}`;
    const bucket = isTrimContaminated(row.trim) ? trimDirty : trimGap;
    (bucket.get(key) || bucket.set(key, []).get(key)!).push(row);
  }
}

const L: string[] = [];
L.push(`# 원자 경고 리포트 — ${snap.size}대 (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`);
L.push(`\n마스터를 벗어난 원자: IDENT(세부모델 없음) ${ident.length} · TRIM 오염 ${[...trimDirty.values()].flat().length} · TRIM 마스터구멍후보 ${[...trimGap.values()].flat().length}`);

L.push(`\n## ㉠ 세부모델이 마스터에 없다 (IDENT ${ident.length}) — 마스터에 세부모델을 만들거나 매칭이 틀림`);
for (const r of ident) L.push(`  ✗ ${r.car} · ${r.maker} ${r.model} / 세부모델 「${r.sub}」 · 원문: ${r.raw}`);

const dump = (title: string, m: Map<string, Row[]>, hint: string) => {
  const total = [...m.values()].flat().length;
  L.push(`\n## ${title} (${total}) — ${hint}`);
  for (const [k, rows] of [...m.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const trims = [...new Set(rows.map((r) => r.trim))];
    L.push(`\n  ▸ ${k}  (${rows.length}대)`);
    L.push(`     마스터 트림: ${(idx.trimsOf(rows[0].maker, rows[0].model, rows[0].sub) || []).join(' · ') || '(없음)'}`);
    for (const t of trims) {
      const cars = rows.filter((r) => r.trim === t).map((r) => r.car);
      L.push(`     원자 트림 「${t}」 ← ${cars.length}대 ${cars.slice(0, 4).join(', ')}${cars.length > 4 ? ' …' : ''}`);
    }
  }
};
dump('㉡-ⓐ 트림 오염 (렌터카·연식·배기량 섞임)', trimDirty, '정제가 원문을 트림칸에 흘림 — 파이프라인 버그');
dump('㉡-ⓑ 마스터 구멍 후보 (멀쩡한 트림인데 마스터에 없음)', trimGap, '마스터에 이 트림을 채우면 원자로 복사돼 들어간다');

const out = 'tmp/원자-경고-리포트.md';
writeFileSync(out, L.join('\n'));
console.log(L.slice(0, 60).join('\n'));
console.log(`\n… 전체는 ${out}`);
