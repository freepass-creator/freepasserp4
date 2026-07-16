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
const FUEL_ALIAS: Record<string, string> = { 휘발유: '가솔린', 가솔린: '가솔린', 경유: '디젤', 디젤: '디젤', 엘피지: 'lpg', lpg: 'lpg', 하이브리드: '하이브리드', hev: '하이브리드', 전기: '전기', ev: '전기', 수소: '수소' };
// 부분일치까지 — "가솔린2.0"·"HEV1.6"·"LPG 2.0" 처럼 연료 뒤에 배기량 붙는 실표기 흡수.
export const normFuel = (f: unknown) => { const n = norm(f); if (FUEL_ALIAS[n]) return FUEL_ALIAS[n]; for (const k of Object.keys(FUEL_ALIAS)) if (n.includes(k)) return FUEL_ALIAS[k]; return n; };
// 제조사 그룹 별칭 — 구데이터 오라벨(제네시스 G90/GV60이 '현대'로) + 표기흔들림(르노삼성=르노코리아=르노(삼성)) 흡수.
//   같은 그룹은 제조사 풀을 공유 → 모델 하드락이 G90을 제네시스에서 찾아 잠금(모델이 최종 판별하므로 안전).
const MAKER_GROUPS: string[][] = [
  ['현대', '기아', '제네시스', '제네사스'],                                  // 현대·기아·제네시스 상시혼동(카니발=기아·EV6=기아·G80=제네시스). 모델락이 갈라줌
  ['르노', '르노코리아', '르노삼성', '르노(삼성)', '삼성'],
  ['쉐보레', '쉐보래', 'gm', 'gm대우', '한국지엠', '지엠', '지엠대우', '대우'],   // 쉐보래=오타·GM대우
  ['벤츠', '메르세데스', '메르세데스벤츠', '메르세데스-벤츠'],
  ['kg모빌리티', '쌍용', '케이지모빌리티', 'kgm', '쌍용자동차'],
  ['도요타', '토요타'],                                                     // 토요타=표기변형
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
// 트림의 모델연식 표기("25MY"·"25년") — 연식/최초등록 없을 때만. 트림의 배기량숫자 오독 방지 위해 MY/년 패턴만.
const trimYear = (t: unknown): number => { const m = /(\d{2})\s?my\b/i.exec(String(t ?? '')) || /(\d{2})년(?!식)/.exec(String(t ?? '')); return m ? 2000 + Number(m[1]) : 0; };
// 세대 추론 연식 = 연식(모델연도) 우선 → 최초등록일 → 트림MY 순 보조(연식 없을 때만).
//  최초등록일은 실제 등록 시점이라 모델연도보다 늦을 수 있어 우선하지 않음(사용자 지시: "참고용"). 실측(v3) 둘 다 있을 때 0건 불일치.
export const carYear = (p: EntityRecord): number => parseYear(p.year) || parseYear(p.first_registration_date) || trimYear(p.trim_name);

// ── 모델 정규화 ── 공급사 표기를 마스터 모델명으로. 실측 L2 96%→100%.
//  · 제조사 접두 제거("벤츠 E클래스"→E클래스, "아우디 A6"→A6) — 수입차 공급사 습관
//  · 세대 접두 제거("더뉴 카니발"→카니발, "디올뉴 스포티지"→스포티지)
//  · 클래스/약칭 별칭(E클래스→E-클래스, 팰리→팰리세이드)
//  · model=제조사만("테슬라") → sub_model 이 모델신호
const GEN_PREF = ['디올뉴', '올뉴', '더뉴', '신형'];
const IMPORT_MK = ['벤츠', '메르세데스', 'bmw', '아우디', '테슬라', '볼보', '미니', '폭스바겐', '지프', '포드', '렉서스'];
const MODEL_ALIAS: Record<string, string> = { e클래스: 'e-클래스', c클래스: 'c-클래스', s클래스: 's-클래스', a클래스: 'a-클래스', b클래스: 'b-클래스', g클래스: 'g-클래스', 팰리: '팰리세이드', 아반데: '아반떼', 그랜져: '그랜저', 소나타: '쏘나타', 펠리세이드: '팰리세이드' };
const stripMaker = (raw: string, mk: string): string => { let m = raw.trim(); for (const x of [mk, ...IMPORT_MK]) { const nx = x.trim(); if (nx && m.toLowerCase().startsWith(nx.toLowerCase()) && m.length > nx.length) m = m.slice(nx.length).trim(); } return m; };
export function normModel(model: unknown, maker: unknown, sub: unknown): string {
  const mk = String(maker ?? '');
  let nm = norm(stripMaker(String(model ?? ''), mk));
  for (const g of GEN_PREF) if (nm.startsWith(g) && nm.length > g.length) { nm = nm.slice(g.length); break; }
  nm = MODEL_ALIAS[nm] ?? nm;
  if (!nm || nm === norm(mk)) nm = norm(stripMaker(String(sub ?? ''), mk)); // 모델=제조사만 → sub로
  return nm;
}
// 세부모델에서 모델명만 추출(제조사·세대접두·세대코드 제거) — P3(모델↔세부 충돌 시 세부 우선) 락용.
function modelFromSub(sub: unknown, maker: unknown, codes: Set<string>): string {
  let s = stripMaker(String(sub ?? ''), String(maker ?? ''));
  for (const t of s.match(/[A-Za-z]{1,3}\d{1,3}[A-Za-z]?|[A-Za-z]{2,4}/g) || []) if (codes.has(t.toUpperCase())) s = s.replace(t, '');
  let nm = norm(s);
  for (const g of GEN_PREF) if (nm.startsWith(g) && nm.length > g.length) { nm = nm.slice(g.length); break; }
  return nm;
}
// ── 세대코드 추출 ── sub_model 에 박힌 마스터 세대코드(NQ5·W214·CN7·KA4)를 직접 잡아 세대 확정.
let _genCache: { entries: MasterEntry[]; codes: Set<string> } | null = null;
const genCodes = (entries: MasterEntry[]): Set<string> => {
  if (_genCache && _genCache.entries === entries) return _genCache.codes;
  const codes = new Set<string>();
  for (const e of entries) { const g = String(e.gen_code ?? '').trim().toUpperCase(); if (g.length >= 2) codes.add(g); }
  _genCache = { entries, codes };
  return codes;
};
const extractGen = (sub: unknown, codes: Set<string>): string | null => {
  const toks = String(sub ?? '').match(/[A-Za-z]{1,3}\d{1,3}[A-Za-z]?|[A-Za-z]{2,4}/g) || [];
  for (const t of toks) if (codes.has(t.toUpperCase())) return t.toUpperCase();
  return null;
};
// ── "N세대" 서수 매핑 ── 공급사가 "더 뉴 K5 3세대"처럼 서수로 적으면 세대코드(DL3)를 못 읽던 구멍.
//   모델별 세대코드를 연대순(year_start)으로 나열 → N세대 = N번째 세대코드.
let _ordCache: { entries: MasterEntry[]; order: Map<string, string[]> } | null = null;
const genOrder = (entries: MasterEntry[]): Map<string, string[]> => {
  if (_ordCache && _ordCache.entries === entries) return _ordCache.order;
  const firstYear = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const g = e.gen_code, ys = Number(e.year_start);
    if (!g || !Number.isFinite(ys)) continue;
    let mm = firstYear.get(e.model); if (!mm) { mm = new Map(); firstYear.set(e.model, mm); }
    const prev = mm.get(g); if (prev == null || ys < prev) mm.set(g, ys);
  }
  const order = new Map<string, string[]>();
  for (const [model, gm] of firstYear) order.set(model, [...gm.entries()].sort((a, b) => a[1] - b[1]).map(([g]) => g));
  _ordCache = { entries, order };
  return order;
};
const ordinalGen = (text: unknown): number => { const m = /([1-9])\s*세대/.exec(String(text ?? '')); return m ? Number(m[1]) : 0; };
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
  if (!model && !sub) return null; // P4(사용자 정책): 제조사만 있고 모델·세부 공란 = 매칭 안 함(미분류로 사람이 채움)

  // ── 1단계: 제조사 잠금 ── (아반떼→현대). 그룹 별칭으로 제네시스↔현대·르노 표기흔들림 흡수. 불명이면 전체.
  const mg = maker ? makerGroup(maker) : [];
  const sameMaker = (em: string) => mg.some((g) => em === g || em.includes(g) || g.includes(em));
  let pool = maker ? entries.filter((e) => sameMaker(norm(e.maker))) : entries;
  if (!pool.length) pool = entries;
  if (!pool.length) return null;

  // ── 2단계: 모델 하드 잠금 ── 풀 안 distinct 모델 중 매물 model/sub_model 과 최적 1개로 고정.
  //   "아반떼면 아반떼 안에서만" — 이후 세대·variant·트림은 이 모델 밖으로 못 나감(교차오염 차단).
  const codes = genCodes(entries);
  const pmodel = normModel(p.model, p.maker, p.sub_model);      // 제조사·세대 접두 벗긴 모델신호(모델칸)
  const subModel = modelFromSub(p.sub_model, p.maker, codes);   // 세부에서 뽑은 모델명(P3: 모델↔세부 충돌 시 우선)
  let lockedModel: string | null = null, modelSim = 0;
  for (const em of new Set(pool.map((e) => e.model))) {
    const nem = norm(em);
    // P3(사용자 정책): 세부모델 우선(full) > 모델칸(0.9) > 전체sub유사(0.85). 베뉴(모델)vs카니발(세부)→카니발
    let s = Math.max(sim(subModel, em), sim(pmodel, em) * 0.9, sub ? sim(String(p.sub_model), em) * 0.85 : 0);
    if (nem && sub.includes(nem)) s += 0.02 * nem.length;   // 구체성 우선 — sub에 전체 모델명 포함 시 더 긴 모델(A6 e-트론 > A6)
    if (s > modelSim) { modelSim = s; lockedModel = em; }
  }
  const locked = (lockedModel && modelSim > 0.4) ? pool.filter((e) => e.model === lockedModel) : pool;

  // ── 3단계: 세대 좁히기 ── 잠긴 모델 안에서 세부명·트림·세대코드·연식·파워트레인 종합.
  const pgen = extractGen(p.sub_model, codes);   // sub에 명시된 세대코드(NQ5·W214)
  const ord = ordinalGen(p.sub_model) || ordinalGen(p.trim_name);   // "3세대" 서수
  const orderList = lockedModel ? (genOrder(entries).get(lockedModel) || []) : [];
  const targetGen = (ord >= 1 && ord <= orderList.length) ? orderList[ord - 1] : null; // N세대 → 연대순 N번째
  const pfuel = normFuel(p.fuel_type);
  const scored = locked.map((e) => {
    let s = 0;
    if (sub) s += sim(String(p.sub_model), e.sub_model) * 2.2 + sim(String(p.sub_model), e.title || '') * 0.5;
    if (p.trim_name) s += sim(String(p.trim_name), e.sub_model) * 1.0;              // 트림의 세대신호(뉴라이즈→페이스리프트)
    const genLock = (pgen && String(e.gen_code).toUpperCase() === pgen) || (targetGen && e.gen_code === targetGen);
    if (genLock) s += 5;                                                            // 세대코드 명시(NQ5) 또는 "N세대" 서수 = 지배적
    const ys = Number(e.year_start) || 0, ye = /\d{4}/.test(String(e.year_end)) ? Number(e.year_end) : 9999;
    // P2(사용자 정책): 세대가 확정(genLock)되면 연식 무시(연식칸 오기 잦음). 아니면 연식으로 세대 좁힘.
    if (year && ys && !genLock) {
      if (year >= ys && year <= ye) s += 3;                                    // 연식이 세대 범위 안 = 강가점
      else if (year >= ys - 1 && year <= ye + 1) s += 1.2;                     // 경계 ±1
      else s -= Math.min(3, (year < ys ? ys - year : year - ye) * 0.6);        // 벗어난 세대 배제
    } else if (year && ys && genLock && year >= ys && year <= ye) s += 1;      // 세대확정+연식도 맞으면 소폭 보강
    if (pfuel && e.variants?.length) {                                             // 파워트레인으로 세대 제약(하이브리드=KA4 전용 등)
      const fuels = new Set(e.variants.map((v) => normFuel(v.fuel)));
      if (fuels.has(pfuel)) s += 0.8;
      else if (pfuel === '하이브리드' || pfuel === '전기') s -= 2;                  // 해당 연료 없는 세대 강배제
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

  // P1(사용자 정책): 세부모델 우선하되, 트림이 잠긴 모델과 "다른 모델"을 강하게 가리키면 저신뢰(사람 검토).
  //   예: 세부=K5인데 트림="K7 프리미어..." → K5로 두되 검토표시.
  let trimConflict = false;
  if (p.trim_name && lockedModel) {
    for (const om of new Set(pool.map((x) => x.model))) { if (norm(om) !== norm(lockedModel) && sim(String(p.trim_name), om) >= 0.75) { trimConflict = true; break; } }
  }
  // 확신도 = 모델락 강도 × 세대 확정도. 모델 못 잠갔거나 트림충돌이면 저신뢰. (구체성 보너스로 1 초과 가능 → 캡)
  const ms = Math.min(modelSim, 1);
  const confidence: SnapResult['confidence'] = trimConflict ? 'low' : (ms >= 0.7 && best.s >= 3) ? 'high' : (ms >= 0.45 && best.s >= 0.5) ? 'medium' : 'low';
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
  // 원본 보존(최초 1회만) — 직접입력값을 영구 스냅샷. "직접입력 vs 변환" 나중에 확인 가능(사용자 지시).
  const rawVehicle = (rec._raw_vehicle && typeof rec._raw_vehicle === 'object') ? rec._raw_vehicle : {
    maker: rec.maker ?? '', model: rec.model ?? '', sub_model: rec.sub_model ?? '', variant: rec.variant ?? '',
    trim_name: rec.trim_name ?? '', fuel_type: rec.fuel_type ?? '', engine_cc: rec.engine_cc ?? '', vehicle_class: rec.vehicle_class ?? '',
  };
  const next: EntityRecord = {
    ...rec,
    _raw_vehicle: rawVehicle,          // 직접입력 원본(영구 보존)
    _snapped: true,                    // 변환됨 표시 — 직접입력과 구분
    _snap_confidence: res.confidence,
    maker: res.maker, model: res.model, sub_model: res.sub_model, catalog_id: res.gen_code,
    gen_year_start: res.year_start ?? rec.gen_year_start, gen_year_end: res.year_end ?? rec.gen_year_end, // 세대 생산 시작~종료(차량 연식과 별개)
    variant: res.variant || rec.variant,
    trim_name: res.trim_name || rec.trim_name,
    fuel_type: keep(res.fuel_type, rec.fuel_type),
    engine_cc: keep(res.engine_cc, rec.engine_cc),
    seats: keep(res.seats, rec.seats),
    drive_type: keep(res.drive_type, rec.drive_type),
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
      _raw_vehicle: applied._raw_vehicle, _snapped: true,   // 원본 보존 + 변환 표시(직접입력과 구분)
    };
    patches.push({ key, patch, confidence: res.confidence });
  }
  return { patches, matched: patches.length, high, medium, low, unmatched };
}
