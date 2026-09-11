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
import { standingFixed } from '@/lib/domain/facet-standing';
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
import { priceList, creditDisplay, noDeposit, minAge, shortExperience, installmentOk, parseEventTags, isOperatedPeriod, isStandardPeriod, PERIODS, isStockedProduct, canonProductType, hasAcquisitionPlan } from '@/lib/domain/product';
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

/**
 * 구간 하나 — 이름이 «셋»인 이유(2026-09-06).
 *
 * `label` = **업무동(콕핏)** 말. 짧다(`50만↓`). 한 화면에 최대한 많이 담는 곳이라 그렇게 짜여 있다.
 * `shop`  = **손님 동, 축 제목 «밑»**. 화살표를 안 쓴다 — 사장님 2026-09-06 「그 **50만원 화살표
 *           아래**에 이렇게 하지 말고 그냥 **50만원 이하 · 150만원 이상** 이렇게」.
 *           `↓`·`↑` 는 우리끼리 쓰는 기호지 손님이 읽는 말이 아니다.
 * `solo`  = **혼자 설 때**(걸린 조건 칩 · 빠른 조건 칩). 축 제목이 옆에 없으므로 값이 «스스로»
 *           무엇인지 말해야 한다. 사장님 2026-09-06 「거기 뭐 **월 대여료 · 보증금 · 기간 넣을 필요
 *           없어. 딱 보면 알지**」 — 칩 안의 «회색 축 앞머리»를 걷으라는 말이다.
 *
 * ★★**말은 «최대한 짧게». 없어도 아는 것은 뺀다**(사장님 2026-09-06 「**킬로미터나 이런 거는
 *   대략 뭐 알지**. 그러니까 단위를 **대여료·보증금은 만 단위**를 써야 될 거 같고, **「원」은 빼도**
 *   될 거 같아. **필수로 알 수 있는 것** — 예를 들면 **「월 50만 이하」·「월 50~60만」**,
 *   그리고 **보증금은 「보증」**. 이렇게 하면 **칩이나 퀵필터를 좀 짧고 심플하게** 만들 수 있을 것 같아」).
 *   ㉠ **「원」을 안 쓴다** — 금액에 「만」이 붙으면 돈인 줄 안다.
 *   ㉡ **보증금 → 「보증」** 두 글자.
 *   ㉢ **주행거리는 앞머리가 없다** — `km` 가 이미 무엇인지 말한다.
 *   ㉣ 대여료만 **「월」** 한 글자를 단다 — 보증과 «금액대가 겹쳐» 숫자만으로는 못 가리기 때문이다.
 * ★손님 동 화면은 `shop`/`solo` 만 쓴다. 업무동은 `label` 그대로 — 두 동의 말투가 다르다.
 */
export type Band = { k: string; label: string; lo: number; hi: number; shop?: string; solo?: string };
export const RENT_BANDS: Band[] = [
  { k: 'r50', label: '50만↓', shop: '50만 이하', solo: '월 50만 이하', lo: 0, hi: 500000 },
  { k: 'r60', label: '50~60만', shop: '50~60만', solo: '월 50~60만', lo: 500000, hi: 600000 },
  { k: 'r70', label: '60~70만', shop: '60~70만', solo: '월 60~70만', lo: 600000, hi: 700000 },
  { k: 'r80', label: '70~80만', shop: '70~80만', solo: '월 70~80만', lo: 700000, hi: 800000 },
  { k: 'r90', label: '80~90만', shop: '80~90만', solo: '월 80~90만', lo: 800000, hi: 900000 },
  { k: 'r100', label: '90~100만', shop: '90~100만', solo: '월 90~100만', lo: 900000, hi: 1000000 },
  { k: 'r150', label: '100~150만', shop: '100~150만', solo: '월 100~150만', lo: 1000000, hi: 1500000 },
  { k: 'r200', label: '150만↑', shop: '150만 이상', solo: '월 150만 이상', lo: 1500000, hi: Infinity },
];
export const DEP_BANDS: Band[] = [
  /* ★축 밑(`shop`)은 축 이름이 이미 「보증금」이라 값만 적는다 — 「보증금 / 보증 없음」이 되면
     같은 말을 두 번 한다(2026-09-05). 혼자 설 때(`solo`)만 **「보증」** 두 글자를 단다
     (사장님 2026-09-06 「보증금은 **「보증」** 이렇게 하면 칩이나 퀵필터를 짧고 심플하게」). */
  { k: 'd0', label: '없음', shop: '없음', solo: '보증 없음', lo: -1, hi: 1 },
  { k: 'd1', label: '100만↓', shop: '100만 이하', solo: '보증 100만 이하', lo: 1, hi: 1000000 },
  { k: 'd2', label: '100~200만', shop: '100~200만', solo: '보증 100~200만', lo: 1000000, hi: 2000000 },
  { k: 'd3', label: '200~300만', shop: '200~300만', solo: '보증 200~300만', lo: 2000000, hi: 3000000 },
  { k: 'd4', label: '300만↑', shop: '300만 이상', solo: '보증 300만 이상', lo: 3000000, hi: Infinity },
];
export const MILE_BANDS: Band[] = [
  /* ★주행거리는 앞머리가 «없다» — `km` 가 이미 무엇인지 말한다(사장님 2026-09-06
     「킬로미터나 이런 거는 대략 뭐 알지」). 그래서 `shop` 과 `solo` 가 같은 말이다. */
  { k: 'm1', label: '1만km↓', shop: '1만km 이하', lo: -1, hi: 10000 },
  { k: 'm3', label: '1~3만', shop: '1~3만km', lo: 10000, hi: 30000 },
  { k: 'm5', label: '3~5만', shop: '3~5만km', lo: 30000, hi: 50000 },
  { k: 'm10', label: '5~10만', shop: '5~10만km', lo: 50000, hi: 100000 },
  { k: 'm99', label: '10만↑', shop: '10만km 이상', lo: 100000, hi: Infinity },
];

/** entities SSOT 재노출 — 페이지는 여기만 import. */
export const FUELS = [...FUEL_TYPES];
export const PTYPES = [...PRODUCT_TYPES];
/**
 * 상품구분 축의 **가상값** — 「인수형(만기 인수)」. product_type 이 아니라 `price[m_인수형]` 유무로 맞춘다.
 * 같은 축(ptype Set)에 넣어 저장·프리셋·배지·초기화를 공짜로 얻는다(축 안은 OR).
 * 사장님 2026-08-18 샘플(「손오공 인수형 구독」 라인업) 반영 — 라인업 칩·사이드 상품구분 둘 다 이 값으로.
 */
export const ACQUISITION_PTYPE = '인수형' as const;
export const ACQUISITION_PTYPE_LABEL = '인수형(만기 인수)';
export const PROMOS = [...PROMO_BADGES_ACTIVE];
export const CREDITS = ['무심사', '소득확인', '신용조회'] as const; // 사장님 2026-08-19 셋
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

/** 칩 하나하나의 «셈» — 한 번 훑어 밴드·갈래·혜택을 동시에 센다(모수마다 이걸 부른다). */
type Tally = {
  rentCnt: number[]; depCnt: number[]; mileCnt: number[];
  ptypeCnt: Map<string, number>; creditCnt: Map<string, number>; fuelCnt: Map<string, number>;
  perkCnt: Map<string, number>; promoCnt: Map<string, number>; monthMap: Map<number, number>;
  hasVehicle: boolean;
};

function rawTally(products: EntityRecord[]): Tally {
  // 상품목록 모수 = 출고불가·유효 대여료 없음 제외(계약중+가격 있음은 포함·마크 노출).
  const listed = products.filter(isStockedProduct);
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
    if (hasAcquisitionPlan(p)) ptypeCnt.set(ACQUISITION_PTYPE, (ptypeCnt.get(ACQUISITION_PTYPE) || 0) + 1);
    const cd = creditDisplay(p);
    if (cd) creditCnt.set(cd, (creditCnt.get(cd) || 0) + 1);
    const fl = fuelDisplay(p.fuel_type) || String(p.fuel_type || '');
    if (fl) fuelCnt.set(fl, (fuelCnt.get(fl) || 0) + 1);
    for (const pk of PERKS) if (hasPerk(p, pk)) perkCnt.set(pk, (perkCnt.get(pk) || 0) + 1);
    for (const t of parseEventTags(p.event_tags || p.promo_tags)) promoCnt.set(t, (promoCnt.get(t) || 0) + 1);
    if (!hasVehicle && String(p.maker || '').trim() !== '') hasVehicle = true;
  }

  return { rentCnt, depCnt, mileCnt, ptypeCnt, creditCnt, fuelCnt, perkCnt, promoCnt, monthMap, hasVehicle };
}

export type PresentChip = { key: string; label: string; count: number };

/**
 * 사이드바 칩 — **명단은 «재고 전체», 숫자는 «지금 조건»**.
 *
 * ★★★사장님 2026-09-10 「필터 했을 때 **0인 필터를 없애 버리니까 필터가 막 이렇게
 *   올라갔다 내려갔다** 하잖아. 그러니까 있는 필터에서 뭘 잡았을 때 그게 없으면 그 필터 값을
 *   없애는 게 아니라 그냥 **그 필터가 옆에다가 0이라고** 해줘야지」.
 *
 * ⚠ 전에는 건수 0 인 칩을 **줄째 뺐다.** 그래서 조건 하나를 누를 때마다 칩이 사라지고 축이
 *   접혀, 사이드바 전체가 위아래로 뛰었다 — 방금 누르려던 칩이 다른 자리로 가 버린다.
 * ⇒ `universe`(조건을 다 푼 모수)가 **무엇이 서는지·어느 차례로 서는지**를 정하고,
 *   `products`(지금 조건 모수)는 **숫자만** 정한다. 그래서 숫자만 오르내리고 줄은 안 움직인다.
 * ★재고에 **아예 없는** 값은 여전히 안 선다 — universe 에서 0 이면 그건 「지금 0」이 아니라
 *   「원래 없다」다.
 * ★손님 동도 같은 규칙이다(`lib/shop/query.ts` 의 `base`/`count` · `docs/DESIGN_CONFIRMED_SHOP.md` §12).
 *   두 동이 다르게 굴면 같은 회사 화면에서 필터가 다른 물건이 된다.
 */
export function presentFilterOptions(products: EntityRecord[], universe?: EntityRecord[]): {
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
  /*
   * 명단·차례를 정하는 «전체» 모수. 안 주면 지금 모수가 곧 전체다(첫 화면·조건 없음).
   * ⚠ 여기서 값을 다시 «세지» 않는다 — 위 머리말대로 「무엇이 서는가」만 여기서 온다.
   */
  const baseCnt = universe && universe !== products ? rawTally(universe) : null;
  const {
    rentCnt, depCnt, mileCnt, ptypeCnt, creditCnt, fuelCnt, perkCnt, promoCnt, monthMap, hasVehicle,
  } = rawTally(products);

  /*
   * ★★**줄이 서는 규칙은 «집 정본»이 정한다**(`lib/domain/facet-standing`) — 손님 동과 같은 것을 쓴다.
   *   사장님 2026-09-10 「**공통으로 쓰는 것들은 한 군데서 고치면 다 동일하게 고쳐져야지**」.
   *   여기 남는 것은 «갈리는 것»뿐이다 — 어떤 축이 있고, 값 이름을 뭐라 부르는가.
   * ★`base` 가 없으면(첫 화면·조건 없음) 지금 모수가 곧 전체다 — 그때는 둘이 같은 Map 이다.
   */
  const bandChips = (pick: (c: Tally) => number[], bands: Band[], counts: number[]): PresentChip[] => {
    const keys = bands.map((b) => b.k);
    const name = new Map(bands.map((b) => [b.k, b.label]));
    const asMap = (arr: number[]) => new Map(keys.map((k, i) => [k, arr[i] ?? 0]));
    return standingFixed(keys, asMap(baseCnt ? pick(baseCnt) : counts), asMap(counts))
      .map((o) => ({ key: o.key, label: name.get(o.key) || o.key, count: o.count }));
  };
  const mapKeys = (pick: (c: Tally) => Map<string, number>, all: readonly string[], cnt: Map<string, number>) =>
    standingFixed(all, baseCnt ? pick(baseCnt) : cnt, cnt)
      .map((o) => ({ key: o.key, label: o.key, count: o.count }));

  const monthKeys = baseCnt ? baseCnt.monthMap.keys() : monthMap.keys();
  return {
    months: sortFilterMonths(monthKeys).map((m) => ({ key: String(m), label: `${m}개월`, count: monthMap.get(m) || 0 })),
    rent: bandChips((c) => c.rentCnt, RENT_BANDS, rentCnt),
    dep: bandChips((c) => c.depCnt, DEP_BANDS, depCnt),
    mile: bandChips((c) => c.mileCnt, MILE_BANDS, mileCnt),
    // 상품구분 캐논은 canonProductType. 재고에 있으면 서고, 지금 0 이면 0 이라고 쓴다.
    ptype: [
      ...mapKeys((c) => c.ptypeCnt, PTYPES, ptypeCnt),
      ...mapKeys((c) => c.ptypeCnt, [ACQUISITION_PTYPE], ptypeCnt)
        .map((o) => ({ ...o, label: ACQUISITION_PTYPE_LABEL })),
    ],
    credit: mapKeys((c) => c.creditCnt, CREDITS, creditCnt),
    fuel: mapKeys((c) => c.fuelCnt, FUELS, fuelCnt),
    perks: mapKeys((c) => c.perkCnt, PERKS, perkCnt),
    promo: mapKeys((c) => c.promoCnt, PROMOS, promoCnt),
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
/**
 * 국산이냐 — 필터뿐 아니라 **계약 요율**도 이걸로 갈린다(초과 주행요금 국산 200원 / 수입 400원).
 * 판정을 두 벌로 두면 필터에선 국산인데 계약서엔 수입 요율이 찍힌다.
 */
export function isDomesticMaker(raw: string): boolean {
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

export function aggregateDyn(
  products: EntityRecord[],
  /**
   * 한 축만 셀 때 그 키 — **교차 집계에서 쓴다.**
   * ⚠ 안 주면 축 여덟을 다 센다. 교차 집계는 «축마다» 이 함수를 부르므로, 안 주면
   *   여덟 축을 세는 일을 여덟 번(=64번) 한다 — 그게 곧 「필터가 버벅인다」다.
   */
  only?: string,
): Record<string, [string, number][]> {
  const listed = products.filter(isStockedProduct);
  const out: Record<string, [string, number][]> = {};
  for (const d of DYN_ALL) {
    if (only && d.key !== only) continue;
    const m = new Map<string, number>();
    for (const p of listed) { const v = d.get(p); if (v) m.set(v, (m.get(v) || 0) + 1); }
    // 연식 = "24년" 표기라 Number()가 NaN → 수량순처럼 깨짐. parseYear로 최신→과거.
    out[d.key] = [...m.entries()].sort((a, b) => d.key === 'year' ? parseYear(b[0]) - parseYear(a[0]) : b[1] - a[1]);
  }
  return out;
}

/**
 * ★★★**인기 차종 — «바깥 순위»다. 우리 재고가 정하지 않는다.**
 *
 * 사장님 2026-09-07 「**외부순위로 인기순 가라**… 그게 맞음」 ·
 * 「인기차량을 **실제 매월 내가 세팅**하긴 할 건데」.
 *
 * ⚠⚠ 전에는 이 목록이 **「우리 재고 많은 순 열 개」로 자동 계산**됐다
 *   (`useFinderResults` 옛 판). 이름만 「인기」였지 실제로는 「재고순」이었다.
 *   그러면 창고에 많이 들여놓은 차가 저절로 「인기」가 된다 — 순환논리다.
 *   손님이 아는 인기는 «시장»에서 정해지고, 우리 재고는 그 인기를 «따라가야» 하는 쪽이다.
 *
 * ★★**매월 여기만 고친다.** 다른 데는 손대지 않는다 — 순서가 곧 순위다.
 * ★값은 재고의 `model` 필드와 **글자 그대로** 맞춘다(실측 2026-09-07 — 재고의 model 값은
 *   「그랜저」·「쏘렌토」처럼 짧은 이름이라 그대로 쓰면 된다. 세부트림은 안 들어 있다).
 * ★목록에 없는 차가 «안 팔리는 차»라는 뜻은 아니다 — 순위 밖일 뿐이라 뒤에 설 뿐이다.
 * ⚠ 우리 재고에 없는 이름을 적어도 안 깨진다(아무것도 안 걸릴 뿐이다). 그래서 시장 순위를
 *   그대로 옮겨 적어도 된다 — 재고에 맞춰 «고쳐 적지» 마라. 그러면 다시 재고순이 된다.
 *
 * ── 기준: **2026년 8월 국산 승용 신차등록**(1~5위) + 같은 달 제조사 발표 내수 실적(6위 이하)
 *    · 1 쏘렌토 6,102 · 2 그랜저 5,180 · 3 카니발 4,478 · 4 스포티지 4,131 · 5 셀토스 3,878
 *    · 레이 3,718 · 싼타페 3,596 · 쏘나타 3,105 · K8 1,938 · K5 1,920 · 팰리세이드 1,812
 *    · 아반떼 1,462 · 아이오닉5 1,372
 *    출처 — 교통뉴스(cartvnews 702291) · M포스트(mobilitypost 4218)
 *    ⚠ 1~5위와 6위 이하는 «집계 컷»이 다르다(등록 통계 vs 제조사 발표). 6위 이하의 «순서»는
 *      참고값이다 — 다음 달에 한 컷으로 다시 적는 편이 낫다.
 */
export const POPULAR_MODELS: readonly string[] = [
  '쏘렌토', '그랜저', '카니발', '스포티지', '셀토스',
  '레이', '싼타페', '쏘나타', 'K8', 'K5', '팰리세이드', '아반떼', '아이오닉5',
];

/** 인기 순위에서 몇 번째인가 — 없으면 «뒤»(큰 수). 정렬·칩이 같이 쓴다. */
export const popularRank = (model: unknown): number => {
  const i = POPULAR_MODELS.indexOf(String(model ?? '').trim());
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};

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

/**
 * 사이드바 칩 — 축마다 «자기 선택을 뺀» 모수로 세되, **명단은 재고 전체가 정한다**.
 * ★그래서 조건을 눌러도 칩이 사라지지 않고 숫자만 0 으로 바뀐다(`presentFilterOptions` 머리말).
 */
export function presentFilterOptionsFaceted(
  products: EntityRecord[],
  state: FState,
  models: Set<string>,
): ReturnType<typeof presentFilterOptions> {
  const pick = (clear: Parameters<typeof facetPool>[3]) =>
    presentFilterOptions(facetPool(products, state, models, clear), products);
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

/**
 * 동적·공급사 칩(제조사·모델·연식·색상·공급사…) — 키마다 «자기 선택을 뺀» 모수로 센다.
 *
 * ★★**명단과 차례는 «재고 전체»가 정한다**(사장님 2026-09-10 「0인 필터를 없애 버리니까
 *   필터가 막 올라갔다 내려갔다 하잖아」). 여기가 제일 크게 흔들리던 자리다 —
 *   제조사가 열둘에서 셋으로 줄고, 남은 것도 대수 순으로 다시 서서 줄이 통째로 뒤집혔다.
 * ⇒ 「무엇이 어느 차례로 서는가」는 조건과 무관하게 고정하고, **숫자만** 지금 조건으로 센다.
 *   조건에 안 걸리면 그 줄은 «0» 이 된다(사라지지 않는다).
 */
export function aggregateDynFaceted(
  products: EntityRecord[],
  state: FState,
  models: Set<string>,
): Record<string, [string, number][]> {
  /* 명단·차례 — 조건을 다 푼 모수에서 한 번만 만든다(축마다 다시 만들면 그게 곧 흔들림이다). */
  const base = aggregateDyn(products);
  const out: Record<string, [string, number][]> = {};
  for (const d of DYN_ALL) {
    const live = new Map(aggregateDyn(facetPool(products, state, models, { dynKey: d.key }), d.key)[d.key] || []);
    /*
     * ★차례는 `aggregateDyn` 이 이미 base 로 매겨 놨다(연식은 최신순·나머지는 대수순).
     *   여기서는 «그 차례대로 숫자만» 갈아 끼운다 — 규칙은 `facet-standing` 과 같은 말이다.
     */
    out[d.key] = standingFixed(
      (base[d.key] || []).map(([k]) => k),
      new Map(base[d.key] || []),
      live,
    ).map((o) => [o.key, o.count]);
  }
  return out;
}

export function matchProduct(p: EntityRecord, s: FState): boolean {
  if (!isStockedProduct(p)) return false; // 내부 상품찾기 = 공급사·영업자 시트와 같은 재고 전체
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
  if (s.ptype.size && !s.ptype.has(canonProductType(p.product_type)) && !(s.ptype.has(ACQUISITION_PTYPE) && hasAcquisitionPlan(p))) return false;
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
