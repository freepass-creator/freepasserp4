/**
 * 손님 공개면(`/q`·`/catalog`)에 내보낼 값만 고르는 화이트리스트 — 순수 함수.
 *
 * ★왜 필요한가
 *   fp4 의 손님 페이지는 브라우저가 RTDB 를 **직접** 읽게 돼 있었다. 규칙이 인증을 요구하므로
 *   비로그인 손님에게는 401 이 떨어져 «견적을 찾을 수 없습니다»만 보였다(2026-07-30 QA · 2026-08-07 실측).
 *   규칙을 열어 해결하면 원가·수수료·회원까지 함께 새므로, erp3(`api/catalog-feed.js`)와 같이
 *   **서버가 서비스계정으로 읽고 걸러서** 준다. RTDB 규칙은 한 줄도 건드리지 않는다.
 *
 * ★막아야 하는 것은 **영업 수수료**다 — `fee_rate`(공급사율) · `agent_payout_rate`(영업자 지급율).
 *   이 둘은 매물이 아니라 **파트너·회원**에 있고(`settlement-engine.resolveRates`), 이 API 는
 *   파트너를 아예 읽지 않으며 회원에서는 담당자 표시용(이름·전화)만 뽑는다 — 구조적으로 못 샌다.
 *   그래도 화이트리스트를 유지하는 이유는 나중에 매물에 그런 필드가 생겨도 자동으로 막히게 하려는 것이다.
 *
 * ★내부메모(`partner_memo`)·공급사코드(`provider_company_code`)는 손님이 볼 값이 아니라 뺀다.
 *   원가(`vehicle_price`)는 이 사업에 아예 없는 개념이고 실제로도 683대 전부 비어 있다(실측 2026-08-08).
 *   차대번호(`vin`)는 손님에게 보여도 되는 값이다(사장님 확인) — 실차를 특정하는 정보다.
 */
import type { EntityRecord } from '@/lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** 손님에게 보여도 되는 정책 필드 — 보험·조건·연령. 수수료·환수·내부 운영값은 없다. */
const PUBLIC_POLICY_FIELDS = [
  'policy_name', 'policy_type',
  'insurance_included',
  'injury_compensation_limit', 'injury_deductible',
  'property_compensation_limit', 'property_deductible',
  'self_body_accident', 'self_body_deductible',
  'personal_injury_compensation_limit', 'personal_injury_deductible',
  'uninsured_damage', 'uninsured_compensation_limit', 'uninsured_deductible',
  'own_damage_compensation', 'own_damage_repair_ratio', 'own_damage_compensation_rate',
  'own_damage_min_deductible', 'own_damage_max_deductible',
  'annual_roadside_assistance', 'roadside_assistance',
  'credit_grade', 'screening_criteria',
  'annual_mileage', 'mileage_upcharge_per_10000km',
  'deposit_installment', 'deposit_card_payment', 'payment_method',
  'penalty_condition', 'rental_region', 'delivery_fee',
  'basic_driver_age', 'driver_age_lowering', 'driver_age_upper_limit', 'license_period',
  'personal_driver_scope', 'business_driver_scope',
  'additional_driver_allowance_count', 'additional_driver_cost',
  'maintenance_service',
] as const;

/** 손님에게 보여도 되는 매물 필드 — 차량 스펙과 대여 조건. */
const PUBLIC_PRODUCT_FIELDS = [
  'car_number', 'vin', 'maker', 'model', 'sub_model', 'trim_name', 'trim_extra', 'variant',
  'vehicle_class', 'year', 'first_registration_date', 'fuel_type', 'engine_type',
  'ext_color', 'int_color', 'drive_type', 'seats', 'transmission', 'usage',
  'options', 'product_type', 'vehicle_status', 'accident_history',
  'cert_car_name', 'location', 'note',
  'credit_grade', 'insurance_included', 'annual_mileage',
] as const;

/** 기간별 대여료 — 값이 있는 기간만. 음수·0은 버린다(0원 견적 방지). */
function publicPrice(price: unknown): Record<string, { rent: number; deposit: number }> {
  const out: Record<string, { rent: number; deposit: number }> = {};
  if (!price || typeof price !== 'object') return out;
  for (const [key, v] of Object.entries(price as Rec)) {
    const month = Number(String(key).split('_')[0]);
    if (!Number.isFinite(month) || month < 1 || month > 60) continue;
    const rent = N((v as Rec)?.rent);
    if (rent <= 0) continue;
    out[key] = { rent, deposit: N((v as Rec)?.deposit) };
  }
  return out;
}

/** 사진 — 배열·JSON문자열·레거시 키를 모아 중복 제거. */
function publicImages(p: Rec): string[] {
  const urls: string[] = [];
  for (const src of [p.drive_image_urls, p.image_urls, p.images, p.photos]) {
    if (!src) continue;
    let arr: unknown = src;
    if (typeof src === 'string') { try { arr = JSON.parse(src); } catch { continue; } }
    if (Array.isArray(arr)) for (const u of arr) if (u && typeof u === 'string') urls.push(u);
  }
  return [...new Set(urls)];
}

export function publicPolicy(policy: Rec | null | undefined): Rec | null {
  if (!policy) return null;
  const out: Rec = {};
  for (const k of PUBLIC_POLICY_FIELDS) {
    const v = policy[k];
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** 매물 하나를 손님용으로 정제한다. 목록에 없는 필드는 «그냥 빠진다» — 기본값을 지어내지 않는다. */
export function sanitizeProductForGuest(key: string, p: Rec, policy?: Rec | null): EntityRecord {
  const out: Rec = { _key: key, product_code: S(p.product_code) || key };
  for (const f of PUBLIC_PRODUCT_FIELDS) {
    const v = p[f];
    if (v === null || v === undefined || v === '') continue;
    out[f] = v;
  }
  out.mileage = N(p.mileage);
  out.engine_cc = N(p.engine_cc);
  out.price = publicPrice(p.price);
  const images = publicImages(p);
  if (images.length) { out.image_urls = images; out.image_url = images[0]; }
  if (S(p.photo_link)) out.photo_link = S(p.photo_link);
  const pol = publicPolicy(policy);
  if (pol) out._policy = pol;
  return out as EntityRecord;
}

/** 담당 영업자 — 손님이 연락할 수 있을 만큼만. 이메일·uid·채널코드는 내보내지 않는다. */
export function sanitizeAgentForGuest(u: Rec | null | undefined): Rec | null {
  if (!u) return null;
  const name = S(u.name);
  const phone = S(u.phone || u.mobile || u.tel || u.contact);
  if (!name && !phone) return null;
  return { name, phone, company_name: S(u.company_name), title: S(u.title || u.position) };
}
