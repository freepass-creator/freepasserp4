/**
 * 전수 감사 — 원문(원천 차명) ↔ Firestore 원자를 대조해 «모순»을 찾는다 (사장님 2026-09-05).
 *   「원문하고 파이어베이스 데이터를 다시 확인. 배기량 있으면 전기차 아니고, 2.5t·3.5t 배기량 정확히,
 *    인승도 정확히.」  다 갈아엎는 게 아니라 «어긋난 것»만 뽑아 사람이 본다. --apply 로 «확실한」 것만 고침.
 *
 * 잡는 모순:
 *   A. 전기 모순 — 배기량이 «있는데» 세부모델/연료가 전기(일렉트리파이드·EV). 배기량 있으면 내연차다.
 *   B. 연료 불일치 — 원문의 연료말(가솔린·디젤·LPG·전기·하이브리드)과 원자 연료가 다름.
 *   C. 배기량 불일치 — 원문의 2.5·3.5·2.0 배기량과 원자 engine_cc 가 다름(0.2L 넘게).
 *   D. 인승 의심 — 원문·모델로 본 상식 인승과 다름(카니발 7/9·아반떼 5 …).
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

const EV_SUB = /일렉트리파이드|일렉트릭|electric|\bev\b/i;
const hasCc = (v: unknown) => Number(S(v).replace(/[^\d]/g, '')) > 0;
const ccNum = (v: unknown) => Number(S(v).replace(/[^\d]/g, '')) || 0;
// 연료 정규화 — 원문·원자를 같은 잣대로. HEV·가솔린+전기 → 하이브리드, lpi·LPG → LPG 등.
function canonFuel(s: string): string {
  const r = S(s).toLowerCase().replace(/\s+/g, '');
  if (/phev|플러그인/.test(r)) return '플러그인';
  if (/hev|하이브리드|hybrid|가솔린\+전기|전기\+가솔린/.test(r)) return '하이브리드';
  if (/수소|fcev/.test(r)) return '수소';
  if (/전기|electric|(?:^|[^a-z])ev(?:[^a-z]|$)/.test(r)) return '전기';
  if (/디젤|diesel/.test(r)) return '디젤';
  if (/lpg|lpi|엘피지/.test(r)) return 'LPG';
  if (/가솔린|gasoline|휘발유/.test(r)) return '가솔린';
  return '';
}
// 원문에서 배기량(L) — 「2.5」「3.5T」. 하이브리드 HEV 배기량은 원문에 엔진L이 적히므로 그대로 본다.
function rawLiter(raw: string): number {
  const m = [...raw.matchAll(/(\d\.\d)\s*t?\b/gi)].map((x) => Number(x[1])).filter((n) => n >= 0.8 && n <= 6.5);
  return m[0] || 0;
}

// 마스터 유효 세부모델 집합(제조사 무시, 모델|세부 소문자) — A 의 세부모델 교정이 실재값인지 확인용.
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: Array<{ model?: string; sub_model?: string }> } | Array<{ model?: string; sub_model?: string }>;
const MASTER = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const VALID_SUB = new Set(MASTER.map((e) => `${N(e.model)}|${N(e.sub_model)}`));
// 원문 리터 → 표준 배기량(cc). 흔한 것만; 없으면 리터×1000 근사.
const LITER_CC: Record<string, number> = { '1.0': 998, '1.2': 1197, '1.4': 1353, '1.5': 1497, '1.6': 1598, '2.0': 1999, '2.2': 2199, '2.4': 2359, '2.5': 2497, '3.0': 2999, '3.3': 3342, '3.5': 3470, '3.8': 3778 };
const literToCc = (l: number) => LITER_CC[l.toFixed(1)] || Math.round(l * 1000);

const snap = await fs.collection('products').get();
type Hit = { car: string; sub: string; raw: string; kind: string; msg: string };
const A: Hit[] = [], B: Hit[] = [], Cc: Hit[] = [];
type Fix = { id: string; car: string; set: Record<string, unknown>; why: string };
const fixes: Fix[] = [];
const addFix = (id: string, car: string, set: Record<string, unknown>, why: string) => {
  const cur = fixes.find((f) => f.id === id);
  if (cur) { Object.assign(cur.set, set); cur.why += ' · ' + why; } else fixes.push({ id, car, set, why });
};
for (const d of snap.docs) {
  const x = d.data() as Record<string, unknown>;
  const raw = S((x.원문 as { 차명?: string })?.차명);
  const sub = S(x.sub_model), model = S(x.model), fuel = S(x.fuel_type), cc = S(x.engine_cc);
  const car = S(x.car_number);
  const rf = canonFuel(raw), af = canonFuel(fuel), rl = rawLiter(raw);
  // A. 전기 모순 — «순수 전기/수소»(하이브리드 아님)인데 배기량 있음.
  const claimsEV = EV_SUB.test(sub) || af === '전기' || af === '수소';
  if (hasCc(cc) && claimsEV && af !== '하이브리드') {
    A.push({ car, sub, raw, kind: 'A', msg: `배기량 ${cc} 있는데 ${EV_SUB.test(sub) ? '세부모델 EV' : ''}${af === '전기' || af === '수소' ? ' 연료 ' + fuel : ''}` });
    // ★배기량 있으면 내연차(사장님 규칙). 세부모델에서 「일렉트리파이드」를 뗀 «내연 변형»이 마스터에
    //   실재하면 그걸로 교정. 연료는 원문말이 있으면 그것, 없으면(「G80」뿐) 가솔린 기본(배기량이 엔진 증거).
    if (EV_SUB.test(sub)) {
      const gasSub = sub.replace(/^일렉트리파이드\s*/, '');
      if (gasSub !== sub && VALID_SUB.has(`${N(model)}|${N(gasSub)}`)) {
        const setFuel = (rf && rf !== '전기' && rf !== '수소') ? rf : '가솔린';
        addFix(d.id, car, { sub_model: gasSub, fuel_type: setFuel }, `A:세부모델 ${sub}→${gasSub}(연료 ${setFuel})`);
      }
    }
  }
  // B. 연료 불일치 — 원문대로.
  if (rf && af && rf !== af) { B.push({ car, sub, raw, kind: 'B', msg: `원문 ${rf} ≠ 원자 ${fuel}(${af})` }); addFix(d.id, car, { fuel_type: rf }, `B:연료 ${fuel}→${rf}`); }
  // C. 배기량 불일치 — 원문 리터대로.
  if (rl && hasCc(cc) && af !== '전기' && af !== '수소') {
    const diff = Math.abs(rl - ccNum(cc) / 1000);
    if (diff > 0.2) { Cc.push({ car, sub, raw, kind: 'C', msg: `원문 ${rl}L ≠ 원자 ${cc}cc(${(ccNum(cc) / 1000).toFixed(1)}L)` }); addFix(d.id, car, { engine_cc: String(literToCc(rl)) }, `C:배기량 ${cc}→${literToCc(rl)}`); }
  }
}

const show = (t: string, arr: Hit[]) => { console.log(`\n■ ${t} — ${arr.length}건`); for (const h of arr.slice(0, 14)) console.log(`  ${h.car.padEnd(9)} 「${h.raw.slice(0, 30)}」 ${h.sub} · ${h.msg}`); };
console.log(`전수 감사 — 원자 ${snap.size}대`);
show('A. 전기 모순(배기량 있는데 EV)', A);
show('B. 연료 불일치(원문↔원자)', B);
show('C. 배기량 불일치(원문 리터↔원자 cc)', Cc);
console.log(`\n⚠ 인승(D)은 모델별 상식표가 있어야 정확 — 다음 단계.`);
console.log(`\n★고칠 것(원문·마스터 근거 확실) ${fixes.length}건:`);
for (const f of fixes.slice(0, 20)) console.log(`  ${f.car.padEnd(9)} ${f.why}`);

if (!APPLY) { console.log('\n미리보기 — 안 씀. --apply 로 위 확실한 것 반영(원문·마스터 근거).'); process.exit(0); }
let w = 0;
for (let i = 0; i < fixes.length; i += 400) {
  const batch = fs.batch();
  for (const f of fixes.slice(i, i + 400)) { batch.set(fs.collection('products').doc(f.id), { ...f.set, _audit_fixed_at: Date.now() }, { merge: true }); w++; }
  await batch.commit();
}
console.log(`\n반영 완료 — ${w}건 원문·마스터대로 교정(A 세부모델·B 연료·C 배기량).`);
process.exit(0);
