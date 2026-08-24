/**
 * 매물(product) 도메인 — 가격맵·차량명·정책조건·검색필터. (freepasserp3 product-filters/policy 이식)
 * product는 정책(_policy, ~30필드)을 물고 옴 → 검색·상세가 정책조건까지 포함.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { MAX_PROMO_BADGES as PROMO_MAX, PROMO_BADGES_ACTIVE, PROMO_BADGES_PLANNED, PROMO_BADGE_LEGACY, PRODUCT_TYPES, PRODUCT_TYPE_LEGACY, VEHICLE_STATES } from '@/lib/intake/entities';
import { fuelDisplay, fuelEmbeddedCc, yearDisplay, makerDisplay } from '@/lib/domain/vehicle-master-match';
import { kmDisplay, ymdDisplay } from '@/lib/format';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import { moneyOrRateText, moneyOrRatePercent, wonLabel } from '@/lib/domain/policy-money-rate';
import { policyEsignRequiredDocuments } from '@/lib/domain/esign-required-documents';
export { PROMO_BADGES, PROMO_BADGES_ACTIVE, PROMO_BADGES_PLANNED, MAX_PROMO_BADGES } from '@/lib/intake/entities';

/**
 * 선택옵션 구분 SSOT = `,` 또는 `/` 만.
 * 표시·칩·검색·상세는 전부 이 파서. 시트 입고는 normalizeProductOptionsText로 맞춤.
 */
export function parseProductOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  return String(raw ?? '').split(/[,/]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * 외부·시트 옵션 문자열 → `,`/`/` 구분만 남기고 저장용 한 줄. (`·` `;` `|` 개행 → `,`)
 *
 * ★**콤마 뒤에 공백을 넣지 않는다**(2026-08-23 — 「있는 걸 그대로 나르기」).
 *   예전에는 `join(', ')` 이라 판매시트 「전동사이드미러,열선시트」가 ERP 에서 「전동사이드미러, 열선시트」가 됐다
 *   (audit:passthrough 실측 143건). 값이 틀린 건 아니지만 **옮기는 길에서 글자를 바꾸는 것**이라 시트와 ERP 가 갈렸다.
 *   보기 좋게 만드는 일은 화면이 한다 — 표시·칩·검색·상세는 전부 `parseProductOptions` 를 거치고 그쪽이 조각을 trim 한다.
 * ⚠ 구분자 통일(`·` `;` `|` 개행 → `,`)은 그대로 둔다. 그건 표기 가공이 아니라 «구분자를 하나로»다.
 */
export function normalizeProductOptionsText(raw: unknown): string {
  const cleaned = String(raw ?? '').replace(/[·;|｜\n\r]+/g, ',');
  return parseProductOptions(cleaned).join(',');
}

/** 상품구분 캐논 — 재렌트→중고렌트 · 재구독→중고구독. 필터·뱃지·매칭 SSOT. */
export function canonProductType(raw: unknown): string {
  const s = String(raw || '').replace(/\s+/g, '');
  if (!s) return '';
  if (PRODUCT_TYPE_LEGACY[s]) return PRODUCT_TYPE_LEGACY[s];
  if ((PRODUCT_TYPES as readonly string[]).includes(s)) return s;
  if (s.includes('신차') && s.includes('구독')) return '신차구독';
  if (s.includes('신차')) return '신차렌트';
  if (s.includes('구독')) return '중고구독';
  if (s.includes('렌트') || s.includes('재렌')) return '중고렌트';
  return s;
}

/** 실 번호판 형식(한국) — 숫자2~3 + 한글 + 숫자4. 지역접두(서울…) 포함해도 부분매칭. */
export const PLATE_RE = /\d{2,3}[가-힣]\d{4}/;
export function isRealPlate(carNumber: unknown): boolean {
  const s = String(carNumber ?? '').replace(/\s/g, '').toUpperCase();
  return !!s && PLATE_RE.test(s);
}

/**
 * 외부 입고용 exact 번호판. 레거시 지역 접두는 실제 17개 시·도 표기만 허용한다.
 * 임의 한글 prefix를 허용하면 `차량12가3456` 같은 설명문이 실차번으로 저장된다.
 * 기존 화면/레거시 복원에서 쓰는 관대한 isRealPlate는 호환성 때문에 그대로 둔다.
 */
export const EXACT_PLATE_RE = /^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?\d{2,3}[가-힣]\d{4}$/;
/** 번호 미정 신차에 우리가 붙이는 임시번호(`100신0001`). 실번호가 아니라 자리표시다. */
export const TEMP_PLATE_RE = /^100신\d{4,}$/;
export function isExactRealPlate(carNumber: unknown): boolean {
  const s = String(carNumber ?? '').replace(/\s/g, '').toUpperCase();
  return !!s && EXACT_PLATE_RE.test(s) && !TEMP_PLATE_RE.test(s);
}
/**
 * 매물 실물 유일신원 — 중복제거 키. 실번호판 → 없으면 VIN(11자↑) → 둘 다 없으면 null(개별 유지).
 *  ※ 번호판이 미정·`-`·`0`·빈칸 등 placeholder면 유일키로 쓰지 않는다 — 서로 다른 차가 같은
 *    placeholder를 공유해 잘못 합쳐지는(재고 과소집계) 것을 막는다. VIN도 없으면 합치지 않음.
 */
export function vehicleIdentity(p: { car_number?: unknown; vin?: unknown }): string | null {
  const plate = String(p.car_number ?? '').replace(/\s/g, '').toUpperCase();
  // 임시번호(100신NNNN)는 우리가 붙인 «자리표시»지 그 차의 신원이 아니다. 실번호가 나오거나
  // 시트 행 순서가 바뀌면 흔들린다. 그래서 실번호판 → VIN → (둘 다 없을 때만) 임시번호 순으로 본다.
  //  VIN 은 번호판이 나오기 전에도 변하지 않으므로 신차의 진짜 신원이다.
  const temp = TEMP_PLATE_RE.test(plate);
  if (plate && PLATE_RE.test(plate) && !temp) return 'P:' + plate;
  const vin = String(p.vin ?? '').replace(/\s/g, '').toUpperCase();
  if (vin.length >= 11) return 'V:' + vin;
  // VIN 이 없으면 임시번호라도 쓴다 — null(합치지 않음)보다 낫다. 최소한 같은 임시번호끼리는 묶인다.
  if (temp) return 'P:' + plate;
  return null;
}

const num = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n; };

export type Price = { m: number; rent: number; deposit: number; fee: number };
/** 원본 price 키를 보존한 가격. `24_3만`처럼 같은 개월의 주행거리별 가격을 표시할 때 쓴다. */
export type PriceVariant = Price & { key: string; mileage: string };
export type MileageUpcharge = { m: number; amount: number };
export type Policy = Record<string, unknown>;

/** 옛 오토플러스 위치기반 어댑터가 만든 잘못된 표준키. 현행 주행거리 키가 있으면 읽기에서도 제외한다. */
export const AUTOPLUS_LEGACY_PRICE_KEYS = new Set(['12', '24', '36', '48']);

/** 오토플러스 가격 예외는 공급사 코드로만 한정한다. adapter 이름만으로 다른 공급사까지 번지면 안 된다. */
export function isAutoplusProduct(p: EntityRecord): boolean {
  const rec = p as Record<string, unknown>;
  const code = String(rec.provider_company_code || rec.partner_code || '').trim().toUpperCase();
  if (code === 'RP023') return true;
  const key = String(rec.product_code || rec._key || '').trim().toUpperCase();
  if (key.startsWith('RP023_') || key.endsWith('_RP023')) return true;
  return /오토플러스|AUTOPLUS/i.test(String(rec.provider_name || rec.partner_name || ''));
}

export function policyOf(p: EntityRecord): Policy { return (p._policy || {}) as Policy; }

/**
 * 금액(원) 정규화 — 시트/브리지 혼입 보정(읽기 SSOT).
 *  · 억(1e8)↑ = 렌트 보증·월대여로 비정상 → 만원 이중환산으로 보고 /10000 반복
 *  · 대여가 원(≥10만)인데 보증만 만원 정수(1~9999) → 보증 ×10000
 *  · 대여·보증 둘 다 만원 정수처럼 보이면 둘 다 ×10000
 */
export function normalizeWonPair(rentRaw: unknown, depositRaw: unknown): { rent: number; deposit: number } {
  let rent = Math.round(num(rentRaw));
  let deposit = Math.round(num(depositRaw));
  if (rent > 0 && rent < 10_000) {
    rent *= 10_000;
    if (deposit > 0 && deposit < 10_000) deposit *= 10_000;
  } else if (rent >= 100_000 && deposit > 0 && deposit < 10_000) {
    deposit *= 10_000;
  }
  while (rent >= 100_000_000) rent = Math.round(rent / 10_000);
  while (deposit >= 100_000_000) deposit = Math.round(deposit / 10_000);
  // 남은 이중환산: 보증 ≫ 대여(×50) + 5천만↑
  if (rent >= 100_000 && deposit >= 50_000_000 && deposit > rent * 50) deposit = Math.round(deposit / 10_000);
  return { rent, deposit };
}

/**
 * 표준 표 기간(개월) SSOT — 엑셀·종합표 열 = 1·12·24·36·48·60.
 * 6·18 등 비표준은 데이터에 있으면 필터·상세·입력(PriceMatrix)에 포함.
 */
export const PERIODS = [1, 12, 24, 36, 48, 60] as const;

/** 유효 기간 — 양수 개월. 6·18 포함(데이터 있으면 필터·상세). */
export function isOperatedPeriod(m: number): boolean {
  return Number.isFinite(m) && m > 0;
}
/** 표준 표 기간 — 엑셀 열. */
export function isStandardPeriod(m: number): boolean {
  return (PERIODS as readonly number[]).includes(m);
}

/** priceList 결과 캐시 — 로드된 매물 객체는 세션 내 불변이라 첫 계산 후 재사용(무효화 불필요).
 *  matchProduct·정렬·카드 렌더가 같은 매물을 여러 번 훑어도 캐시히트. 반환 배열은 읽기 전용으로만 쓰인다(호출부 비변형 확인). */
const priceListCache = new WeakMap<object, Price[]>();
/** 가격 키 변형 「인수형」 — `${m}_인수형`. 표준 표에서 빼고 인수형 표로 따로 보여 준다. */
export const ACQUISITION_VARIANT = '인수형';

/**
 * 주행거리 변형을 접지 않은 가격 목록.
 *
 * `priceList`는 검색·정렬용 기본가라 같은 개월을 하나로 접는다. 반면 상세·영업자 시트는
 * 오토플러스의 `18_2만`과 `18_3만`을 둘 다 보여야 하므로 원본 키를 그대로 유지한다.
 */
export function priceVariants(p: EntityRecord): PriceVariant[] {
  const price = (p.price || {}) as Record<string, { rent?: number; deposit?: number; fee?: number }>;
  const result: PriceVariant[] = [];
  for (const [key, value] of Object.entries(price)) {
    const match = key.match(/^(\d+)(?:_(.+))?$/);
    if (!match) continue;
    const m = Number(match[1]);
    if (!isOperatedPeriod(m)) continue;
    const rawRent = num(value?.rent);
    if (rawRent <= 0) continue;
    const { rent, deposit } = normalizeWonPair(rawRent, value?.deposit);
    if (rent < 100_000 || rent > 20_000_000) continue;
    result.push({
      key,
      m,
      mileage: String(match[2] || '').trim(),
      rent,
      deposit,
      fee: num(value?.fee),
    });
  }
  return result.sort((a, b) => a.m - b.m
    || Number(Boolean(a.mileage)) - Number(Boolean(b.mileage))
    || a.mileage.localeCompare(b.mileage, 'ko', { numeric: true }));
}

/** 오토플러스의 연 2만km 기준가격이 하나라도 있는지. 3만km 가격만으로 2만 가격을 지어내지 않는다. */
export function hasAutoplusTwoKmPrice(p: EntityRecord): boolean {
  return priceVariants(p).some((price) => price.mileage === '2만');
}

/**
 * 오토플러스 1만km 상향 월요금 — 같은 기간의 `3만km 가격 - 2만km 가격`.
 * 차량 하나도 기간마다 차액이 다를 수 있어 개월별로 보존한다.
 */
export function autoplusMileageUpcharges(p: EntityRecord): MileageUpcharge[] {
  if (!isAutoplusProduct(p)) return [];
  const variants = priceVariants(p);
  const byKey = new Map(variants.map((price) => [price.key, price]));
  const months = [...new Set(variants.map((price) => price.m))].sort((a, b) => a - b);
  return months.flatMap((m) => {
    const base = byKey.get(`${m}_2만`);
    const raised = byKey.get(`${m}_3만`);
    if (!base || !raised || raised.rent < base.rent) return [];
    return [{ m, amount: raised.rent - base.rent }];
  });
}

export function autoplusMileageUpchargeLabel(p: EntityRecord): string {
  if (!isAutoplusProduct(p)) return '';
  const baseMonths = priceVariants(p)
    .filter((price) => price.mileage === '2만')
    .map((price) => price.m);
  if (!baseMonths.length) return '';
  const rows = autoplusMileageUpcharges(p);
  const byMonth = new Map(rows.map((row) => [row.m, row.amount]));
  const missing = baseMonths.filter((month) => !byMonth.has(month));
  if (!rows.length) return baseMonths.map((month) => `${month}개월 확인필요`).join(' / ');
  const unique = [...new Set(rows.map((row) => row.amount))];
  if (!missing.length && unique.length === 1) return `월 +${unique[0].toLocaleString()}원`;
  return baseMonths.map((month) => {
    const amount = byMonth.get(month);
    return amount == null ? `${month}개월 확인필요` : `${month}개월 +${amount.toLocaleString()}원`;
  }).join(' / ');
}

/** 기간별 가격 목록 (m 오름차순). 데이터에 있는 기간 전부(6·18 포함). */
export function priceList(p: EntityRecord): Price[] {
  const cached = priceListCache.get(p as object);
  if (cached) return cached;
  const price = (p.price || {}) as Record<string, { rent?: number; deposit?: number; fee?: number }>;
  const ignoreAutoplusLegacy = isAutoplusProduct(p) && Object.keys(price).some((key) => /^\d+_.+/.test(key));
  /**
   * ★「판매 기준가는 연 2만km」는 **2만km 가격이 있을 때의 규칙**이다.
   *
   * 실측 2026-08-09: 오토플러스 9대가 `12·24·36·48`(옛 위치기반 레거시 키)과
   * `18_3만·24_3만·36_3만` 만 갖고 있었다. 레거시는 못 믿는다고 버리고 3만은 기준가가
   * 아니라고 버리니 **남는 게 0건**이 됐고, 팔 수 있는 차 9대가 목록에서 통째로 사라졌다
   * (GV70·K8·K9·G80·K5·쏘렌토·모하비·카니발·렉스턴).
   *
   * 2만이 하나도 없으면 그 차의 «파는 값»은 3만km 가격뿐이다. 그걸 쓴다 —
   * 지어내는 게 아니라 시트에 적힌 값을 그대로 쓰는 것이고, 없는 차로 만드는 것보다 낫다.
   * 상향요금 표시는 2만 기준이 없으면 `autoplusMileageUpchargeLabel` 이 알아서 비운다.
   */
  /**
   * ★2만 기준은 **기간마다** 따진다 — 차 단위로 자르면 «3만에만 있는 기간»이 통째로 사라진다.
   *
   * 실측 2026-08-12(오토플러스 시트): 열이 「12개월3만 · 18개월2만 · 24개월2만 · 36개월2만」이다.
   * **12개월은 3만km 조건으로만 판다.** 예전처럼 "이 차에 2만이 하나라도 있으면 3만은 전부 버림"으로
   * 자르면 12개월이 92대에서 통째로 빈칸이 됐다 — 시트에 900,000 이라고 적힌 상품인데도.
   * 그래서 순위로 고른다: 표준키 > 2만 > 그 밖. 같은 순위면 싼 쪽.
   * 2만이 있는 기간은 그대로 2만이 기준가로 뽑히고, 2만이 없는 기간만 3만이 올라온다.
   */
  const tierRank = (k: string) => (!k.includes('_') ? 0 : k.slice(k.indexOf('_') + 1) === '2만' ? 1 : 2);
  // 월(m)별 단일 가격으로 통합 — 주행거리 변형(24_3만 등)은 추가요금=정책 담당이라 기간에서 접는다.
  const byM = new Map<number, { e: Price; rank: number }>();
  for (const [k, v] of Object.entries(price)) {
    if (ignoreAutoplusLegacy && AUTOPLUS_LEGACY_PRICE_KEYS.has(k)) continue;
    // 인수형(만기 인수)은 «같은 기간의 다른 상품» — 표준(반납형) 표에 섞지 않는다(acquisitionPriceList 가 따로 보여 준다).
    //  예전엔 「그 밖」 순위로 남아 반납형이 없는 기간(예: 60개월)에 인수형 대여료가 표준가처럼 찍혔다(2026-08-18).
    if (k.endsWith(`_${ACQUISITION_VARIANT}`)) continue;
    const rawRent = num(v?.rent); if (rawRent <= 0) continue;
    const { rent, deposit } = normalizeWonPair(rawRent, v?.deposit);
    // 대여료 이상치 방어(v3 이식) — 하한 10만·상한 2천만 밖 = 오입력(자릿수 오타·노트 숫자 추출 등) → 제외.
    if (rent < 100_000 || rent > 20_000_000) continue;
    const m = Number(k.includes('_') ? k.slice(0, k.indexOf('_')) : k);
    if (!isOperatedPeriod(m)) continue;
    const rank = tierRank(k); const cur = byM.get(m);
    if (!cur || rank < cur.rank || (rank === cur.rank && rent < cur.e.rent)) {
      byM.set(m, { e: { m, rent, deposit, fee: num(v?.fee) }, rank });
    }
  }
  const list = [...byM.values()].map((x) => x.e).sort((a, b) => a.m - b.m);
  // 역전 방어(v3 이식) — 짧은 기간이 더 긴 기간보다 5%↑ 쌈 = 불가능(단기가 더 비싸야) → 짧은 쪽 오입력 제거.
  const result = list.filter((e, i) => !list.slice(i + 1).some((lo) => lo.rent > e.rent * 1.05));
  priceListCache.set(p as object, result);
  return result;
}

/**
 * **인수형(만기 인수) 가격표** — `price[m_인수형]` 만 따로 뽑는다(손오공·웰릭스 구독 상품).
 *
 * ★왜(2026-08-18 · 사장님 「샘플 반영」·「상품시트 = ERP」): 판매시트엔 「손오공인수형구독」 탭이 따로 있는데
 *   ERP 는 `priceList` 가 기간별로 표준가(반납형)만 남겨 **인수형이 화면에 아예 안 보였다**. 인수형은
 *   «같은 기간의 다른 상품»(만기에 차를 인수)이므로 접지 않고 별도 표로 보여 준다.
 *   위생 규칙은 priceList 와 같다(대여료 10만~2천만 · 운영 기간만). 정렬은 기간 오름차순.
 */
const acquisitionCache = new WeakMap<object, Price[]>();
export function acquisitionPriceList(p: EntityRecord): Price[] {
  const cached = acquisitionCache.get(p as object);
  if (cached) return cached;
  const price = (p.price || {}) as Record<string, { rent?: number; deposit?: number; fee?: number }>;
  const out: Price[] = [];
  for (const [k, v] of Object.entries(price)) {
    const m = /^(\d+)_인수형$/.exec(k);
    if (!m) continue;
    const rawRent = num(v?.rent); if (rawRent <= 0) continue;
    const { rent, deposit } = normalizeWonPair(rawRent, v?.deposit);
    if (rent < 100_000 || rent > 20_000_000) continue;
    const months = Number(m[1]);
    if (!isOperatedPeriod(months)) continue;
    out.push({ m: months, rent, deposit, fee: num(v?.fee) });
  }
  out.sort((a, b) => a.m - b.m);
  acquisitionCache.set(p as object, out);
  return out;
}
/** 인수형(만기 인수) 상품이 붙은 매물 — 라인업 칩·필터 축(가상 상품구분 값)에서 쓴다. */
export function hasAcquisitionPlan(p: EntityRecord): boolean { return acquisitionPriceList(p).length > 0; }

/**
 * **주행거리별 대여료** — `price[「N_M만」]` 을 그대로 뽑는다(오토플러스 12개월3만·24개월2만 …).
 *
 * ★왜(사장님 2026-08-23 「입력할 때 기간에 입력하는데 그때 **주행거리 정해서 넣고 싶으면 그렇게 넣게** 하고
 *   **ERP 에 표시해 주는 거지 상세페이지에**」)
 *   위 `priceList` 는 주행거리 변형을 **기간별 하나로 접는다**(2만 우선). 표준 표가 두 줄로 갈리면
 *   «얼마인가»에 답이 둘이 되기 때문이다. 그래서 3만km 요금이 화면에서 통째로 사라졌다 —
 *   실측 2026-08-23: 오토플러스 79대가 12_3만·18_3만·24_3만·36_2만 … 을 갖고도 상세에 안 보였다.
 *   접는 것은 그대로 두고, **여기서 원본을 따로 꺼내 상세에 보여 준다**(인수형과 같은 방식).
 *
 * ⚠ 공급사가 주행거리를 안 적으면 이 표는 빈다 — 그때 주행 약정은 **정책값**이 든다(계약조건 「주행 약정」).
 */
export type PricePlan = {
  /** 기간(개월) */
  m: number;
  /** 이 요금의 조건 — 「연 3만km」·「만기인수」처럼 **기간마다 다른 것**만. 없으면 빈 문자열. */
  condition: string;
  rent: number;
  deposit: number;
  /** 표준(반납형)인가 — 최저가 표시는 표준만 대상으로 한다. */
  standard: boolean;
};

/**
 * **기간 × 조건 × 대여료 × 보증금** — 상세 대여료 표가 쓰는 한 장짜리 목록.
 *
 * ★왜(사장님 2026-08-23 「ERP 표에 기간 대여료 보증금만 있는데 · **기간 조건 대여료 보증금**,
 *   조건에 만 26세 이상·연간 3만km 약정 이런 식으로 당겨와서 기간별 표시해 주면 어때?
 *   그럼 오플 거도 무난하게 담고 직관적이고 좋을 거 같은데」)
 *
 *   전에는 표를 셋으로 갈랐다 — 표준(`priceList`, 기간별 하나로 접음) · 주행거리별 · 인수형.
 *   접는 바람에 오플 3만km 요금이 화면에서 사라졌고, 갈라 놓으니 «같은 차의 요금»이 세 군데 흩어졌다.
 *   **조건을 한 열로 세우면** 접을 이유가 없다 — 같은 기간에 조건이 둘이면 두 줄로 서면 그만이다.
 *
 * ⚠ 위생 규칙은 `priceList` 와 같다(대여료 10만~2천만 · 운영 기간만).
 * ⚠ 연령·보험처럼 **모든 줄에 같은 조건**은 여기 안 넣는다 — 표 아래 한 줄로 붙인다(같은 말 반복 금지).
 */
const planCache = new WeakMap<object, PricePlan[]>();
export function pricePlanList(p: EntityRecord): PricePlan[] {
  const cached = planCache.get(p as object);
  if (cached) return cached;
  const price = (p.price || {}) as Record<string, { rent?: number; deposit?: number }>;
  const pol = (p._policy || {}) as Record<string, unknown>;
  /** 공급사가 요금에 주행거리를 안 붙였으면 정책 약정이 그 조건이다(없으면 조건 없음 — 지어내지 않는다). */
  const policyMileage = String(pol.annual_mileage ?? '').trim();
  const out: PricePlan[] = [];
  for (const [k, v] of Object.entries(price)) {
    const rawRent = num(v?.rent); if (rawRent <= 0) continue;
    const { rent, deposit } = normalizeWonPair(rawRent, v?.deposit);
    if (rent < 100_000 || rent > 20_000_000) continue;
    const bar = k.indexOf('_');
    const m = Number(bar >= 0 ? k.slice(0, bar) : k);
    if (!isOperatedPeriod(m)) continue;
    const variant = bar >= 0 ? k.slice(bar + 1) : '';
    const km = /^[1-9]\d*만$/.test(variant) ? `연 ${variant}km` : '';
    const condition = variant === ACQUISITION_VARIANT ? '만기인수' : (km || policyMileage);
    out.push({ m, condition, rent, deposit, standard: !variant || !!km });
  }
  // 기간 오름차순 → 같은 기간이면 싼 것 먼저(조건이 헐한 쪽이 위로).
  out.sort((a, b) => a.m - b.m || a.rent - b.rent);
  planCache.set(p as object, out);
  return out;
}

const mileageCache = new WeakMap<object, { m: number; mileage: string; rent: number; deposit: number }[]>();
export function mileagePriceList(p: EntityRecord): { m: number; mileage: string; rent: number; deposit: number }[] {
  const cached = mileageCache.get(p as object);
  if (cached) return cached;
  const price = (p.price || {}) as Record<string, { rent?: number; deposit?: number }>;
  const out: { m: number; mileage: string; rent: number; deposit: number }[] = [];
  for (const [k, v] of Object.entries(price)) {
    const hit = /^(\d+)_([1-9]\d*만)$/.exec(k);
    if (!hit) continue;
    const rawRent = num(v?.rent); if (rawRent <= 0) continue;
    const { rent, deposit } = normalizeWonPair(rawRent, v?.deposit);
    if (rent < 100_000 || rent > 20_000_000) continue;
    const months = Number(hit[1]);
    if (!isOperatedPeriod(months)) continue;
    out.push({ m: months, mileage: hit[2], rent, deposit });
  }
  // 기간 오름차순 → 같은 기간이면 주행거리 오름차순(2만 → 3만).
  out.sort((a, b) => a.m - b.m || Number(a.mileage.replace('만', '')) - Number(b.mileage.replace('만', '')));
  mileageCache.set(p as object, out);
  return out;
}

/** 선택 기간의 가격 (없으면 가장 가까운 기간) */
export function priceAt(p: EntityRecord, target: number): Price | null {
  const l = priceList(p);
  if (!l.length) return null;
  return l.find((e) => e.m === target) || l.slice().sort((a, b) => Math.abs(a.m - target) - Math.abs(b.m - target))[0];
}

/**
 * 목록·칩·앱바·정렬키의 차명 = T1.
 * **조립은 vehicle-name.ts 가 SSOT — 여기서 직접 만들지 않는다.**
 * 예전엔 trim_name 에 isNoTrimLabel 필터가 없어 '… 없음'이 제목에 그대로 찍혔고,
 * 빈 차명 폴백이 '차량'이라 다른 화면의 '상품'·'—'·'-'·'[]' 와 어긋났다.
 */
export function vehicleName(p: EntityRecord): string {
  return vehicleNameOf({ kind: 'product', product: p }, { tier: 'short' });
}

/** 심사조건이 아직 안 들어온 매물의 표기 — «없음»이 아니라 «모름»이다. */
export const CREDIT_UNSET = '미입력';

/**
 * 심사표기 — 무심사 / 소득확인 / 신용조회 (뱃지 SSOT. 정책 screening_criteria 우선 · 사장님 2026-08-19 셋으로 확정)
 *
 * ★신호가 없으면 «무심사»가 아니라 `미입력` 이다(2026-08-06).
 *   예전 기본값은 '무심사' 였다. 그런데 정책코드가 없는 매물이 366대 중 338대(92%)라,
 *   근거 없이 «무심사»가 손님 카톡 문구와 **계약 스냅샷**(`deal.ts` credit_grade_snapshot)까지
 *   흘러갔다. 심사조건은 돈이 걸린 약속이므로 모르면 모른다고 해야 한다.
 */
export function creditDisplay(p: EntityRecord): string {
  const v = String(policyOf(p).screening_criteria || p.screening_criteria || p.credit_grade || '');
  if (/무심사|신용 *무관|소득 *무관|저신용/.test(v)) return '무심사';
  if (/신용 *조회|신용 *필요|신용 *확인|신용 *심사|중신용|고신용|등급|심사\s*필|심사\s*필요/.test(v)) return '신용조회';
  if (/소득 *확인|소득 *조회|소득확|소득 *증빙/.test(v)) return '소득확인';
  return v || CREDIT_UNSET;
}
/** 무보증(보증금 0 상품) — 저신용 손님의 핵심 진입장벽 해소. 영업자 셀링포인트. */
export function noDeposit(p: EntityRecord): boolean {
  if (p.deposit_free === true || String(p.deposit_free) === '예') return true; // 명시 무보증 플래그
  // 모든 유료기간의 보증금이 0일 때만 무보증(부분입력 오탐 방지 — 한 기간만 빈칸→0이어도 무보증 표기되던 버그).
  const priced = priceList(p).filter((x) => x.rent > 0);
  return priced.length > 0 && priced.every((x) => x.deposit === 0);
}
/** 최저 월대여료 상품(카드 헤드라인) — 영업자·손님이 제일 먼저 보는 값. */
export function cheapest(p: EntityRecord): Price | null { const l = priceList(p); return l.length ? l.reduce((a, b) => (b.rent < a.rent ? b : a)) : null; }
export function cheapestRent(p: EntityRecord): number { const c = cheapest(p); return c ? c.rent : Infinity; }
/** 선택 기간 대여료(없으면 최저). 정렬 시 필터기간 1개와 맞춤. */
export function rentForSort(p: EntityRecord, focusMonth?: number): number {
  if (focusMonth && focusMonth > 0) { const e = priceAt(p, focusMonth); return e ? e.rent : Infinity; }
  return cheapestRent(p);
}
export function depositForSort(p: EntityRecord, focusMonth?: number): number {
  if (focusMonth && focusMonth > 0) { const e = priceAt(p, focusMonth); return e ? e.deposit : Infinity; }
  const l = priceList(p);
  return l.length ? Math.min(...l.map((x) => x.deposit)) : Infinity;
}
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

/**
 * 매물 신호 계층(엔카 집앞배송/환불 vs 진단뱃지 대응).
 *  · program  상품유형 — Badge 사진
 *  · status   출고상태 — Badge 사진
 *  · trust    심사 — 리본/칩
 *  · benefit  상시 혜택(무보증·연령·경력·무사고) — MetaIcon
 *  · event    한시 프로모(event_tags) — MetaIcon
 *  · spec     객관 스펙 — MetaIcon
 */
export type ProductSignal = { key: string; label: string; kind: 'program' | 'status' | 'trust' | 'benefit' | 'event' | 'spec' };

export function benefitSignals(p: EntityRecord): ProductSignal[] {
  // 비필수 혜택 — 상세카드 좌하단. 분납·무보증·연령·경력·무사고.
  const out: ProductSignal[] = [];
  if (installmentOk(p)) out.push({ key: 'ins', label: '분납가능', kind: 'benefit' });
  if (noDeposit(p)) out.push({ key: 'nd', label: '무보증', kind: 'benefit' });
  const age = minAge(p);
  if (age > 0 && age <= 21) out.push({ key: 'age', label: `만${age}세`, kind: 'benefit' });
  if (shortExperience(p)) out.push({ key: 'exp', label: '경력무관', kind: 'benefit' });
  const acc = String(p.accident_history || '').replace(/\s+/g, '');
  if (acc === '무사고') out.push({ key: 'acc', label: '무사고', kind: 'benefit' });
  return out;
}

/** 엑셀 조건칸 — 21세·분납·1년↓ 만. 없으면 빈 배열(표시=조건없음). */
export function excelCondSignals(p: EntityRecord): ProductSignal[] {
  const out: ProductSignal[] = [];
  const age = minAge(p);
  if (age > 0 && age <= 21) out.push({ key: 'age', label: '21세', kind: 'benefit' });
  if (installmentOk(p)) out.push({ key: 'ins', label: '분납', kind: 'benefit' });
  if (shortExperience(p)) out.push({ key: 'exp', label: '1년↓', kind: 'benefit' });
  return out;
}

/** 보증금 분납 가능 — 정책 deposit_installment가 있고 불가/없음이 아닐 때. */
export function installmentOk(p: EntityRecord): boolean {
  const v = String(policyOf(p).deposit_installment || p.deposit_installment || '').trim();
  if (!v) return false;
  if (/불가|불가능|없음|해당\s*없/.test(v)) return false;
  return true;
}

/** 썸네일 프로모 딱지 — entities SSOT 재export는 파일 상단. */

/** event_tags 파싱(콤마·슬래시·해시). 구표기(추가수수료면제)→수수료+. */
export function parseEventTags(raw: unknown): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  return s.split(/[,/#|]/).map((x) => {
    const t = x.trim();
    return PROMO_BADGE_LEGACY[t] || t;
  }).filter(Boolean);
}

export function joinEventTags(tags: string[]): string {
  const allow = new Set<string>(PROMO_BADGES_ACTIVE as unknown as string[]);
  const planned = new Set<string>(PROMO_BADGES_PLANNED as unknown as string[]);
  return [...new Set(tags.map((t) => {
    const x = (PROMO_BADGE_LEGACY[t.trim()] || t.trim());
    return x;
  }).filter((t) => t && allow.has(t) && !planned.has(t)))].slice(0, PROMO_MAX).join(',');
}

/** 한시 이벤트/프로모 — 썸네일 딱지·상세 CardEvents. 운영중 뱃지만 · 최대 MAX_PROMO_BADGES. */
export function eventSignals(p: EntityRecord): ProductSignal[] {
  const allow = new Set<string>(PROMO_BADGES_ACTIVE as unknown as string[]);
  return parseEventTags(p.event_tags || p.promo_tags)
    .filter((t) => allow.has(t))
    .slice(0, PROMO_MAX)
    .map((label, i) => ({ key: `ev${i}`, label, kind: 'event' as const }));
}

// 출고상태 — entities.VEHICLE_STATES SSOT.
// 계약금 입금 선점 → 계약중, 계약완료 → 출고불가(상품목록 숨김), 계약취소 → 출고가능.
export const VEHICLE_STATUS_TONES = {
  즉시출고: 'green', 출고가능: 'green', 상품화중: 'amber', 출고협의: 'blue', 계약중: 'orange', 출고불가: 'red',
} as const satisfies Record<string, 'green' | 'blue' | 'amber' | 'gray' | 'red' | 'orange'>;

export const UNKNOWN_VEHICLE_STATUS = '상태 확인' as const;
export const VEHICLE_DISPLAY_STATUSES = [...VEHICLE_STATES, UNKNOWN_VEHICLE_STATUS] as const;

const VEHICLE_STATUS_SET = new Set<string>(VEHICLE_STATES);

/** 운영 재고 목록·필터의 표시 상태. 원본 값은 변경하지 않고 누락·지원외만 드러낸다. */
export function normalizeVehicleDisplayStatus(value: unknown): (typeof VEHICLE_DISPLAY_STATUSES)[number] {
  const status = String(value ?? '').replace(/\s+/g, '');
  return VEHICLE_STATUS_SET.has(status)
    ? status as (typeof VEHICLE_STATES)[number]
    : UNKNOWN_VEHICLE_STATUS;
}

/**
 * 상품찾기·카탈로그 — **출고불가만** 숨김. 계약중은 마크 노출.
 *
 * ★거르는 상태를 늘리지 마라(사장님 2026-08-09).
 *   「재고에서 출고불가 빼고 다 올린다」가 기준이다. 활성 783대 − 출고불가 305대 = 458대.
 *
 *   · **출고협의**는 «일정 조율만 하면 되는 가능한 차»다. 팔 수 있으니 목록에 선다.
 *     이름만 보고 「협의 중이니 빼자」고 지우면 75대가 통째로 사라진다.
 *   · **계약중**도 숨기지 않는다 — 마크로 알린다. 숨기면 왜 안 보이는지 아무도 모른다.
 *   · 상태값이 **빈 차**도 여기서 거르지 않는다. 그건 «우리 데이터가 덜 채워졌다»는 뜻이지
 *     그 차를 못 판다는 뜻이 아니다(2026-08-06·08-07 결정과 같은 원칙).
 */
export function isHiddenFromCatalog(p: { vehicle_status?: unknown; _deleted?: unknown }): boolean {
  if (p._deleted === true) return true;
  return String(p.vehicle_status || '').replace(/\s+/g, '') === '출고불가';
}

/**
 * 실제 견적 가능한 상품 — **단건 접근의 기준**(공유 링크 `/q`, 상세 `/m`).
 * 상태뿐 아니라 읽기 SSOT(priceList)를 통과한 유효 대여료가 하나 이상 있어야 한다.
 * 관리자 재고·데이터점검의 정정 대상 노출에는 사용하지 않는다.
 */
export function isOfferableProduct(p: EntityRecord): boolean {
  return !isHiddenFromCatalog(p) && priceList(p).length > 0;
}

/**
 * **매물 등록 최소 요건** — 차량번호(번호미정 신차는 임시번호)와 대여료.
 *
 * 그 둘이면 실재하는 차고 팔 수 있는 차다. 차종이 마스터에 아직 안 붙었다는 건
 * «우리 데이터가 덜 정리됐다»는 뜻이지 그 차가 없다는 뜻이 아니다(2026-08-06 사장님 결정).
 */
export function hasMinimumListingFields(p: EntityRecord): boolean {
  const plate = String((p as Record<string, unknown>).car_number ?? '').replace(/\s+/g, '');
  return Boolean(plate) && priceList(p).length > 0;
}

/**
 * **목록에 실을 수 있는 상품** — 상품찾기·카탈로그·최근·관심.
 *
 * = 재고 전체매물 − 출고불가(·삭제). 차번·대여료 없어도 목록에 올린다(2026-08-07 사장님).
 * 차종 검수 대기(`_needs_master_review`)도 빼지 않는다 — 미확정은 «표시»로 알린다.
 *
 * ★단건(공유 링크 `/q`, 상세 `/m`)은 `isOfferableProduct` 가 따로 판단한다 —
 *   견적·상세는 유효 대여료가 있을 때만.
 */
/**
 * 손님·영업에게 **목록으로 내보낼 수 있는가.**
 *
 * 출고불가·삭제를 거르는 것만으로는 부족하다. 실측(2026-08-08 · 손님 카탈로그 431대):
 * 차번도 상태도 가격도 없는 **빈 껍데기 22대**가 그대로 노출되고 있었다
 * (`EXT_*` 키에 `variant` 만 남은 잔재 — 손님 화면에 「가솔린 2.5 2WD」로만 떴다).
 *
 * 목록에 서려면 **그 차가 실재한다는 최소 근거**가 있어야 한다 — 차번(번호미정 신차는 임시번호)과
 * 대여료. 그게 이미 `hasMinimumListingFields` 로 정의돼 있는데 카탈로그가 안 쓰고 있었다.
 *
 * ※ 차종이 마스터에 아직 안 붙은 것은 거르지 않는다. 그건 «우리 데이터가 덜 정리됐다»는 뜻이지
 *   그 차가 없다는 뜻이 아니다(2026-08-06 결정).
 */
export function isListableProduct(p: EntityRecord): boolean {
  if (isHiddenFromCatalog(p)) return false;
  /**
   * **팔 수 있다는 최소 근거**는 대여료다.
   *
   * 차번을 요구하면 안 된다 — 번호미정 신차는 임시번호가 아직 안 붙은 채로도 팔린다
   * (실측: 차종·가격이 멀쩡한 8대가 차번만 없었다). 그건 «차가 없다»는 뜻이 아니다.
   * 대여료가 하나도 없으면 그건 팔 물건이 아니라 잔재다.
   */
  return priceList(p).length > 0;
}

/**
 * **재고에 있는 차** — 요금은 안 따진다. 영업자 엑셀·재고 대조가 쓰는 기준이다.
 *
 * `isListableProduct` 와 갈라 두는 이유: 손님 카탈로그에 값 없는 카드를 세우면 안 되지만,
 * **영업자가 보는 표에는 있어야 한다**(사장님 2026-08-12 — 「공급사시트 erp 엑셀이 항상 같아야해」).
 * 요금이 아직 없는 차는 «없는 차»가 아니라 «값을 아직 못 받은 차»다.
 */
export function isStockedProduct(p: EntityRecord): boolean {
  if (isHiddenFromCatalog(p)) return false;
  /**
   * ★**차라고 말할 근거**가 있어야 한다 — 누구 차인지(공급사)와 무슨 차인지(차번 또는 차종).
   *   요금은 안 따진다(값을 아직 못 받은 차도 재고다). 하지만 둘 다 없으면 그건 잔재다.
   *   실측 2026-08-12: 파워트레인·연료만 있고 나머지가 전부 빈 `EXT_` 레코드 3건이
   *   영업자 표 맨 위에 빈 줄로 올라왔다 — 영업자가 「시트가 깨졌다」고 본 게 이것이다.
   *   ⚠ 차번이 없는 것 자체는 이유가 안 된다. 번호미정 신차는 차종·공급사가 있고 팔린다.
   */
  const named = String(p.car_number ?? '').trim() || String(p.model ?? '').trim() || String(p.sub_model ?? '').trim();
  const owned = String(p.provider_company_code ?? '').trim()
    || String(p.partner_code ?? '').trim()
    || String(p.provider_name ?? '').trim()
    || String(p.partner_name ?? '').trim();
  return !!(named && owned);
}

export function vehicleTone(s: string): 'green' | 'blue' | 'amber' | 'gray' | 'red' | 'orange' {
  if (s === UNKNOWN_VEHICLE_STATUS) return 'red';
  const k = s.replace(/\s+/g, '') as keyof typeof VEHICLE_STATUS_TONES;
  return VEHICLE_STATUS_TONES[k] || 'gray';
}

/* ── 매물 상세 = 정책 전면(원자단위). freepasserp3 product-detail-rows 이식 + audience 게이팅 ── */
export type KvRow = [string, string];
export type InsRow = [string, string, string]; // [구분, 보장한도, 면책금]
/**
 * **영업자 패널 둘째 표 — 계약 단계 정책**(운영정책 시트 `use: 계약서`).
 *
 * 상담용(`agentPanelRows`)과 굳이 나누는 이유: 성격이 다르다.
 *   상담용 = «이 손님이 되나, 얼마 드나» — 전화 받자마자 답해야 하는 값
 *   계약용 = «계약하면 어떻게 되나» — 도장 찍기 전에 확인하는 값
 * 한 표에 열몇 줄을 몰아 두면 상담 중에 위 여섯 줄을 못 찾는다(정책이 55열이라 계속 늘어난다).
 *
 * 손님 화면에는 안 나간다 — 이 값들은 계약서와 약관이 싣는다.
 */
export function agentContractRows(p: EntityRecord, audience: Audience = 'agent'): KvRow[] {
  if (audience === 'customer') return [];
  const pol = policyOf(p);
  const rec = p as Record<string, unknown>;
  const s = (k: string) => { const v = pol[k] ?? rec[k]; return v == null ? '' : String(v); };
  const g = (a: unknown[]) => a.filter(Boolean).join(' · ');
  // 제출서류 = 시트 체크 6 + 기타. 「무슨 서류 필요해요?」에 영업자가 바로 답해야 한다.
  const docs = policyEsignRequiredDocuments(pol).map((d) => d.label).join(' · ');
  /**
   * 기간·횟수 칸은 **단위를 붙여 찍는다**(사장님 2026-08-20 「보증금반환 30은 30일 안에 해준다는건가?」).
   * 규격(`policy-value-spec`)은 「N일」·「N회」로 쓰게 하고 **「숫자만 금지」**라고 못박았지만, 시트엔
   * 숫자만 들어온 값이 있다. 그대로 찍으면 30일인지 30개월인지 모른다 — 위약금 `0.3` 과 같은 부류다.
   * 값을 고치는 건 시트 쪽 일이고, 화면은 **읽을 수 있게** 만든다.
   */
  const unit = (k: string, u: string) => { const v = s(k); return v && /^\d+$/.test(v) ? `${v}${u}` : v; };
  return [
    ['결제', g([s('payment_method'), s('payment_timing'), s('payment_due_date') && `납부일 ${s('payment_due_date')}`])],
    ['보증금 반환', unit('deposit_return_days', '일') && `반납 후 ${unit('deposit_return_days', '일')} 이내`],
    ['법인 운전자범위', s('business_driver_scope')],
    ['연체 제재', g([
      unit('engine_control_overdue_days', '일') && `시동제어 ${unit('engine_control_overdue_days', '일')}`,
      unit('auto_terminate_overdue_days', '일') && `회수 ${unit('auto_terminate_overdue_days', '일')}`,
    ])],
    ['사고 해지기준', unit('accident_termination_count', '회') && `1년 내 ${unit('accident_termination_count', '회')}`],
    ['GPS', s('gps_installed')],
    ['제출서류', docs],
  ];
}

/**
 * 섹션 무게 — 상세가 «다 똑같은 카드 다섯 장»으로 납작해지지 않게 하는 축.
 *   main  = 손님·영업자 핵심(차량스펙·대여료). 카드가 떠 보인다.
 *   sub   = 부가(보험·계약조건·기타). 선을 낮춰 가라앉힌다.
 *   agent = 영업자 전용. **손님 화면(audience='customer')에서는 섹션째 만들어지지 않는다** —
 *           숨기는 게 아니라 애초에 없다. 「모드 토글」로 가리면 손님 앞에서 잘못 눌러 새어 나간다.
 */
export type DetailTier = 'main' | 'sub' | 'agent';
export type DetailSection =
  | {
      title: string; hint?: string; tier?: DetailTier; kind: 'kv'; rows: KvRow[];
      chips?: string[]; chipsLabel?: string; chipsAfter?: number;
      /**
       * **짝지어 흐르는 격자**(웹 2열). 값이 짧고 서로 대등해 «비교»가 아니라 «훑기»인 섹션만.
       *
       * 섹션의 성격은 장식이 아니라 «값이 어떻게 행동하는가»에서 나온다(사장님 2026-08-20
       * 「차량스펙만의 느낌, 대여료만의 느낌이 있어야」). 차량스펙은 값이 한 낱말이라 두 열로 흘려도
       * 읽히지만, 계약조건은 값이 문장이라 두 열로 쪼개면 줄이 접혀 오히려 못 읽는다.
       * 그래서 2열/1열 차이는 취향이 아니라 값 길이가 정한다 — 규격을 어겨도 어색하지 않은 이유다.
       */
      pair?: boolean;
    }
  | { title: string; hint?: string; tier?: DetailTier; kind: 'ins'; rows: InsRow[]; note?: string }
  | { title: string; hint?: string; tier?: DetailTier; kind: 'price' }
  | { title: string; hint?: string; tier?: DetailTier; kind: 'chips'; items: string[] };
export type Audience = 'customer' | 'agent' | 'admin';

/**
 * **영업자 패널 줄 — 상품상세 우측 고정 패널이 쓰는 값**(사장님 2026-08-20 목업).
 *
 * 상세 본문에는 안 넣는다. 본문에도 넣으면 같은 값이 한 화면에 두 번 찍힌다(「한 칸 한 원자」).
 * 손님 화면(`audience='customer'`)에서는 **패널 자체가 안 붙는다** — 숨기는 게 아니라 없다.
 *
 * ★무엇을 싣나 = «상담 중에 손님이 묻는데 화면에 없던 값».
 *   · 보증금 분납·카드결제 — 사장님 지목. 계약조건 표 안에 뭉쳐 있어 상담 중 못 찾았다.
 *   · 심사 — 이 손님이 되는 차인지가 첫 질문이다.
 *   · 중도해지 위약금 — 본문의 「결제 · 위약」은 상담 표기 하나(1년 미만 30%)뿐이라
 *     «1년 넘기면요?»에 못 답했다. 경과별 실요율 두 칸을 여기서 처음 보여 준다.
 *   · 주행 초과요금(1km당) — 「1만km 상향」(가격표)과 다른 값이다.
 *   · 승계 — 지금까지 전자계약에만 있었다. 해지는 위약금을 물고 끝내지만 승계는 남은 기간을
 *     새 임차인이 이어받아 손님이 낼 돈이 전혀 다르다.
 *
 * ★노출 범위(사장님 2026-08-20 「위약금·승계만 공개」): 공급사명·차고지·수수료 환수는 관리자만.
 *   영업사원이 공급사를 알면 직거래 여지가 생기고, 손님과 화면을 같이 볼 때 새기 때문이다.
 */
export function agentPanelRows(p: EntityRecord, audience: Audience = 'agent'): KvRow[] {
  if (audience === 'customer') return [];
  const pol = policyOf(p);
  const rec = p as Record<string, unknown>;
  const pv = (k: string) => { const v = rec[k]; return v == null ? '' : String(v); };
  const s = (k: string) => { const v = pol[k] ?? rec[k]; return v == null ? '' : String(v); };
  const g = (a: unknown[]) => a.filter(Boolean).join(' · ');
  const raw = (k: string) => pol[k] ?? rec[k];
  /**
   * 정액·정률 겸용 칸이라 **그대로 찍으면 안 된다** — 같은 뜻이 「30%」·「0.3」·「200원」·200 으로 섞여 들어온다.
   * 전자계약이 쓰는 포맷터를 그대로 태운다(표기 경로를 둘로 만들면 계약서와 상담 화면이 갈린다).
   */
  const termRate = (k: string) => {
    const n = moneyOrRatePercent(raw(k), { legacy: 'rate' });
    return n != null ? `${n}%` : moneyOrRateText(raw(k), { legacy: 'rate' });
  };
  const perKm = (k: string) => moneyOrRateText(raw(k), { legacy: 'won', noneText: '없음' });
  const rateU = termRate('early_termination_rate_under1y');
  const rateO = termRate('early_termination_rate_over1y');
  const rates = g([rateU && `1년 미만 ${rateU}`, rateO && `1년 이상 ${rateO}`]);
  const kmD = perKm('over_mileage_rate_domestic');
  const kmI = perKm('over_mileage_rate_imported');
  const succFee = moneyOrRateText(raw('succession_fee'), { legacy: 'won', naText: '승계 불가', noneText: '없음' });
  // 승계가 「불가」면 수수료를 붙이지 않는다 — 「불가 · 수수료 승계 불가」처럼 같은 말이 두 번 나온다.
  const succNo = /불가/.test(s('succession_allowed')) || succFee === '승계 불가';

  const rows: KvRow[] = [
    ['심사', creditDisplay(p)],
    // 계약이 «안 되는» 조건 — 상담 초반에 손님을 거르는 값이라 심사 바로 뒤에 둔다.
    //  시트의 불가조건 1~4 는 `policy-sheet-to-erp` 가 「·」로 이어 한 칸으로 만든다.
    ['불가조건', s('disqualification_conditions')],
    ['영업 특이사항', s('sales_notes')],
    ['보증금 분납', s('deposit_installment')],
    // ★두 칸 다 「불가」 아니면 수수료율이 적힌다(2026-08-21) — 값을 그대로 보인다.
    ['대여료 카드결제', s('rental_card_payment')],
    ['보증금 카드결제', s('deposit_card_payment')],
    // 요율 두 칸이 비면 상담 표기(penalty_condition)로 물러선다 — 빈 줄보다 낫다.
    ['중도해지 위약금', rates ? `${rates} · 잔여 대여료 기준` : s('penalty_condition')],
    ['주행 초과요금', g([kmD && `국산 ${kmD}/km`, kmI && `수입 ${kmI}/km`])],
    ['승계', succNo ? (s('succession_allowed') || '불가') : g([s('succession_allowed'), succFee && `수수료 ${succFee}`])],
  ];
  if (audience === 'admin') {
    rows.push(
      ['공급사', pv('provider_name') || pv('provider_company_code') || ''],
      ['차고지', pv('location')],
      // 수수료 환수는 뺐다(사장님 2026-08-20 「일단 빼줘」) — 우리와 공급사 사이 약정이라 상담에 안 쓴다.
      //  값은 정책(`commission_clawback_condition`)에 그대로 있고, 필요해지면 이 줄만 되살리면 된다.
    );
  }
  return rows;
}

export function detailSections(p: EntityRecord, audience: Audience = 'agent'): DetailSection[] {
  const pol = policyOf(p);
  const rec = p as Record<string, unknown>;
  const isAdmin = audience === 'admin';
  const pv = (k: string) => { const v = rec[k]; return v == null ? '' : String(v); };
  const s = (k: string) => { const v = pol[k] ?? rec[k]; return v == null ? '' : String(v); }; // 정책 우선 → 매물 폴백

  const g = (a: unknown[]) => a.filter(Boolean).join(' · ');
  // 묶음 슬롯 = 빠진 칸도 `-`로 자리 유지(동력·분류처럼 같이 쓰는 축).
  const gSlots = (parts: (string | number | false | null | undefined)[]) =>
    parts.map((x) => (x != null && x !== '' && x !== false ? String(x) : '미입력')).join(' · ');
  /**
   * 배기량 자리 — **전기차는 배터리 용량이 그 자리를 든다**(사장님 2026-08-23 「배터리용량 등등 쓸 수 있는 거 쭈욱」).
   * 전기차에 `engine_cc` 가 비는 것은 정상이라 그동안 이 칸이 늘 「미입력」이었다.
   * 둘 다 없을 때만 미입력 — 「있는 것만 쓴다」.
   */
  const ccLabel = (() => {
    const kwh = Number(p.battery_capacity) || 0;
    if (kwh > 0) return `${kwh}kWh`;
    const n = Number(p.engine_cc) || fuelEmbeddedCc(p.fuel_type);
    return n > 0 ? `${n.toLocaleString()}cc` : '미입력';
  })();
  // 1) 차량스펙(제조사 기준) = 신원 → 옵션칩 → 연식·주행 / 동력 / 색상 / 분류 / 최초등록
  const carRows: KvRow[] = [
    /**
      * **모델명 = 전문(全文)**. 제조사 + 모델 + 세부모델·트림까지 다 붙인다
      * (사장님 2026-08-20 「여기에 위에 풀로 다 들어가야지」).
      *
      * 한 번 「제조사 + 모델」로 줄였다가 되돌렸다. 줄인 이유는 «제목과 겹친다»였는데, 실제로는
      * **제목이 한 줄로 잘린다** — 목록·상세 머리의 차명은 폭을 넘으면 «…»로 끝난다.
      * 그래서 전문을 끝까지 읽을 수 있는 자리가 이 칸뿐이다. 겹치는 게 아니라 «잘린 것을 펴는» 자리다.
      * 값 칸은 `DT.td`(overflowWrap:anywhere)라 길면 줄을 바꿔 다 보인다.
      *
      * ★조립은 vehicle-name SSOT(T2 full — 상세·계약·공유가 쓰는 그 이름)로 — 손조립을 쓰면
      *   제목·공유 문구와 글자가 어긋난다(사장님 2026-08-22 「표 안에 차명도 동일하게」).
      */
    /**
     * ★**차명 = 세부모델 + 세부트림**(사장님 2026-08-22 「표현은 기본이 차명 = 세부모델 + 세부트림」).
     *   제조사는 뺀다 — 바로 위 제목 줄이 이미 들고 있고, 정제칸이 축을 갈라 둔 뒤로는
     *   «차명»이라 부르는 것이 곧 이 두 축이다(배기량·연료 같은 제원은 아래 부가정보 줄이 든다).
     */
    ['차명', vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', omitMaker: true }) || '미입력'],
    // 차량번호는 손님에게도 보인다 — 공유 견적서에서 «어느 차인지»를 특정하는 유일한 값이다.
    //  (없는 매물이 있다: 재렌트·재구독은 공급사 시트에 번호판을 안 적는 경우가 있어
    //   빈 줄을 만들지 않도록 값이 있을 때만 넣는다. 나머지 행의 `-` 규칙과 다른 이유다.)
    ...(pv('car_number') ? [['차량번호', pv('car_number')] as KvRow] : []),
    ['연식 · 주행', (() => {
      const base = gSlots([yearDisplay(p.year), kmDisplay(p.mileage)]);
      const acc = pv('accident_history');
      return acc ? `${base} · ${acc}` : base;
    })()],
    /*
     * **한 줄에는 한 축만 넣는다**(사장님 2026-08-20 「인승과 동력이 무슨 상관이고 · 차종 크기 구분을 상품분류랑 같이 넣어놓고」).
     *
     * 예전엔 이렇게 섞여 있었다:
     *   동력 = 연료 · 구동 · 배기량 · **인승**        ← 인승은 «차의 몸»이지 동력이 아니다
     *   분류 = 차급 · 용도 · **중고렌트**             ← 중고렌트는 «상품 형태»지 차종 분류가 아니다
     * 값이 옆에 나란히 서면 사람은 «같은 갈래»로 읽는다. 그래서 축을 갈라 세운다:
     *   동력 = 엔진이 어떻게 굴러가나 (연료 · 구동 · 배기량)
     *   차종 = 차가 어떤 몸인가       (차급 · 인승 · 용도)
     * 상품 형태(신차렌트·중고구독)는 여기서 뺀다 — 카드·상세 머리의 CORE 뱃지가 이미 들고 있어
     * 같은 값이 한 화면에 두 번 찍힌다(「한 칸 한 원자」).
     */
    ['동력', gSlots([
      fuelDisplay(p.fuel_type) || pv('fuel_type'),
      pv('drive_type'),
      ccLabel,
    ])],
    /*
     * 색은 «빈칸»과 «하이픈»이 같은 뜻이다 — 공급사 시트에 `-`·`—`·`.`·`N/A` 가 값으로 들어온다
     * (사장님 2026-08-20 「내장색 미입력으로 가 줘야 하고」 — 화면에 「내장색 -」로 찍히고 있었다).
     * 빈 문자열만 걸러 내면 하이픈이 색 이름 행세를 한다. 여기서 한 번에 미입력으로 눕힌다.
     */
    ['색상', (() => {
      const colorOf = (key: string) => {
        const v = pv(key);
        return !v || /^[-–—.]+$/.test(v) || /^(n\/?a|없음|미정)$/i.test(v) ? '미입력' : v;
      };
      return [`외장색 ${colorOf('ext_color')}`, `내장색 ${colorOf('int_color')}`].join(' · ');
    })()],
    /*
     * 차종 = 차급 + 인승. **용도(자가용/영업용/관용)는 뺐다**(사장님 2026-08-20 「용도 빼」) —
     * 등록증에서 오는 값인데 우리 데이터엔 대부분 비어 있고, 렌터카는 어차피 대여용이라
     * 상담에서 쓸 일이 없다. 빈 칸이 「미입력」으로 서서 «무엇이 빈 건지»만 헷갈리게 했다.
     * 빈 값은 자리를 남기지 않는다(`gSlots` 아님) — 성격이 다른 값이 모인 줄이라 있는 것만 잇는다.
     */
    /* 차종 = 차급 · 인승 · 원산지. 원산지를 여기 세운 것은 «쓸 수 있는 원자는 쭉 쓴다»(사장님 2026-08-23)에 따른 것 —
       98% 차 있는데 화면 어디에도 안 서 있었다. 국산/수입은 **보증금 배율(국산 ×2 · 수입 ×3)의 근거**라
       표시값이 아니라 돈이 걸린 값이다. 빈 값은 자리를 남기지 않는다(`g`) — 있는 것만 잇는다. */
    ['차종', g([pv('vehicle_class'), p.seats ? `${p.seats}인승` : '', pv('origin')])],
    /* 최초등록일은 「기타사항」으로 옮겼다(사장님 2026-08-23 「최초등록일은 기타사항에 들어가 주는 거고」) —
       차를 고르는 값이 아니라 참고값이다. 차량스펙은 «어떤 차인가»를 가르는 원자만 든다. */
  ];
  /**
   * 차량가격 = 공급사 시트 「차량가격」(별칭 소비자가격·차량가·차량가액 — `sheet-import`) = **차량 출고가**.
   * 우리 매입원가가 아니다. 판매시트에도 「소비자가격」 열로 이미 나가고, 취등록세·인수금의 기준이라
   * 상담에서 자주 묻는 값이다(사장님 2026-08-20 「차량정보에 차량가격을 빼먹었네」).
   *
   * ⚠ **값이 오는 역할에만 줄을 세운다.** `vehicle_price` 는 RTDB `products_private` 로 갈라져 있고
   *   `rtdb-adapter.readProductPrivate` 가 admin·provider 에게만 읽어 병합한다 — 영업사원 브라우저엔
   *   애초에 안 온다. 그런데도 줄을 세우면 «우리도 모르는 값»처럼 「—」가 찍혀 영업자가 손님에게
   *   잘못 말한다. 손님 화면은 화이트리스트(`public-catalog`)에서 빠져 있어 어차피 값이 없다.
   *   → 영업사원·손님에게도 보이려면 노출 결정 + 규칙·리더 변경이 필요하다(표시 문제가 아니다).
   */
  if (audience !== 'customer' && (p.vehicle_price || isAdmin)) {
    carRows.push(['차량가격', p.vehicle_price ? wonLabel(Number(p.vehicle_price)) : '']);
  }

  // 2) 보험 3열 [구분, 한도, 면책금] — 6항목 항상 노출(값 없으면 뷰에서 '—')
  // 자차 면책: 비율형=「수리비의 OO%」(+구간) / 정액형(비율 없음)=금액만(동일값이면 단일)
  const ownDed = (() => {
    const raw = s('own_damage_repair_ratio').trim();
    const lo = String(pol.own_damage_min_deductible ?? '').trim();
    const hi = String(pol.own_damage_max_deductible ?? '').trim();
    const amount = lo && hi ? (lo === hi ? lo : `${lo}~${hi}`) : (lo || hi || '');
    if (!raw) return amount; // 정액
    const ratio = /수리비/.test(raw) ? raw : `수리비의 ${raw}`;
    return [ratio, amount].filter(Boolean).join(' · ');
  })();
  // 담보 = 한도·면책 성격 항목만(대인~자차). 긴급출동은 성격 달라 표에서 빼 아래 노트로.
  const insRows: InsRow[] = [
    ['대인', s('injury_compensation_limit'), s('injury_deductible')],
    ['대물', s('property_compensation_limit'), s('property_deductible')],
    ['자손사고', String(pol.self_body_accident ?? pol.personal_injury_compensation_limit ?? ''), String(pol.self_body_deductible ?? pol.personal_injury_deductible ?? '')],
    ['무보험상해', String(pol.uninsured_damage ?? pol.uninsured_compensation_limit ?? ''), s('uninsured_deductible')],
    ['자차손해', s('own_damage_compensation'), ownDed],
  ];
  // 긴급출동(담보 아님) — 표 아래 구분 노트. 보험 포함여부는 위 가격캡션에 이미 있어 제외.
  const roadside = String(pol.annual_roadside_assistance ?? pol.roadside_assistance ?? '');
  const insNote = roadside ? `긴급출동 ${roadside}` : '';

  // 3) 계약조건 = 심사·약정·담보·결제·운전자·물류·서비스
  const meta = (rec.sheet_meta || {}) as Record<string, unknown>;
  const m2 = (k: string) => { const v = meta[k]; return v == null ? '' : String(v); };
  /* 오토플러스 전용 주행 상향요금 라벨은 뺐다(2026-08-23) — 주행 약정은 정책값만 쓴다. 위 「주행 약정」 주석 참고. */
  /**
   * 계약조건 = **손님이 고르는 데 필요한 정책**(운영정책 시트에서 `use: 상품시트 | 둘다`).
   *
   * ★심사조건은 **손님에게 안 보인다**(정책 정본 `policy-sheet-layout` 「영업자 화면 심사 뱃지 — 손님·계약서엔 안 나감」).
   *   게다가 `screening_criteria` 는 손님 화이트리스트(`public-catalog`)에 없어 값이 안 넘어가므로,
   *   줄만 두면 손님에게 **「심사 · 미입력」**이 찍힌다. 보여선 안 되는 칸이 빈 값으로 보이는 최악의 조합이라 아예 뺀다.
   *   영업자는 우측 패널(`agentPanelRows`)에서 본다.
   */
  const condRows: KvRow[] = [
    ...(audience === 'customer' ? [] : [['심사', creditDisplay(p)] as KvRow]),
    /**
     * ★**주행 약정 = 정책값. 없으면 「미입력」**(사장님 2026-08-23 「정책에 주행거리가 비어 있으면
     *   그냥 빈 주행거리가 미입력으로 되는 거지 뭐」).
     * ⚠ 전에는 오토플러스만 **「연 2만km」를 코드에 박아** 보여 줬다. 그런데 실측 2026-08-23 —
     *   오플 79대의 정책(`pol_freepassstd`) 기본주행이 **빈칸**이라, 화면은 「연 2만km」라고 말하는데
     *   12개월 요금은 실제로 **3만km 조건**이었다. 없는 값을 코드가 지어내면 그게 곧 거짓말이 된다.
     *   요금이 몇 km 기준인지는 아래 대여료 표의 **「주행거리별」 줄**이 글자 그대로 보여 준다.
     */
    ['주행 약정', g([s('annual_mileage'), s('mileage_upcharge_per_10000km') && `1만km초과 ${s('mileage_upcharge_per_10000km')}`]) || '미입력'],
    ['보증금', g([s('deposit_installment') && `분납 ${s('deposit_installment')}`, s('deposit_card_payment') && `카드 ${s('deposit_card_payment')}`])],
    ['대여료 카드결제', s('rental_card_payment')],
    /*
     * **손님 화면에는 위약금을 안 싣는다**(사장님 2026-08-20 「손님 보는 거에는 위약금이나 이런 패널티 조항은 빼자」).
     * 상담 자리에서 «어떤 차를 얼마에» 를 보는 화면인데 벌칙 조항이 같이 서면 계약서를 읽는 화면이 된다.
     * 위약 조건 자체는 없애는 게 아니라 **말할 사람이 말하도록** 옮긴 것이다 —
     * 영업자 패널의 「중도해지 위약금」이 그대로 들고 있고, 확정된 조건은 전자계약서가 든다.
     */
    ...(audience === 'customer'
      ? [['결제', s('payment_method')] as KvRow]
      : [['결제 · 위약', g([s('payment_method'), s('penalty_condition') && `위약 ${s('penalty_condition')}`])] as KvRow]),
    // 연령인하·하향 요금은 시트 규격 칸(`driver_age_lowering`·`age_lowering_cost`). 옛 sheet_meta 21·23세 칸은 뒤에 남겨 둔다.
    ['운전 연령', g([
      s('basic_driver_age') && `기본 ${s('basic_driver_age')}`,
      s('driver_age_upper_limit') && `상한 ${s('driver_age_upper_limit')}`,
      s('driver_age_lowering') && `하향 ${s('driver_age_lowering')}${s('age_lowering_cost') ? ` ${s('age_lowering_cost')}` : ''}`,
      m2('age_21') && `21세 ${m2('age_21')}`,
      m2('age_23') && `23세 ${m2('age_23')}`,
    ])],
    ['면허 경력', s('license_period')],
    ['운전자 범위', g([s('personal_driver_scope'), s('business_driver_scope'), s('additional_driver_allowance_count') && `추가운전 ${/^\d+$/.test(s('additional_driver_allowance_count')) ? `${s('additional_driver_allowance_count')}인까지` : s('additional_driver_allowance_count')}`, s('additional_driver_cost')])],
    ['대여지역 · 탁송', g([s('rental_region'), s('delivery_fee') && `탁송 ${s('delivery_fee')}`])],
    // 대차는 사고가 나면 손님이 가장 먼저 묻는 값인데 화면 어디에도 없었다.
    ['정비 · 대차', g([s('maintenance_service'), s('replacement_car_policy') && `대차 ${s('replacement_car_policy')}`])],
  ];

  const opts = parseProductOptions(p.options);
  const memo = String(p.partner_memo ?? p.note ?? '').trim();
  const otherRows: KvRow[] = [];
  /**
   * ★**공급사 차명 원문**(사장님 2026-08-22 「상세페이지 기타에 공급사 차명을 넣어주자, 정제된 거 말고 · 모바일도」).
   *   위 「차명」 칸은 정제값(세부모델+세부트림)이다. 이 칸은 **공급사가 시트에 적은 글자 그대로**라
   *   둘이 다르면 «우리가 어떻게 바꿔 읽었나»가 한눈에 보인다 — 담당자가 공급사와 통화할 때 쓰는 이름이기도 하다.
   *   ⚠ **정제값과 같아 보여도 세운다**(사장님 2026-08-23 「정제하지 말고 넣어주자고 혹시나 해서」) —
   *     띄어쓰기 한 칸만 달라도 공급사와 말이 어긋나는 자리라, «없다»와 «같다»를 담당자가 구분할 수 있어야 한다.
   */
  const supplierName = audience === 'customer' ? '' : String(p.supplier_vehicle_name ?? '').trim();
  const supplierOptions = audience === 'customer' ? '' : String(p.supplier_options ?? '').trim();
  // 손님 화면엔 안 낸다 — 우리가 어떻게 바꿔 읽었는지는 내부 대조용이다(화이트리스트에도 없어 값 자체가 안 온다).
  if (supplierName) otherRows.push(['공급사 차명', supplierName]);
  // 「2중 보관」의 나머지 반쪽(사장님 2026-08-23) — 위 「선택옵션」은 정제값이고 이 줄은 공급사가 적은 글자다.
  if (supplierOptions) otherRows.push(['공급사 옵션', supplierOptions]);
  // 공급사 원본이 `25-11-5` 처럼 들쭉날쭉해서 표기만 YYYY-MM-DD 로 맞춘다(못 읽으면 원본 그대로).
  const firstReg = ymdDisplay(pv('first_registration_date'));
  if (firstReg) otherRows.push(['최초등록', firstReg]);
  if (memo) otherRows.push(['특이사항', memo]);
  // 관리자 진단값 — 데이터가 맞는지 확인하는 칸이라 상담에 안 쓴다(상담용은 우측 패널 `agentPanelRows`).
  //  공급사·차고지·수수료 환수는 패널이 들고 있어 여기서 뺐다 — 같은 값을 두 번 찍지 않는다.
  if (isAdmin) {
    otherRows.push(
      ['차령 · 차대', g([pv('vehicle_age_expiry_date') && `만료 ${ymdDisplay(pv('vehicle_age_expiry_date'))}`, pv('vin')])],
      ['등록증', g([pv('transmission'), pv('cert_car_name'), pv('type_number'), pv('engine_type')])],
      ['정책', g([String(pol.policy_name ?? p.policy_name ?? ''), String(pol.policy_code ?? p.policy_code ?? ''), String(pol.policy_type ?? '')])],
      ['상품', g([pv('product_code'), String(p._key ?? '')])],
    );
  }

  // 상세 읽기 순서 SSOT(사장님 2026-08-19):
  // 사진(뷰) → 차량스펙(제조사) → 대여료조건 → 보험조건 → 계약조건 → 기타사항.
  //  영업자 전용 값은 본문이 아니라 **우측 영업자 패널**(`agentPanelRows`)이 들고 간다.
  const out: DetailSection[] = [
    { title: '차량스펙', hint: '제조사 기준', tier: 'main', kind: 'kv', rows: carRows, chips: opts, chipsLabel: '선택옵션', chipsAfter: 1, pair: true },
    { title: '대여료조건', hint: '기간별 대여료 · 보증금', tier: 'main', kind: 'price' },
    { title: '보험조건', hint: '보장한도 · 면책', tier: 'sub', kind: 'ins', rows: insRows, note: insNote },
    { title: '계약조건', hint: '심사 · 약정 · 운전자', tier: 'sub', kind: 'kv', rows: condRows },
  ];
  if (otherRows.length) {
    out.push({ title: '기타사항', tier: 'sub', kind: 'kv', rows: otherRows });
  }
  return out;
}
