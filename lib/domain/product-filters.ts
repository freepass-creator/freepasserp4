/**
 * 매물 검색 필터 엔진 — freepasserp3 product-filters.js(19종) 참고, 각 그룹 OR·그룹간 AND.
 * 정적 밴드(대여료·보증금·주행) + 정적 enum(연료·상품구분·심사·출고·프로모) + 동적 집계.
 *
 * 필터 ↔ 카드 SSOT (옵션은 entities / product 파생만 — 여기 복제 금지)
 *  · CORE → 카드 필수 슬롯
 *      기간·월대여·보증 → PriceHero
 *      상품구분 → CardKind / rail pt
 *      출고상태 → rail st
 *      심사 → rail/thumb cd
 *      연료(+연식·주행) → specLine / CardSpecs
 *  · OPT → 카드 비필수
 *      혜택 → CardBenefits / CardPerkLine
 *      프로모 → thumb / CardEvents
 *      주행밴드
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { PRODUCT_TYPES, FUEL_TYPES, PROMO_BADGES_ACTIVE } from '@/lib/intake/entities';
import {
  fuelDisplay,
  yearDisplay,
  parseYear,
  EMPTY_VEHICLE_FILTER,
  matchVehicleFilter,
  normalizeVehicleFilter,
  productsForVehicleStep,
  vehicleFilterCount,
  type VehicleFilter,
} from '@/lib/domain/vehicle-master-match';
import { colorDisplay } from '@/lib/domain/color-master';
import { productHaystack, matchHay, queryTokens } from '@/lib/domain/search';
export { productHaystack, matchProductQuery } from '@/lib/domain/search';
export type { VehicleFilter } from '@/lib/domain/vehicle-master-match';
export { EMPTY_VEHICLE_FILTER, normalizeVehicleFilter, vehicleFilterCount } from '@/lib/domain/vehicle-master-match';
import { priceList, creditDisplay, noDeposit, minAge, shortExperience, installmentOk, parseEventTags, isOperatedPeriod, isStandardPeriod, PERIODS, isListableProduct, canonProductType } from '@/lib/domain/product';
import { makerDisplay } from '@/lib/domain/vehicle-master-match';

/** 매물에 항상 있는 축 — 카드 필수와 1:1. */
export const CORE_FILTERS = [
  'periods',   // 기간
  'rent',      // 월대여료
  'dep',       // 보증금
  'ptype',     // 상품구분
  'credit',    // 심사
  'fuel',      // 연료(스펙)
] as const;

/** 매물에 없을 수 있음 — 카드 비필수. */
export const OPT_FILTERS = [
  'perks',     // 우대조건
  'promo',     // 프로모(event_tags)
  'mile',      // 주행밴드
] as const;

export type Band = { k: string; label: string; lo: number; hi: number };
export const RENT_BANDS: Band[] = [
  { k: 'r50', label: '50만↓', lo: 0, hi: 500000 }, { k: 'r60', label: '50~60만', lo: 500000, hi: 600000 },
  { k: 'r70', label: '60~70만', lo: 600000, hi: 700000 }, { k: 'r80', label: '70~80만', lo: 700000, hi: 800000 },
  { k: 'r90', label: '80~90만', lo: 800000, hi: 900000 }, { k: 'r100', label: '90~100만', lo: 900000, hi: 1000000 },
  { k: 'r150', label: '100~150만', lo: 1000000, hi: 1500000 }, { k: 'r200', label: '150만↑', lo: 1500000, hi: Infinity },
];
export const DEP_BANDS: Band[] = [
  { k: 'd0', label: '보증0', lo: -1, hi: 1 }, { k: 'd1', label: '100만↓', lo: 1, hi: 1000000 },
  { k: 'd2', label: '100~200만', lo: 1000000, hi: 2000000 }, { k: 'd3', label: '200~300만', lo: 2000000, hi: 3000000 }, { k: 'd4', label: '300만↑', lo: 3000000, hi: Infinity },
];
export const MILE_BANDS: Band[] = [
  { k: 'm1', label: '1만km↓', lo: -1, hi: 10000 }, { k: 'm3', label: '1~3만', lo: 10000, hi: 30000 },
  { k: 'm5', label: '3~5만', lo: 30000, hi: 50000 }, { k: 'm10', label: '5~10만', lo: 50000, hi: 100000 }, { k: 'm99', label: '10만↑', lo: 100000, hi: Infinity },
];

/** entities SSOT 재노출 — 페이지는 여기만 import. */
export const FUELS = [...FUEL_TYPES];
export const PTYPES = [...PRODUCT_TYPES];
export const PROMOS = [...PROMO_BADGES_ACTIVE];
export const CREDITS = ['무심사', '소득확인'] as const;
/** 혜택 = benefitSignals와 1:1 (만21세=연령≤21 라벨). */
export const PERKS = ['분납가능', '무보증', '만21세', '경력무관', '무사고'] as const;
/** 손님 카탈로그 — 심사와 분리된 혜택 서브셋. */
export const CATALOG_PERKS = ['무보증', '만21세', '경력무관', '무사고'] as const;

export function hasPerk(p: EntityRecord, perk: string): boolean {
  if (perk === '분납가능') return installmentOk(p);
  if (perk === '무보증') return noDeposit(p);
  if (perk === '만21세') { const a = minAge(p); return a > 0 && a <= 21; }
  if (perk === '경력무관') return shortExperience(p);
  if (perk === '무사고') return String(p.accident_history || '').replace(/\s+/g, '') === '무사고';
  return false;
}

const polGet = (p: EntityRecord, k: string): string => String((p._policy as Record<string, unknown> | undefined)?.[k] ?? '');

/** 약정주행 표기 통일 — "연간 2만Km 주행"·"연간2만km"·"20000km" 등이 한 칩으로 모이게(집계·매칭 공통).
 *  약정 km 수를 뽑아 "연간 N만Km"로 정규화. 숫자 못 뽑으면 꼬리 '주행'·공백만 정리해 원문 보존. */
export function normAnnualMileage(raw: unknown): string {
  const s0 = String(raw ?? '').trim();
  if (!s0) return '';
  const s = s0.replace(/\s+/g, '').replace(/주행$/, ''); // 공백 제거 + 꼬리 '주행' 제거
  if (/무제한|제한없/.test(s)) return '무제한';
  const man = s.match(/(\d+(?:\.\d+)?)\s*만/); // "2만", "3만"
  if (man) return `연간 ${man[1]}만Km`;
  const num = s.replace(/[^\d]/g, ''); // "20000", "20,000km"
  if (num && Number(num) >= 10000) return `연간 ${Number(num) / 10000}만Km`;
  return s.replace(/km/gi, 'Km'); // 그밖엔 km 표기만 통일해 원문 유지
}

export type DynDef = { key: string; label: string; get: (p: EntityRecord) => string };

/** 공급사 — 사이드바 맨 아래 Select. 칩 DYN과 분리. */
export const PROVIDER_FILTER: DynDef = {
  key: 'provider',
  label: '공급사',
  get: (p) => String(p.provider_name || p.provider_company_code || ''),
};
/** 오토플러스 = 드롭다운 맨 아래 고정. */
export function isProviderPinnedBottom(name: string): boolean {
  return /오토\s*플러스/i.test(String(name || ''));
}
/** 공급사 옵션 — 대수 내림차순, 오토플러스는 맨 아래. */
export function sortProviderOptions(entries: [string, number][]): { value: string; label: string }[] {
  const rest = entries
    .filter(([v]) => v && !isProviderPinnedBottom(v))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  const pin = entries
    .filter(([v]) => v && isProviderPinnedBottom(v))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  return [...rest, ...pin].map(([v]) => ({ value: v, label: v }));
}

/** 동적 칩 필터 — 차종 5단(제조사~트림)은 VehicleMasterFilter. 공급사는 PROVIDER_FILTER.
 *  사이드바 차 블록 순서 SSOT = 차종 → 색상(외·내) → 연식 → 연료 → 주행. */
export const DYN: DynDef[] = [
  { key: 'ext_color', label: '외부색상', get: (p) => colorDisplay(p.ext_color, 'ext') },
  { key: 'int_color', label: '내부색상', get: (p) => colorDisplay(p.int_color, 'int') },
  { key: 'year', label: '연식', get: (p) => yearDisplay(p.year) },
  { key: 'vehicle_class', label: '차종분류', get: (p) => String(p.vehicle_class || '') },
  { key: 'annual_mileage', label: '약정주행', get: (p) => normAnnualMileage(polGet(p, 'annual_mileage')) },
];

/** 차 관련 DYN — 사이드바에서 연료·주행 앞에 고정 배치. 나머지는 하단. */
export const CAR_DYN_KEYS = ['ext_color', 'int_color', 'year'] as const;
export const EXTRA_DYN_KEYS = ['vehicle_class', 'annual_mileage'] as const;

/** 매칭·집계용 — 칩 DYN + 공급사. */
const DYN_ALL: DynDef[] = [...DYN, PROVIDER_FILTER];

/** 필터 기간 순서 — 표준(1·12·24·36·48·60) 먼저, 그다음 비표준(6·18·…) 오름차순. */
export function sortFilterMonths(months: Iterable<number>): number[] {
  const s = new Set([...months].filter(isOperatedPeriod));
  const std = PERIODS.filter((m) => s.has(m));
  const extra = [...s].filter((m) => !isStandardPeriod(m)).sort((a, b) => a - b);
  return [...std, ...extra];
}

/** 데이터에 실제 존재하는 운영 개월수 — 기간 필터 칩용.
 *  표준 먼저, 6·18 등 비표준은 뒤에(데이터 있을 때만). */
export function operatingMonths(products: EntityRecord[]): number[] {
  const s = new Set<number>();
  for (const p of products) priceList(p).forEach((x) => { if (isOperatedPeriod(x.m)) s.add(x.m); });
  return sortFilterMonths(s);
}

/** 엑셀·xlsx 표 열 — 표준 1·12·24·36·48·60 중 데이터에 있는 것만(PERIODS 순서). */
export function excelMonths(products: EntityRecord[]): number[] {
  const s = new Set<number>();
  for (const p of products) priceList(p).forEach((x) => { if (isStandardPeriod(x.m)) s.add(x.m); });
  return PERIODS.filter((m) => s.has(m));
}

export type PresentChip = { key: string; label: string; count: number };

/** 매물에 값이 있는 필터 옵션만 — 빈 축·빈 칩은 사이드바에서 숨김. */
export function presentFilterOptions(products: EntityRecord[]): {
  months: PresentChip[];
  rent: PresentChip[];
  dep: PresentChip[];
  mile: PresentChip[];
  ptype: PresentChip[];
  credit: PresentChip[];
  fuel: PresentChip[];
  perks: PresentChip[];
  promo: PresentChip[];
  hasVehicle: boolean;
} {
  // 상품목록 모수 = 출고불가·유효 대여료 없음 제외(계약중+가격 있음은 포함·마크 노출).
  const listed = products.filter(isListableProduct);
  // 단일패스 — 매물당 priceList 1회 + 밴드·enum·혜택 카운터 동시 누적(구 countBand×N 반복스캔 제거).
  //  밴드 의미 불변: 매물이 밴드에 해당하는 값(lo < x ≤ hi)을 하나라도 가지면 +1.
  const rentCnt = RENT_BANDS.map(() => 0);
  const depCnt = DEP_BANDS.map(() => 0);
  const mileCnt = MILE_BANDS.map(() => 0);
  const ptypeCnt = new Map<string, number>();
  const creditCnt = new Map<string, number>();
  const fuelCnt = new Map<string, number>();
  const perkCnt = new Map<string, number>();
  const promoCnt = new Map<string, number>();
  const monthMap = new Map<number, number>();
  let hasVehicle = false;

  for (const p of listed) {
    const pl = priceList(p);
    for (const x of pl) {
      if (!isOperatedPeriod(x.m)) continue;
      monthMap.set(x.m, (monthMap.get(x.m) || 0) + 1);
    }
    for (let i = 0; i < RENT_BANDS.length; i++) {
      const b = RENT_BANDS[i];
      if (pl.some((x) => x.rent > b.lo && x.rent <= b.hi)) rentCnt[i]++;
    }
    for (let i = 0; i < DEP_BANDS.length; i++) {
      const b = DEP_BANDS[i];
      if (pl.some((x) => x.deposit > b.lo && x.deposit <= b.hi)) depCnt[i]++;
    }
    const km = Number(p.mileage) || 0;
    for (let i = 0; i < MILE_BANDS.length; i++) {
      const b = MILE_BANDS[i];
      if (km > b.lo && km <= b.hi) mileCnt[i]++;
    }
    const pt = canonProductType(p.product_type);
    if (pt) ptypeCnt.set(pt, (ptypeCnt.get(pt) || 0) + 1);
    const cd = creditDisplay(p);
    if (cd) creditCnt.set(cd, (creditCnt.get(cd) || 0) + 1);
    const fl = fuelDisplay(p.fuel_type) || String(p.fuel_type || '');
    if (fl) fuelCnt.set(fl, (fuelCnt.get(fl) || 0) + 1);
    for (const pk of PERKS) if (hasPerk(p, pk)) perkCnt.set(pk, (perkCnt.get(pk) || 0) + 1);
    for (const t of parseEventTags(p.event_tags || p.promo_tags)) promoCnt.set(t, (promoCnt.get(t) || 0) + 1);
    if (!hasVehicle && String(p.maker || '').trim() !== '') hasVehicle = true;
  }

  const bandChips = (bands: Band[], counts: number[]): PresentChip[] =>
    bands.map((b, i) => ({ key: b.k, label: b.label, count: counts[i] })).filter((o) => o.count > 0);

  return {
    months: sortFilterMonths(monthMap.keys()).map((m) => ({ key: String(m), label: `${m}개월`, count: monthMap.get(m)! })),
    rent: bandChips(RENT_BANDS, rentCnt),
    dep: bandChips(DEP_BANDS, depCnt),
    mile: bandChips(MILE_BANDS, mileCnt),
    // 상품구분도 모수에 있는 것만(연쇄 필터 — 빈 칩 숨김). 캐논은 canonProductType.
    ptype: PTYPES.filter((t) => (ptypeCnt.get(t) || 0) > 0).map((t) => ({ key: t, label: t, count: ptypeCnt.get(t)! })),
    credit: CREDITS.filter((v) => (creditCnt.get(v) || 0) > 0).map((v) => ({ key: v, label: v, count: creditCnt.get(v)! })),
    fuel: FUELS.filter((v) => (fuelCnt.get(v) || 0) > 0).map((v) => ({ key: v, label: v, count: fuelCnt.get(v)! })),
    perks: PERKS.map((pk) => ({ key: pk, label: pk, count: perkCnt.get(pk) || 0 })).filter((o) => o.count > 0),
    promo: PROMOS.filter((t) => (promoCnt.get(t) || 0) > 0).map((t) => ({ key: t, label: t, count: promoCnt.get(t)! })),
    hasVehicle,
  };
}

export type FState = {
  q: string; periods: Set<number>;
  rent: Set<string>; dep: Set<string>; mile: Set<string>;
  fuel: Set<string>; ptype: Set<string>;
  credit: Set<string>; perks: Set<string>; promo: Set<string>;
  dyn: Record<string, Set<string>>;
  vehicle: VehicleFilter;
};

/** 국산 제조사 — 르노(르노코리아·르노삼성)=국산. 영문 Renault 등 수입 르노는 별도(미포함). */
const DOMESTIC_MAKERS = new Set(['현대', '기아', '제네시스', '쉐보레', '르노', '르노삼성', '르노코리아', '삼성', 'KGM', 'KG모빌리티', 'KG', '쌍용', '대우', '한국지엠']);
function isDomesticMaker(raw: string): boolean {
  const v = raw.trim();
  if (!v) return false;
  if (DOMESTIC_MAKERS.has(v)) return true;
  const d = makerDisplay(v);
  if (DOMESTIC_MAKERS.has(d)) return true;
  // 국산 르노 계열(표기 흔들림) — 영문 Renault 단독은 수입으로 둠
  if (/르노/.test(v) || /르노/.test(d)) return true;
  if (/^kgm?$/i.test(d) || /모빌리티|쌍용/.test(v)) return true;
  return false;
}

export type CascadeOpt = { value: string; count: number };
/** 매물에만 있는 값으로 차종 5단 옵션 집계(상위 복수 선택으로 하위 좁힘). */
export function aggregateVehicleCascade(products: EntityRecord[], filter: VehicleFilter): {
  makers: { origin: string; options: CascadeOpt[] }[];
  models: CascadeOpt[];
  subs: CascadeOpt[];
  variants: CascadeOpt[];
  trims: CascadeOpt[];
} {
  const v = normalizeVehicleFilter(filter);
  const countField = (list: EntityRecord[], field: 'maker' | 'model' | 'sub_model' | 'variant' | 'trim_name'): CascadeOpt[] => {
    const m = new Map<string, number>();
    for (const p of list) {
      let raw = String(p[field] || '').trim();
      if (!raw) continue;
      if (field === 'maker') raw = makerDisplay(raw) || raw;
      m.set(raw, (m.get(raw) || 0) + 1);
    }
    return [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ko'));
  };

  const makersAll = countField(productsForVehicleStep(products, v, 'maker'), 'maker');
  const dom = makersAll.filter((o) => isDomesticMaker(o.value));
  const imp = makersAll.filter((o) => !isDomesticMaker(o.value));
  const makers = [
    ...(dom.length ? [{ origin: '국산', options: dom }] : []),
    ...(imp.length ? [{ origin: '수입', options: imp }] : []),
  ];

  const models = countField(productsForVehicleStep(products, v, 'model'), 'model');
  const subs = countField(productsForVehicleStep(products, v, 'sub_model'), 'sub_model');
  const variants = countField(productsForVehicleStep(products, v, 'variant'), 'variant');
  const trims = countField(productsForVehicleStep(products, v, 'trim_name'), 'trim_name');

  return { makers, models, subs, variants, trims };
}

export function aggregateDyn(products: EntityRecord[]): Record<string, [string, number][]> {
  const listed = products.filter(isListableProduct);
  const out: Record<string, [string, number][]> = {};
  for (const d of DYN_ALL) {
    const m = new Map<string, number>();
    for (const p of listed) { const v = d.get(p); if (v) m.set(v, (m.get(v) || 0) + 1); }
    // 연식 = "24년" 표기라 Number()가 NaN → 수량순처럼 깨짐. parseYear로 최신→과거.
    out[d.key] = [...m.entries()].sort((a, b) => d.key === 'year' ? parseYear(b[0]) - parseYear(a[0]) : b[1] - a[1]);
  }
  return out;
}

/** 인기차종 빠른필터(모델명) — FState 밖 축. */
export function matchPopularModel(p: EntityRecord, models: Set<string>): boolean {
  if (!models.size) return true;
  return models.has(String(p.model || '').trim());
}

/**
 * 연쇄 필터 모수 — 지정 축만 비운 상태로 매칭.
 * 결과 목록은 전 축 AND, 칩 선택지는 «그 축을 뺀 나머지»로 집계(같은 축 복수선택 유지).
 */
export function facetPool(
  products: EntityRecord[],
  state: FState,
  models: Set<string>,
  clear: {
    periods?: boolean;
    rent?: boolean;
    dep?: boolean;
    mile?: boolean;
    fuel?: boolean;
    ptype?: boolean;
    credit?: boolean;
    perks?: boolean;
    promo?: boolean;
    vehicle?: boolean;
    models?: boolean;
    dynKey?: string;
  } = {},
): EntityRecord[] {
  const dyn = { ...state.dyn };
  if (clear.dynKey) dyn[clear.dynKey] = new Set();
  const narrowed: FState = {
    q: state.q,
    periods: clear.periods ? new Set() : state.periods,
    rent: clear.rent ? new Set() : state.rent,
    dep: clear.dep ? new Set() : state.dep,
    mile: clear.mile ? new Set() : state.mile,
    fuel: clear.fuel ? new Set() : state.fuel,
    ptype: clear.ptype ? new Set() : state.ptype,
    credit: clear.credit ? new Set() : state.credit,
    perks: clear.perks ? new Set() : state.perks,
    promo: clear.promo ? new Set() : state.promo,
    dyn,
    vehicle: clear.vehicle ? { ...EMPTY_VEHICLE_FILTER } : state.vehicle,
  };
  const modelSet = clear.models ? new Set<string>() : models;
  return products.filter((p) => matchPopularModel(p, modelSet) && matchProduct(p, narrowed));
}

/** 사이드바 칩 — 축마다 자기 선택을 제외한 모수로 집계. */
export function presentFilterOptionsFaceted(
  products: EntityRecord[],
  state: FState,
  models: Set<string>,
): ReturnType<typeof presentFilterOptions> {
  const pick = (clear: Parameters<typeof facetPool>[3]) =>
    presentFilterOptions(facetPool(products, state, models, clear));
  return {
    months: pick({ periods: true }).months,
    rent: pick({ rent: true }).rent,
    dep: pick({ dep: true }).dep,
    mile: pick({ mile: true }).mile,
    ptype: pick({ ptype: true }).ptype,
    credit: pick({ credit: true }).credit,
    fuel: pick({ fuel: true }).fuel,
    perks: pick({ perks: true }).perks,
    promo: pick({ promo: true }).promo,
    hasVehicle: pick({ vehicle: true }).hasVehicle,
  };
}

/** 동적·공급사 칩 — 키마다 자기 선택을 제외한 모수. */
export function aggregateDynFaceted(
  products: EntityRecord[],
  state: FState,
  models: Set<string>,
): Record<string, [string, number][]> {
  const out: Record<string, [string, number][]> = {};
  for (const d of DYN_ALL) {
    out[d.key] = aggregateDyn(facetPool(products, state, models, { dynKey: d.key }))[d.key] || [];
  }
  return out;
}

export function matchProduct(p: EntityRecord, s: FState): boolean {
  if (!isListableProduct(p)) return false; // 출고불가·삭제만 제외(재고 전체 − 출고불가)
  const pl = priceList(p);
  // 검색어 없으면 haystack 생성 자체를 생략(matchHay는 빈 토큰이면 어차피 true). 토큰은 queryTokens 메모로 패스당 1회.
  if (queryTokens(s.q).length && !matchHay(productHaystack(p), s.q)) return false;
  // 월대여 — 기간 있으면 그 개월 칸만, 없으면 전기간 중 하나
  if (s.rent.size) {
    const lines = s.periods.size ? pl.filter((x) => s.periods.has(x.m)) : pl;
    if (!RENT_BANDS.some((b) => s.rent.has(b.k) && lines.some((x) => x.rent > b.lo && x.rent <= b.hi))) return false;
  }
  if (s.dep.size && !DEP_BANDS.some((b) => s.dep.has(b.k) && pl.some((x) => x.deposit > b.lo && x.deposit <= b.hi))) return false;
  if (s.periods.size && !pl.some((x) => s.periods.has(x.m))) return false;
  if (s.mile.size) { const km = Number(p.mileage) || 0; if (!MILE_BANDS.some((b) => s.mile.has(b.k) && km > b.lo && km <= b.hi)) return false; }
  if (s.fuel.size && !s.fuel.has(fuelDisplay(p.fuel_type) || String(p.fuel_type))) return false;
  if (s.ptype.size && !s.ptype.has(canonProductType(p.product_type))) return false;
  if (s.credit.size && !s.credit.has(creditDisplay(p))) return false;
  if (s.perks.size && ![...s.perks].every((pk) => hasPerk(p, pk))) return false;
  if (s.promo.size) {
    const tags = new Set(parseEventTags(p.event_tags || p.promo_tags));
    if (![...s.promo].some((t) => tags.has(t))) return false; // 프로모 = 선택 중 하나(OR)
  }
  for (const d of DYN_ALL) { const set = s.dyn[d.key]; if (set && set.size && !set.has(d.get(p))) return false; }
  if (!matchVehicleFilter(p, s.vehicle || EMPTY_VEHICLE_FILTER)) return false;
  return true;
}

export function activeCount(s: FState): number {
  return s.periods.size + s.rent.size + s.dep.size + s.mile.size + s.fuel.size
    + s.ptype.size + s.credit.size + s.perks.size + s.promo.size
    + DYN_ALL.reduce((n, d) => n + (s.dyn[d.key]?.size || 0), 0)
    + vehicleFilterCount(s.vehicle || EMPTY_VEHICLE_FILTER);
}

/** 사이드바 접힘 시 툴바 요약 — 짧은 라벨(최대 몇 개만 노출용). */
export function activeFilterHints(s: FState): string[] {
  const h: string[] = [];
  if (s.periods.size) h.push(sortFilterMonths(s.periods).map((m) => `${m}개월`).join('·'));
  for (const b of RENT_BANDS) if (s.rent.has(b.k)) h.push(b.label);
  for (const b of DEP_BANDS) if (s.dep.has(b.k)) h.push(b.label);
  s.ptype.forEach((v) => h.push(v));
  const vf = normalizeVehicleFilter(s.vehicle || EMPTY_VEHICLE_FILTER);
  if (vf.maker.length) h.push(vf.maker.join('·'));
  if (vf.model.length) h.push(vf.model.join('·'));
  if (vf.sub_model.length) h.push(vf.sub_model.join('·'));
  if (vf.variant.length) h.push(vf.variant.join('·'));
  if (vf.trim_name.length) h.push(vf.trim_name.join('·'));
  s.credit.forEach((v) => h.push(v));
  s.fuel.forEach((v) => h.push(v));
  s.perks.forEach((v) => h.push(v));
  for (const b of MILE_BANDS) if (s.mile.has(b.k)) h.push(b.label);
  s.promo.forEach((v) => h.push(v));
  for (const d of DYN_ALL) {
    const set = s.dyn[d.key];
    if (set) set.forEach((v) => h.push(v));
  }
  return h;
}
