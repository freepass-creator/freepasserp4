/**
 * 차종 SSOT 매칭 — 매물의 (거친/부분) 차종 정보를 차종마스터(vehicle-master 1805세대)의 실재 조합으로 스냅.
 * freepasserp3 snapToSsot 취지 이식(간소화): 제조사→모델/세부모델 유사도 + 연식 세대 + 파워트레인(연료·배기량) + 트림.
 * 반환은 후보(confidence). 자동 확정 아님 — 폼에서 사용자 검토 후 반영(오분류 방어).
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { classifyVehicleClass } from '@/lib/domain/vehicle-class';

export type MasterVariant = { label: string; fuel: string; displacement_l: number | null; turbo: boolean; drivetrain: string | null; seat: number | null; battery_kwh: number | null; trims: string[] };
export type MasterEntry = { id: string; maker: string; model: string; sub_model: string; gen_code: string; origin: string; year_start: string; year_end: string; title?: string; variants: MasterVariant[]; trims?: string[] };
export type SnapResult = { maker: string; model: string; sub_model: string; gen_code: string; year_start?: string; year_end?: string; variant?: string; trim_name?: string; fuel_type?: string; engine_cc?: string; seats?: string; drive_type?: string; confidence: 'high' | 'medium' | 'low' };

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
// 학습 정규화 — 엔카/시트 표기를 매칭 가능 값으로. 실측(v3 522매물): 이 둘로 99%→100% 매칭.
//  · 연식 "17년식"/"2017-03" → 2017 (매처가 Number()로 NaN 되던 구멍)
//  · 연료 별칭 휘발유=가솔린·경유=디젤·엘피지=lpg 등
export function parseYear(y: unknown): number { const m = /(\d{2,4})/.exec(String(y ?? '')); if (!m) return 0; const n = Number(m[1]); return n > 1900 ? n : n < 50 ? 2000 + n : 1900 + n; }
const FUEL_ALIAS: Record<string, string> = { 휘발유: '가솔린', 가솔린: '가솔린', 경유: '디젤', 디젤: '디젤', 엘피지: 'lpg', lpg: 'lpg', 하이브리드: '하이브리드', 전기: '전기', 수소: '수소' };
export const normFuel = (f: unknown) => { const n = norm(f); return FUEL_ALIAS[n] ?? n; };
// 제조사 그룹 별칭 — 구데이터 오라벨(제네시스 G90/GV60이 '현대'로) + 표기흔들림(르노삼성=르노코리아=르노(삼성)) 흡수.
//   같은 그룹은 제조사 풀을 공유 → 모델 하드락이 G90을 제네시스에서 찾아 잠금(모델이 최종 판별하므로 안전).
const MAKER_GROUPS: string[][] = [
  ['현대', '제네시스'],
  ['르노', '르노코리아', '르노삼성', '르노(삼성)', '삼성'],
  ['쉐보레', 'gm', '한국지엠', '지엠', '지엠대우', '대우'],
  ['벤츠', '메르세데스', '메르세데스벤츠', '메르세데스-벤츠'],
  ['kg모빌리티', '쌍용', '케이지모빌리티', 'kgm', '쌍용자동차'],
];
const _MG: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const g of MAKER_GROUPS) { const ng = g.map(norm); for (const k of ng) m.set(k, ng); }
  return m;
})();
// 제조사 → 같은 그룹의 정규화 별칭 목록(그룹 없으면 자기자신).
export const makerGroup = (m: string): string[] => {
  if (_MG.has(m)) return _MG.get(m)!;
  for (const [k, g] of _MG) if (m.includes(k) || k.includes(m)) return g; // 부분일치(르노(삼성)⊃르노)
  return [m];
};
// 세대 추론 연식 = 연식(모델연도) 우선 → 최초등록일은 참고/보조(연식 없을 때만).
//  최초등록일은 실제 등록 시점이라 모델연도보다 늦을 수 있어 우선하지 않음(사용자 지시: "참고용"). 실측(v3) 둘 다 있을 때 0건 불일치.
export const carYear = (p: EntityRecord): number => parseYear(p.year) || parseYear(p.first_registration_date);
const grams = (s: string) => { const g = new Set<string>(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
const sim = (a: string, b: string): number => {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (nb.includes(na) || na.includes(nb)) return 0.75;
  const ga = grams(na), gb = grams(nb); if (!ga.size || !gb.size) return 0;
  let inter = 0; ga.forEach((x) => { if (gb.has(x)) inter++; });
  return inter / Math.max(ga.size, gb.size);
};

export function snapToMaster(p: EntityRecord, entries: MasterEntry[]): SnapResult | null {
  const maker = norm(p.maker), model = norm(p.model), sub = norm(p.sub_model), year = carYear(p);
  if (!maker && !model && !sub) return null;

  // ── 1단계: 제조사 잠금 ── (아반떼→현대). 그룹 별칭으로 제네시스↔현대·르노 표기흔들림 흡수. 불명이면 전체.
  const mg = maker ? makerGroup(maker) : [];
  const sameMaker = (em: string) => mg.some((g) => em === g || em.includes(g) || g.includes(em));
  let pool = maker ? entries.filter((e) => sameMaker(norm(e.maker))) : entries;
  if (!pool.length) pool = entries;
  if (!pool.length) return null;

  // ── 2단계: 모델 하드 잠금 ── 풀 안 distinct 모델 중 매물 model/sub_model 과 최적 1개로 고정.
  //   "아반떼면 아반떼 안에서만" — 이후 세대·variant·트림은 이 모델 밖으로 못 나감(교차오염 차단).
  let lockedModel: string | null = null, modelSim = 0;
  for (const em of new Set(pool.map((e) => e.model))) {
    const s = Math.max(model ? sim(String(p.model), em) : 0, sub ? sim(String(p.sub_model), em) : 0);
    if (s > modelSim) { modelSim = s; lockedModel = em; }
  }
  const locked = (lockedModel && modelSim > 0.4) ? pool.filter((e) => e.model === lockedModel) : pool;

  // ── 3단계: 세대 좁히기 ── 잠긴 모델 안에서 연식(주근거)+세부명으로. 연식 벗어난 세대는 감점 배제.
  const scored = locked.map((e) => {
    let s = 0;
    if (sub) s += sim(String(p.sub_model), e.sub_model) * 2.2 + sim(String(p.sub_model), e.title || '') * 0.5;
    const ys = Number(e.year_start) || 0, ye = /\d{4}/.test(String(e.year_end)) ? Number(e.year_end) : 9999;
    if (year && ys) {
      if (year >= ys && year <= ye) s += 3;                                    // 연식이 세대 범위 안 = 강가점
      else if (year >= ys - 1 && year <= ye + 1) s += 1.2;                     // 경계 ±1
      else s -= Math.min(3, (year < ys ? ys - year : year - ye) * 0.6);        // 벗어난 세대 배제
    }
    return { e, s };
  }).sort((a, b) => b.s - a.s);

  const best = scored[0];
  if (!best) return null;
  const e = best.e;

  const fuel = normFuel(p.fuel_type), disp = (Number(p.engine_cc) || 0) / 1000;
  let variant: MasterVariant | undefined;
  if (e.variants?.length) {
    variant = e.variants.map((v) => {
      let vs = 0;
      const vf = normFuel(v.fuel);
      if (fuel && vf === fuel) vs += 2; else if (fuel && vf && (vf.includes(fuel) || fuel.includes(vf))) vs += 1;
      if (disp && v.displacement_l) vs += Math.max(0, 1 - Math.abs(v.displacement_l - disp) * 1.2);
      return { v, vs };
    }).sort((a, b) => b.vs - a.vs)[0]?.v;
  }

  let trim: string | undefined;
  const trimSrc = variant?.trims?.length ? variant.trims : (e.trims || []);
  if (p.trim_name && trimSrc.length) { const t = trimSrc.map((x) => ({ x, ts: sim(String(p.trim_name), x) })).sort((a, b) => b.ts - a.ts)[0]; if (t && t.ts >= 0.35) trim = t.x; }

  // 확신도 = 모델락 강도 × 세대 확정도. 모델을 못 잠갔으면(modelSim 낮음) 저신뢰 = 사람 검토.
  const confidence: SnapResult['confidence'] = (modelSim >= 0.7 && best.s >= 3) ? 'high' : (modelSim >= 0.45 && best.s >= 0.5) ? 'medium' : 'low';
  return {
    maker: e.maker, model: e.model, sub_model: e.sub_model, gen_code: e.gen_code,
    year_start: e.year_start, year_end: e.year_end,
    variant: variant?.label, trim_name: trim,
    fuel_type: variant?.fuel || undefined,
    engine_cc: variant?.displacement_l ? String(Math.round(variant.displacement_l * 1000)) : undefined,
    seats: variant?.seat ? String(variant.seat) : undefined,
    drive_type: variant?.drivetrain || undefined,
    confidence,
  };
}

/**
 * applySnap — 스냅 결과를 매물 레코드에 계단식으로 반영(SSOT). 페이지·일괄 재구현 공용.
 *   · 신원(제조사·모델·세부·세대·variant) = 트리 노드로 덮어쓰기(원본은 evidence였을 뿐).
 *   · 스펙(연료·배기량·인승·구동·트림) = 노드 값 우선, 노드에 없을 때만 원본 유지.
 *   · vehicle_class = 재분류. 결과는 항상 "트리의 실재 경로 하나"(가짜 조합 불가).
 */
export function applySnap(rec: EntityRecord, res: SnapResult): EntityRecord {
  const keep = (nodeVal: string | undefined, raw: unknown) => (nodeVal != null && nodeVal !== '' ? nodeVal : String(raw ?? '') || '');
  const next: EntityRecord = {
    ...rec,
    maker: res.maker, model: res.model, sub_model: res.sub_model, catalog_id: res.gen_code,
    gen_year_start: res.year_start ?? rec.gen_year_start, gen_year_end: res.year_end ?? rec.gen_year_end, // 세대 생산 시작~종료(차량 연식과 별개)
    variant: res.variant || rec.variant,
    trim_name: res.trim_name || rec.trim_name,
    fuel_type: keep(res.fuel_type, rec.fuel_type),
    engine_cc: keep(res.engine_cc, rec.engine_cc),
    seats: keep(res.seats, rec.seats),
    drive_type: keep(res.drive_type, rec.drive_type),
    _snap_confidence: res.confidence,
  };
  next.vehicle_class = classifyVehicleClass(next) || String(rec.vehicle_class ?? ''); // 차종 SSOT 재분류(쏘렌토=중형 SUV)
  return next;
}

/**
 * reconcileToMaster — 매물 배열 전체를 차종마스터에 재스냅(일괄 재구현). 원자→트리경로.
 *   반환 = { key, patch(변경필드만), confidence, matched } 목록 + 집계. 저장은 호출측(store.bulkPatch).
 */
export function reconcileToMaster(products: EntityRecord[], entries: MasterEntry[]): {
  patches: { key: string; patch: EntityRecord; confidence: SnapResult['confidence'] }[];
  matched: number; high: number; medium: number; low: number; unmatched: number;
} {
  const patches: { key: string; patch: EntityRecord; confidence: SnapResult['confidence'] }[] = [];
  let high = 0, medium = 0, low = 0, unmatched = 0;
  for (const p of products) {
    const key = String(p._key ?? p.product_code ?? '');
    if (!key) continue;
    const res = snapToMaster(p, entries);
    if (!res) { unmatched++; continue; }
    if (res.confidence === 'high') high++; else if (res.confidence === 'medium') medium++; else low++;
    const applied = applySnap(p, res);
    // patch = 변경/추가된 정규화 필드만(원본 통째로 재기록 방지, 멀티패스 write 최소화)
    const patch: EntityRecord = {
      maker: applied.maker, model: applied.model, sub_model: applied.sub_model, catalog_id: applied.catalog_id,
      gen_year_start: applied.gen_year_start, gen_year_end: applied.gen_year_end,
      variant: applied.variant, trim_name: applied.trim_name,
      fuel_type: applied.fuel_type, engine_cc: applied.engine_cc, seats: applied.seats, drive_type: applied.drive_type,
      vehicle_class: applied.vehicle_class, _snap_confidence: res.confidence,
    };
    patches.push({ key, patch, confidence: res.confidence });
  }
  return { patches, matched: patches.length, high, medium, low, unmatched };
}
