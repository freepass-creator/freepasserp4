/**
 * 매물(product) 도메인 — 가격맵·차량명·정책조건·검색필터. (freepasserp3 product-filters/policy 이식)
 * product는 정책(_policy, ~30필드)을 물고 옴 → 검색·상세가 정책조건까지 포함.
 */
import type { EntityRecord } from '@/lib/intake/entities';

const num = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n; };

export type Price = { m: number; rent: number; deposit: number; fee: number };
export type Policy = Record<string, unknown>;

export function policyOf(p: EntityRecord): Policy { return (p._policy || {}) as Policy; }

/** 기간별 가격 목록 (m 오름차순) */
export function priceList(p: EntityRecord): Price[] {
  const price = (p.price || {}) as Record<string, { rent?: number; deposit?: number; fee?: number }>;
  return Object.entries(price)
    .map(([k, v]) => ({ m: Number(k.includes('_') ? k.slice(0, k.indexOf('_')) : k), rent: num(v?.rent), deposit: num(v?.deposit), fee: num(v?.fee) }))
    .filter((e) => e.rent > 0).sort((a, b) => a.m - b.m);
}

/** 선택 기간의 가격 (없으면 가장 가까운 기간) */
export function priceAt(p: EntityRecord, target: number): Price | null {
  const l = priceList(p);
  if (!l.length) return null;
  return l.find((e) => e.m === target) || l.slice().sort((a, b) => Math.abs(a.m - target) - Math.abs(b.m - target))[0];
}

export function vehicleName(p: EntityRecord): string {
  return [p.maker, p.sub_model || p.model, p.trim_name].filter(Boolean).join(' ') || String(p.car_number || '차량');
}

/** 심사표기 — 소득무관 / 소득확인 (정책 screening_criteria 우선) */
export function creditDisplay(p: EntityRecord): string {
  const v = String(policyOf(p).screening_criteria || p.screening_criteria || p.credit_grade || '');
  if (/무심사|신용 *무관|소득 *무관|저신용/.test(v)) return '소득무관';
  if (/신용 *조회|신용 *필요|소득 *확인|소득 *조회|등급/.test(v)) return '소득확인';
  return v || '소득무관';
}
export function isReview(p: EntityRecord): boolean { return creditDisplay(p) === '소득확인'; }
/** 무보증(보증금 0 상품) — 저신용 손님의 핵심 진입장벽 해소. 영업자 셀링포인트. */
export function noDeposit(p: EntityRecord): boolean { return priceList(p).some((x) => x.deposit === 0 && x.rent > 0); }
/** 최저 월대여료 상품(카드 헤드라인) — 영업자·손님이 제일 먼저 보는 값. */
export function cheapest(p: EntityRecord): Price | null { const l = priceList(p); return l.length ? l.reduce((a, b) => (b.rent < a.rent ? b : a)) : null; }
export function cheapestRent(p: EntityRecord): number { const c = cheapest(p); return c ? c.rent : Infinity; }
/** 최저 운전가능 연령 — 정책 기본연령/연령하향 중 최소. 21 가능 = 젊은 손님 셀링포인트(딱지). */
const twoDigit = (s: unknown): number => { const m = String(s ?? '').match(/(\d{2})/); return m ? Number(m[1]) : 0; };
export function minAge(p: EntityRecord): number {
  const pol = policyOf(p);
  const cands = [twoDigit(pol.basic_driver_age), twoDigit(pol.driver_age_lowering)].filter((a) => a >= 18 && a <= 40);
  return cands.length ? Math.min(...cands) : 0;
}
/** 운전경력 1년 미만 가능 여부(면허취득 제한) — 초년 운전자 손님 셀링포인트(딱지). */
export function shortExperience(p: EntityRecord): boolean {
  const lp = String(policyOf(p).license_period || '');
  if (!lp) return false;
  if (/제한없음|무관/.test(lp)) return true;
  if (/개월/.test(lp)) return true; // "3·6개월 이상" = 1년 미만도 가능
  return false; // "1년 이상"+
}

export function vehicleTone(s: string): 'green' | 'blue' | 'amber' | 'gray' | 'red' {
  return ({ 즉시출고: 'green', 출고가능: 'green', 출고준비: 'amber', 출고협의: 'blue', 출고불가: 'red' } as Record<string, 'green' | 'blue' | 'amber' | 'gray' | 'red'>)[s] || 'gray';
}

/* ── 매물 상세 = 정책 전면(스펙·대여조건·보험·운전자). freepasserp3 product-detail-rows 이식 ── */
export type Row = [string, unknown];
export function detailSections(p: EntityRecord, period: number): { title: string; rows: Row[] }[] {
  const pol = policyOf(p);
  const pr = priceAt(p, period);
  const g = (k: string) => pol[k] ?? '';
  return [
    { title: '차량', rows: [
      ['차량번호', p.car_number], ['제조사', p.maker], ['세부모델', p.sub_model], ['트림', p.trim_name],
      ['연식', p.year], ['연료', p.fuel_type], ['주행거리', p.mileage ? `${Number(p.mileage).toLocaleString()}km` : ''],
      ['색상', [p.ext_color, p.int_color].filter(Boolean).join(' / ')], ['차종', p.vehicle_class],
      ['상품구분', p.product_type], ['상태', p.vehicle_status], ['공급사', p.provider_company_code],
    ] },
    { title: '대여 조건', rows: [
      [`월대여료(${pr ? pr.m : period}개월)`, pr ? `${pr.rent.toLocaleString()}원` : '문의'],
      ['보증금', pr ? `${pr.deposit.toLocaleString()}원` : '—'],
      ['심사', creditDisplay(p)], ['약정 주행거리', g('annual_mileage')], ['1만km 추가', g('mileage_upcharge_per_10000km')],
      ['결제방식', g('payment_method')], ['보증금 분납', g('deposit_installment')], ['보증카드', g('deposit_card_payment')],
      ['위약금', g('penalty_condition')], ['대여지역', g('rental_region')], ['탁송비', g('delivery_fee')],
    ] },
    { title: '보험', rows: [
      ['대인', g('injury_compensation_limit')], ['대물', g('property_compensation_limit')], ['자손', g('self_body_accident')],
      ['무보험', g('uninsured_damage')], ['자차', g('own_damage_compensation')], ['자차 자기부담', g('own_damage_repair_ratio')],
      ['긴급출동', g('annual_roadside_assistance')], ['정비', g('maintenance_service')], ['보험료', g('insurance_included')],
    ] },
    { title: '운전자', rows: [
      ['기본연령', g('basic_driver_age')], ['연령상한', g('driver_age_upper_limit')], ['연령하향', g('driver_age_lowering')],
      ['하향비용', g('age_lowering_cost')], ['개인범위', g('personal_driver_scope')], ['사업자범위', g('business_driver_scope')],
      ['추가운전자', g('additional_driver_allowance_count')], ['추가운전비', g('additional_driver_cost')],
    ] },
  ];
}
