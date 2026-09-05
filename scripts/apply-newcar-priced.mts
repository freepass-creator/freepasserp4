/**
 * 신차마스터 «실가 유무» 표시 + 단종 의심 훑기 (사장님 2026-09-05 추천대로).
 *   market_class='신차' 중 우리가 크롤한 new_car_trim 에 실가가 있는 것 = newcar_priced:true
 *   → 신차 견적기가 바로 쓰는 것. 없으면 false(수입 대부분 · 현행이나 미수집).
 *   덤: 국산 현행인데 new_car_trim 에 없는 것 = «단종 의심»으로 리포트(자동 재분류는 안 함 — 사람 확인).
 * 기본 드라이런. --apply 로 vehicle-master.json 갱신.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'node:fs';
const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\n/g, '\n') }) });
const FS = getFirestore();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s()·\-]/g, '');
const DOM = new Set(['현대', '기아', '제네시스', '르노', 'KG모빌리티', '르노코리아', '쉐보레', '쌍용']);

// 기아·제네시스 new_car_trim 은 영문 슬러그(carnival·g80) → 한글 다리(마스터는 한글).
const KIA2KO: Record<string, string> = { carnival: '카니발', sorento: '쏘렌토', sportage: '스포티지', seltos: '셀토스', morning: '모닝', ray: '레이', niro: '니로', k5: 'k5', k8: 'k8', k9: 'k9', ev3: 'ev3', ev4: 'ev4', ev5: 'ev5', ev6: 'ev6', ev9: 'ev9' };
// new_car_trim → maker별 모델명 토큰(정규화). 영문 슬러그면 한글도 함께 담는다.
const snap = await FS.collection('new_car_trim').get();
const priced = new Map<string, Set<string>>(); // maker → set of normalized model names
snap.forEach((d) => {
  const v = d.data(); const mk = S(v.maker); if (!priced.has(mk)) priced.set(mk, new Set());
  const set = priced.get(mk)!;
  set.add(N(v.sub_model)); set.add(N(v.carType));
  const ko = KIA2KO[S(v.carType).toLowerCase()] || KIA2KO[S(v.sub_model).toLowerCase()];
  if (ko) set.add(N(ko));
});

const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: any[] = Array.isArray(raw) ? raw : raw.entries;
// 마스터 세부모델의 개발코드 뗀 base
const baseSub = (e: any) => { const sm = S(e.sub_model), gc = S(e.gen_code); return gc && sm.endsWith(gc) ? sm.slice(0, sm.length - gc.length).trim() : sm; };

let pricedN = 0; const suspects: string[] = [];
for (const e of entries) {
  if (e.market_class !== '신차') { e.newcar_priced = false; continue; }
  const set = priced.get(S(e.maker));
  const base = N(baseSub(e));
  // 실가 매칭: new_car_trim 모델명이 base 를 포함하거나 base 가 포함(양방향 contains)
  const hit = set ? [...set].some((m) => m && (m.includes(base) || base.includes(m))) : false;
  e.newcar_priced = hit;
  if (hit) pricedN++;
  else if (DOM.has(S(e.maker))) suspects.push(`${e.maker} ${e.sub_model} (${e.year_start}~현재)`);
}
console.log(`신차 중 실가있음(newcar_priced) ${pricedN} · 국산인데 실가없음(단종 의심 or 미크롤) ${suspects.length}`);
console.log('\n[국산 현행인데 new_car_trim 에 없음 — 단종 의심/미크롤]:');
suspects.slice(0, 30).forEach((x) => console.log('  ? ' + x));
if (APPLY) { writeFileSync('public/data/vehicle-master.json', JSON.stringify(raw, null, 2)); console.log('\n✓ vehicle-master.json 갱신'); }
else console.log('\n(드라이런)');
process.exit(0);
