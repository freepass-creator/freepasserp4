/**
 * 차종 SSOT 매칭 — 매물의 (거친/부분) 차종 정보를 차종마스터(vehicle-master 1805세대)의 실재 조합으로 스냅.
 * freepasserp3 snapToSsot 취지 이식(간소화): 제조사→모델/세부모델 유사도 + 연식 세대 + 파워트레인(연료·배기량) + 트림.
 * 반환은 후보(confidence). 자동 확정 아님 — 폼에서 사용자 검토 후 반영(오분류 방어).
 */
import { type EntityRecord } from '@/lib/intake/entities';

export type MasterVariant = { label: string; fuel: string; displacement_l: number | null; turbo: boolean; drivetrain: string | null; seat: number | null; battery_kwh: number | null; trims: string[] };
export type MasterEntry = { id: string; maker: string; model: string; sub_model: string; gen_code: string; origin: string; year_start: string; year_end: string; title?: string; variants: MasterVariant[]; trims?: string[] };
export type SnapResult = { maker: string; model: string; sub_model: string; gen_code: string; variant?: string; trim_name?: string; fuel_type?: string; engine_cc?: string; seats?: string; drive_type?: string; confidence: 'high' | 'medium' | 'low' };

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
// 학습 정규화 — 엔카/시트 표기를 매칭 가능 값으로. 실측(v3 522매물): 이 둘로 99%→100% 매칭.
//  · 연식 "17년식"/"2017-03" → 2017 (매처가 Number()로 NaN 되던 구멍)
//  · 연료 별칭 휘발유=가솔린·경유=디젤·엘피지=lpg 등
export function parseYear(y: unknown): number { const m = /(\d{2,4})/.exec(String(y ?? '')); if (!m) return 0; const n = Number(m[1]); return n > 1900 ? n : n < 50 ? 2000 + n : 1900 + n; }
const FUEL_ALIAS: Record<string, string> = { 휘발유: '가솔린', 가솔린: '가솔린', 경유: '디젤', 디젤: '디젤', 엘피지: 'lpg', lpg: 'lpg', 하이브리드: '하이브리드', 전기: '전기', 수소: '수소' };
export const normFuel = (f: unknown) => { const n = norm(f); return FUEL_ALIAS[n] ?? n; };
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
  const maker = norm(p.maker), model = norm(p.model), sub = norm(p.sub_model), year = parseYear(p.year);
  if (!maker && !model && !sub) return null;

  let cands = maker ? entries.filter((e) => { const em = norm(e.maker); return em === maker || em.includes(maker) || maker.includes(em); }) : entries;
  if (!cands.length && model) cands = entries.filter((e) => sim(String(p.model), e.model) > 0.5 || norm(e.sub_model).includes(model)); // maker 추론(모델로)
  if (!cands.length) return null;

  const scored = cands.map((e) => {
    let s = 0;
    if (model) { const ms = sim(String(p.model), e.model); if (ms >= 0.99) s += 2; else if (ms > 0.4) s += ms * 1.5; }
    if (sub) s += sim(String(p.sub_model), e.sub_model) * 3 + sim(String(p.sub_model), e.title || '') * 1;
    const ys = Number(e.year_start) || 0, ye = /\d{4}/.test(String(e.year_end)) ? Number(e.year_end) : 9999;
    if (year && ys && year >= ys - 1 && year <= ye + 1) s += 1.5;
    return { e, s };
  }).sort((a, b) => b.s - a.s);

  const best = scored[0];
  if (!best || best.s <= 0.3) return null;
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

  const confidence: SnapResult['confidence'] = best.s >= 4 ? 'high' : best.s >= 2 ? 'medium' : 'low';
  return {
    maker: e.maker, model: e.model, sub_model: e.sub_model, gen_code: e.gen_code,
    variant: variant?.label, trim_name: trim,
    fuel_type: variant?.fuel || undefined,
    engine_cc: variant?.displacement_l ? String(Math.round(variant.displacement_l * 1000)) : undefined,
    seats: variant?.seat ? String(variant.seat) : undefined,
    drive_type: variant?.drivetrain || undefined,
    confidence,
  };
}
