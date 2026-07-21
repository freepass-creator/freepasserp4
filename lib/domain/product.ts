/**
 * 매물(product) 도메인 — 가격맵·차량명·정책조건·검색필터. (freepasserp3 product-filters/policy 이식)
 * product는 정책(_policy, ~30필드)을 물고 옴 → 검색·상세가 정책조건까지 포함.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { MAX_PROMO_BADGES as PROMO_MAX, PROMO_BADGES, PROMO_BADGE_LEGACY, VEHICLE_STATES, PRODUCT_TYPES, PRODUCT_TYPE_LEGACY } from '@/lib/intake/entities';
import { fuelDisplay, fuelEmbeddedCc, yearDisplay, makerDisplay } from '@/lib/domain/vehicle-master-match';
import { kmDisplay } from '@/lib/format';
export { PROMO_BADGES, MAX_PROMO_BADGES } from '@/lib/intake/entities';
export const VEHICLE_STATUSES = VEHICLE_STATES;

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

const num = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n; };

export type Price = { m: number; rent: number; deposit: number; fee: number };
export type Policy = Record<string, unknown>;

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
export const PERIOD_ROWS: readonly (readonly number[])[] = [[1, 12, 24], [36, 48, 60]];

/** 유효 기간 — 양수 개월. 6·18 포함(데이터 있으면 필터·상세). */
export function isOperatedPeriod(m: number): boolean {
  return Number.isFinite(m) && m > 0;
}
/** 표준 표 기간 — 엑셀 열. */
export function isStandardPeriod(m: number): boolean {
  return (PERIODS as readonly number[]).includes(m);
}

/** 기간별 가격 목록 (m 오름차순). 데이터에 있는 기간 전부(6·18 포함). */
export function priceList(p: EntityRecord): Price[] {
  const price = (p.price || {}) as Record<string, { rent?: number; deposit?: number; fee?: number }>;
  // 월(m)별 단일 가격으로 통합 — 주행거리 변형(24_3만 등)은 추가요금=정책 담당이라 기간에서 접는다.
  // 표준키('24') 우선, 없으면 최저 대여료 변형을 기본가로. 중복 개월·"(3만)" 라벨 제거.
  const byM = new Map<number, { e: Price; plain: boolean }>();
  for (const [k, v] of Object.entries(price)) {
    const rawRent = num(v?.rent); if (rawRent <= 0) continue;
    const { rent, deposit } = normalizeWonPair(rawRent, v?.deposit);
    // 대여료 이상치 방어(v3 이식) — 하한 10만·상한 2천만 밖 = 오입력(자릿수 오타·노트 숫자 추출 등) → 제외.
    if (rent < 100_000 || rent > 20_000_000) continue;
    const m = Number(k.includes('_') ? k.slice(0, k.indexOf('_')) : k);
    if (!isOperatedPeriod(m)) continue;
    const plain = !k.includes('_'); const cur = byM.get(m);
    if (!cur || (plain && !cur.plain) || (plain === cur.plain && rent < cur.e.rent)) {
      byM.set(m, { e: { m, rent, deposit, fee: num(v?.fee) }, plain });
    }
  }
  const list = [...byM.values()].map((x) => x.e).sort((a, b) => a.m - b.m);
  // 역전 방어(v3 이식) — 짧은 기간이 더 긴 기간보다 5%↑ 쌈 = 불가능(단기가 더 비싸야) → 짧은 쪽 오입력 제거.
  return list.filter((e, i) => !list.slice(i + 1).some((lo) => lo.rent > e.rent * 1.05));
}

/** 표준 기간만 — 엑셀·종합표용. */
export function standardPriceList(p: EntityRecord): Price[] {
  return priceList(p).filter((x) => isStandardPeriod(x.m));
}

/** 선택 기간의 가격 (없으면 가장 가까운 기간) */
export function priceAt(p: EntityRecord, target: number): Price | null {
  const l = priceList(p);
  if (!l.length) return null;
  return l.find((e) => e.m === target) || l.slice().sort((a, b) => Math.abs(a.m - target) - Math.abs(b.m - target))[0];
}

export function vehicleName(p: EntityRecord): string {
  return [makerDisplay(p.maker) || p.maker, p.sub_model || p.model, p.trim_name].filter(Boolean).join(' ') || String(p.car_number || '차량');
}

/** 심사표기 — 무심사 / 소득확 (3글자 뱃지 SSOT. 정책 screening_criteria 우선) */
export function creditDisplay(p: EntityRecord): string {
  const v = String(policyOf(p).screening_criteria || p.screening_criteria || p.credit_grade || '');
  if (/무심사|신용 *무관|소득 *무관|저신용/.test(v)) return '무심사';
  if (/신용 *조회|신용 *필요|소득 *확인|소득 *조회|등급|심사\s*필|심사\s*필요|소득확/.test(v)) return '소득확';
  return v || '무심사';
}
export function isReview(p: EntityRecord): boolean { return creditDisplay(p) === '소득확'; }
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
/** 기간 중 최저 보증금(무보증=0). 정렬·필터용. */
export function minDeposit(p: EntityRecord): number {
  const l = priceList(p);
  return l.length ? Math.min(...l.map((x) => x.deposit)) : Infinity;
}
/** 선택 기간 대여료(없으면 최저). 정렬 시 필터기간 1개와 맞춤. */
export function rentForSort(p: EntityRecord, focusMonth?: number): number {
  if (focusMonth && focusMonth > 0) { const e = priceAt(p, focusMonth); return e ? e.rent : Infinity; }
  return cheapestRent(p);
}
export function depositForSort(p: EntityRecord, focusMonth?: number): number {
  if (focusMonth && focusMonth > 0) { const e = priceAt(p, focusMonth); return e ? e.deposit : Infinity; }
  return minDeposit(p);
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
  const allow = new Set<string>(PROMO_BADGES as unknown as string[]);
  return [...new Set(tags.map((t) => {
    const x = (PROMO_BADGE_LEGACY[t.trim()] || t.trim());
    return x;
  }).filter((t) => t && allow.has(t)))].slice(0, PROMO_MAX).join(',');
}

/** 한시 이벤트/프로모 — 썸네일 딱지·상세 CardEvents. PROMO_BADGES 화이트리스트 · 최대 MAX_PROMO_BADGES. */
export function eventSignals(p: EntityRecord): ProductSignal[] {
  const allow = new Set<string>(PROMO_BADGES as unknown as string[]);
  return parseEventTags(p.event_tags || p.promo_tags)
    .filter((t) => allow.has(t))
    .slice(0, PROMO_MAX)
    .map((label, i) => ({ key: `ev${i}`, label, kind: 'event' as const }));
}

// 출고상태 — entities.VEHICLE_STATES SSOT (위 VEHICLE_STATUSES re-export).
// 계약금 입금 선점 → 계약중, 계약완료 → 출고불가(상품목록 숨김), 계약취소 → 출고가능.
export const VEHICLE_STATUS_TONES = {
  즉시출고: 'green', 출고가능: 'green', 상품화중: 'amber', 출고협의: 'blue', 계약중: 'orange', 출고불가: 'red',
} as const satisfies Record<string, 'green' | 'blue' | 'amber' | 'gray' | 'red' | 'orange'>;

/** 상품찾기·카탈로그 — 출고불가만 숨김. 계약중은 마크 노출. */
export function isHiddenFromCatalog(p: { vehicle_status?: unknown; _deleted?: unknown }): boolean {
  if (p._deleted === true) return true;
  return String(p.vehicle_status || '') === '출고불가';
}

export function vehicleTone(s: string): 'green' | 'blue' | 'amber' | 'gray' | 'red' | 'orange' {
  const k = s.replace(/\s+/g, '') as keyof typeof VEHICLE_STATUS_TONES;
  return VEHICLE_STATUS_TONES[k] || 'gray';
}

/* ── 매물 상세 = 정책 전면(원자단위). freepasserp3 product-detail-rows 이식 + audience 게이팅 ── */
export type KvRow = [string, string];
export type InsRow = [string, string, string]; // [구분, 보장한도, 면책금]
// tier: main=손님·영업자 핵심(차량·대여료), sub=부가(보험·계약조건·기타). 상세에서 시각 구분.
export type DetailSection =
  | { title: string; tier?: 'main' | 'sub'; kind: 'kv'; rows: KvRow[]; chips?: string[]; chipsLabel?: string; chipsAfter?: number }
  | { title: string; tier?: 'main' | 'sub'; kind: 'ins'; rows: InsRow[]; note?: string }
  | { title: string; tier?: 'main' | 'sub'; kind: 'price' }
  | { title: string; tier?: 'main' | 'sub'; kind: 'chips'; items: string[] };
export type Audience = 'customer' | 'agent' | 'admin';

export function detailSections(p: EntityRecord, audience: Audience = 'agent'): DetailSection[] {
  const pol = policyOf(p);
  const rec = p as Record<string, unknown>;
  const isAdmin = audience === 'admin';
  const pv = (k: string) => { const v = rec[k]; return v == null ? '' : String(v); };
  const s = (k: string) => { const v = pol[k] ?? rec[k]; return v == null ? '' : String(v); }; // 정책 우선 → 매물 폴백
  const money = (v: unknown, suf: string) => (v ? Number(v).toLocaleString() + suf : '');

  const g = (a: unknown[]) => a.filter(Boolean).join(' · ');
  // 묶음 슬롯 = 빠진 칸도 `-`로 자리 유지(동력·분류처럼 같이 쓰는 축).
  const gSlots = (parts: (string | number | false | null | undefined)[]) =>
    parts.map((x) => (x != null && x !== '' && x !== false ? String(x) : '-')).join(' · ');
  const ccLabel = (() => {
    const n = Number(p.engine_cc) || fuelEmbeddedCc(p.fuel_type);
    return n > 0 ? `${n.toLocaleString()}cc` : '';
  })();
  // 1) 차량 세부정보 = 신원 → 옵션칩 → 연식·주행 / 동력 / 색상 / 분류 / 최초등록
  const carRows: KvRow[] = [
    ['차량', [pv('maker'), pv('sub_model') || pv('model'), pv('variant'), pv('trim_name')].filter(Boolean).join(' ') || '-'],
    ['연식 · 주행', (() => {
      const base = gSlots([yearDisplay(p.year), kmDisplay(p.mileage)]);
      const acc = pv('accident_history');
      return acc ? `${base} · ${acc}` : base;
    })()],
    ['동력', gSlots([
      fuelDisplay(p.fuel_type) || pv('fuel_type'),
      pv('drive_type'),
      ccLabel,
      p.seats ? `${p.seats}인승` : '',
    ])],
    ['색상', gSlots([
      pv('ext_color') ? `외장 ${pv('ext_color')}` : '',
      pv('int_color') ? `내장 ${pv('int_color')}` : '',
    ])],
    ['분류', gSlots([pv('vehicle_class'), pv('usage'), canonProductType(p.product_type)])],
    ['최초등록', pv('first_registration_date') || '-'],
  ];

  // 2) 보험 3열 [구분, 한도, 면책금] — 6항목 항상 노출(값 없으면 뷰에서 '—')
  const ownDed = (() => {
    const ratio = s('own_damage_repair_ratio');
    const lo = pol.own_damage_min_deductible, hi = pol.own_damage_max_deductible;
    const range = lo && hi ? `${lo}~${hi}` : String(lo || hi || '');
    return [ratio, range].filter(Boolean).join(' · ');
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

  // 3) 계약조건 = 역할별 묶음(진입 / 사용제한 / 담보 / 결제 / 운전자 / 물류 / 서비스)
  const meta = (rec.sheet_meta || {}) as Record<string, unknown>;
  const m2 = (k: string) => { const v = meta[k]; return v == null ? '' : String(v); };
  const condRows: KvRow[] = [
    ['심사', creditDisplay(p)],
    ['주행 약정', g([s('annual_mileage'), s('mileage_upcharge_per_10000km') && `1만km초과 ${s('mileage_upcharge_per_10000km')}`])],
    ['보증금', g([s('deposit_installment') && `분납 ${s('deposit_installment')}`, s('deposit_card_payment') && `카드 ${s('deposit_card_payment')}`])],
    ['결제 · 위약', g([s('payment_method'), s('penalty_condition') && `위약 ${s('penalty_condition')}`])],
    ['운전 연령', g([s('basic_driver_age') && `기본 ${s('basic_driver_age')}`, s('driver_age_upper_limit') && `상한 ${s('driver_age_upper_limit')}`, m2('age_21') && `21세 ${m2('age_21')}`, m2('age_23') && `23세 ${m2('age_23')}`])],
    ['운전자 범위', g([s('personal_driver_scope'), s('business_driver_scope'), s('additional_driver_allowance_count') && `추가 ${s('additional_driver_allowance_count')}명`, s('additional_driver_cost')])],
    ['대여지역 · 탁송', g([s('rental_region'), s('delivery_fee') && `탁송 ${s('delivery_fee')}`])],
    ['정비 서비스', s('maintenance_service')],
  ];

  const opts = Array.isArray(p.options) ? (p.options as unknown[]).map(String) : (p.options ? String(p.options).split(/[,/]+/).map((x) => x.trim()).filter(Boolean) : []);

  // 손님·영업자 시선: 메인(대여료/보증금=얼마 먼저, 차량정보=스펙+옵션) → 부가(보험, 계약조건, 기타).
  const out: DetailSection[] = [
    { title: '대여료 / 보증금', tier: 'main', kind: 'price' },
    { title: '차량 세부정보', tier: 'main', kind: 'kv', rows: carRows, chips: opts, chipsLabel: '선택옵션', chipsAfter: 1 },
    { title: '보험정보', tier: 'sub', kind: 'ins', rows: insRows, note: insNote },
    { title: '계약조건', tier: 'sub', kind: 'kv', rows: condRows },
  ];
  // 기타정보(관리자) = 원가·이력·등록증·코드·정산. 역할별 묶음.
  if (isAdmin) out.push({ title: '기타정보', tier: 'sub', kind: 'kv', rows: [
    ['원가 · 위치', g([money(p.vehicle_price, '원'), pv('location') && `위치 ${pv('location')}`])],
    ['차령 · 차대', g([pv('vehicle_age_expiry_date') && `만료 ${pv('vehicle_age_expiry_date')}`, pv('vin')])],
    ['등록증', g([pv('transmission'), pv('cert_car_name'), pv('type_number'), pv('engine_type')])],
    ['정책', g([String(pol.policy_name ?? p.policy_name ?? ''), String(pol.policy_code ?? p.policy_code ?? ''), String(pol.policy_type ?? '')])],
    ['공급 · 영업', g([pv('provider_company_code'), pv('partner_code')])],
    ['상품', g([pv('product_code'), String(p._key ?? '')])],
    ['수수료 환수', s('commission_clawback_condition')],
    ['특이사항', String(p.partner_memo ?? p.note ?? '')],
  ] });
  return out;
}
