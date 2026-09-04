/**
 * 외부 정제시트(차종마스터 정제본) → v4/products «한 번 원자화» 교정.
 *   사장님 2026-09-04 「외부시트/홈피를 차종마스터 기반 직접 원자화해두고 상태값만 반영하는 로직」 확인.
 *   색·주행·세부트림은 write-once 라 옛 시딩이 잘못/비어 있으면 정제시트가 맞아도 원자가 안 고쳐진다.
 *   정제시트의 «세부트림·외장색상·주행거리»(모두 차종마스터 정제칸)를 읽어, 원자가 비었거나 명백히 틀린 것만 채운다.
 *   ★기존 값은 덮지 않는다(비었을 때만). 상태값은 안 건드린다(상태는 매시간 연동이 소유).
 * 대상 = MIRROR_SOURCES 4곳(아이카·오토플러스·이안카·아이언). 기본 dry-run · --apply.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const NKEY = (c: unknown) => S(c).replace(/\s/g, '');
const NUM = /^[\d,]+(\.\d+)?$/;
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const rtdb = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const api = async (u: string) => { const t = (await jwt.getAccessToken()).token; const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } }); return JSON.parse(await r.text()); };

// ── 트림 피커(모든 공급사) — 세부모델의 마스터 trims[] 를 원문과 정규화 대조해 세부트림을 뽑는다.
//   사장님 2026-09-04 「원문에 세부트림 있으면 한 번 원자화하면 되지」. 마스터 trims 에서만 고르므로 지어내지 않는다.
const master = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const subTrims = new Map<string, string[]>();   // 세부모델 → 마스터 trims[](긴 것 먼저)
for (const e of master.entries as any[]) {
  const set = new Set<string>();
  for (const v of (e.variants || [])) for (const t of (v.trims || [])) { const s = S(t); if (s && s !== '(세부등급 없음)') set.add(s); }
  if (set.size) subTrims.set(S(e.sub_model), [...set].sort((a, b) => b.length - a.length));
}
// 한↔영·철자 정규화(원문·마스터트림 양쪽에 같은 함수).
const TR: [RegExp, string][] = [
  [/비지니스/g, '비즈니스'], [/iconic/gi, '아이코닉'], [/\bsport\b/gi, '스포츠'], [/premium/gi, '프리미엄'], [/standard/gi, '스탠다드'],
  [/signature/gi, '시그니처'], [/luxury/gi, '럭셔리'], [/prestige/gi, '프레스티지'], [/exclusive/gi, '익스클루시브'], [/modern/gi, '모던'],
  [/inspiration/gi, '인스퍼레이션'], [/noblesse/gi, '노블레스'], [/limited/gi, '리미티드'], [/dynamic/gi, '다이나믹'], [/smart/gi, '스마트'],
];
const normT = (s: string) => { let x = S(s).toLowerCase(); for (const [r, v] of TR) x = x.replace(r, v); return x.replace(/[\s()\/\-·.]/g, ''); };
const pickTrim = (sub: string, raw: string): string => {
  const trims = subTrims.get(S(sub)); if (!trims || !raw) return '';
  const r = normT(raw);
  for (const t of trims) { const tn = normT(t); if (tn.length >= 2 && r.includes(tn)) return t; }   // 긴 것부터 → 가장 구체적
  return '';
};

// 정제시트 → 차번별 {트림, 색, 주행} (공급사코드 붙여)
type Truth = { maker: string; model: string; sub: string; trim: string; color: string; mileage: string };
const truth = new Map<string, Truth>();   // `${code}|${car}` → Truth
for (const src of MIRROR_SOURCES) {
  try {
    const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${src.to}?fields=sheets.properties(title)`);
    for (const sh of meta.sheets) {
      const title = S(sh.properties.title);
      const vv = await api(`https://sheets.googleapis.com/v4/spreadsheets/${src.to}/values/${encodeURIComponent(`'${title}'!A1:BZ5000`)}`);
      const rows = vv.values || []; if (rows.length < 2) continue;
      const hd = (rows[0] || []).map(S);
      const ci = hd.indexOf('차량번호'), ti = hd.indexOf('세부트림'), coi = hd.indexOf('외장색상'), ki = hd.indexOf('주행거리');
      // 제조사·모델·세부모델 = 정제칸(차종마스터 행 복사). 제조사(정제) 우선, 없으면 원문 제조사.
      const mki = hd.indexOf('제조사(정제)') >= 0 ? hd.indexOf('제조사(정제)') : hd.indexOf('제조사');
      const moi = hd.indexOf('모델'), smi = hd.indexOf('세부모델');
      if (ci < 0) continue;
      for (const r of rows.slice(1)) {
        const car = NKEY(r[ci]); if (!car) continue;
        truth.set(`${src.code}|${car}`, {
          maker: mki >= 0 ? S(r[mki]) : '', model: moi >= 0 ? S(r[moi]) : '', sub: smi >= 0 ? S(r[smi]) : '',
          trim: ti >= 0 ? S(r[ti]) : '', color: coi >= 0 ? S(r[coi]) : '', mileage: ki >= 0 ? S(r[ki]) : '',
        });
      }
    }
    console.log(`${src.name}(${src.code}) 정제시트 읽음`);
  } catch (e) { console.warn(`${src.name} 실패:`, (e as Error).message); }
}
console.log(`정제시트 차번 총 ${truth.size}대\n`);

const products = (await rtdb.ref('v4/products').get()).val() as Record<string, any> || {};
const updates: Record<string, any> = {};
const stat = { maker: 0, model: 0, sub: 0, trim: 0, color: 0, mileage: 0, gubun: 0 };
const rows: string[] = [];
for (const [key, v] of Object.entries(products)) {
  if (!v || typeof v !== 'object') continue;
  const code = S(v.provider_company_code); const car = NKEY(v.car_number);
  const changes: string[] = [];
  // ⑤ 상품구분(불변) 정규화 — 5개 캐논만. 오플(RP023)=오플구독 · 재랜트/재렌트=중고렌트. (모든 공급사)
  const curPt = S(v.product_type);
  const newPt = code === 'RP023' ? '오플구독' : (/재랜트|재렌트/.test(curPt) ? '중고렌트' : '');
  if (newPt && newPt !== curPt) { updates[`v4/products/${key}/product_type`] = newPt; stat.gubun++; changes.push(`구분 「${curPt}」→「${newPt}」`); }
  // ② 제원·스펙(불변) 채움 — 정제시트(차종마스터 정제본) 있는 공급사만, «비었을 때만».
  const t = truth.get(`${code}|${car}`);
  if (t) {
    if (t.maker && !S(v.maker)) { updates[`v4/products/${key}/maker`] = t.maker; stat.maker++; changes.push(`제조사→「${t.maker}」`); }
    if (t.model && !S(v.model)) { updates[`v4/products/${key}/model`] = t.model; stat.model++; changes.push(`모델→「${t.model}」`); }
    if (t.sub && !S(v.sub_model)) { updates[`v4/products/${key}/sub_model`] = t.sub; stat.sub++; changes.push(`세부모델→「${t.sub}」`); }
    if (t.trim && !S(v.trim_name)) { updates[`v4/products/${key}/trim_name`] = t.trim; stat.trim++; changes.push(`트림→「${t.trim}」`); }
    if (t.color && !S(v.ext_color)) { updates[`v4/products/${key}/ext_color`] = t.color; stat.color++; changes.push(`색→「${t.color}」`); }
    // 주행거리는 «변동»(사장님 2026-09-04 「대여료처럼 변동」) — 정제시트 현재값을 매번 따른다(비었을 때만이 아니라 다르면 갱신).
    if (t.mileage && S(v.mileage) !== t.mileage) { updates[`v4/products/${key}/mileage`] = t.mileage; stat.mileage++; changes.push(`주행 「${S(v.mileage)}」→「${t.mileage}」`); }
  }
  // ② 세부트림 피커(모든 공급사) — 정제시트로도 못 채운 빈 트림을, 세부모델 마스터 trims 에서 원문 대조로 뽑는다(손오공·아이언 등).
  const trimKey = `v4/products/${key}/trim_name`;
  const subM = updates[`v4/products/${key}/sub_model`] || S(v.sub_model);
  if (!S(v.trim_name) && !updates[trimKey] && subM) {
    // ★v4/products(RTDB)의 원문은 supplier_vehicle_name 이다(«원문」 객체는 미러가 Firestore 에 만든다).
    const raw = S(v.supplier_vehicle_name) || S(v['원문']?.['차명']);
    const picked = pickTrim(subM, raw);
    if (picked) { updates[trimKey] = picked; stat.trim++; changes.push(`트림(원문)→「${picked}」`); }
  }
  if (changes.length && rows.length < 25) rows.push(`  ${code} ${car}: ${changes.join(' · ')}`);
}
console.log(`교정: 제조사 ${stat.maker} · 모델 ${stat.model} · 세부모델 ${stat.sub} · 세부트림 ${stat.trim} · 색 ${stat.color} · 주행 ${stat.mileage} · 구분 ${stat.gubun} (필드 ${Object.keys(updates).length})`);
for (const r of rows) console.log(r);
if (!APPLY) { console.log(`\n미리보기 — 실제: --apply`); process.exit(0); }
// 큰 update 는 나눠서
const entries = Object.entries(updates);
for (let i = 0; i < entries.length; i += 500) { await rtdb.ref().update(Object.fromEntries(entries.slice(i, i + 500))); }
console.log(`\n반영 완료 — ${Object.keys(updates).length} 필드. 다음 미러가 Firestore 로 전파.`);
process.exit(0);
