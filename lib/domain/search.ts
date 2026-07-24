/**
 * 검색 SSOT — 토큰 AND 매칭 + 엔티티별 haystack.
 * 공백으로 나뉜 모든 토큰이 포함돼야 통과(예: "현대 쏘나타 즉시").
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { vehicleName, creditDisplay, policyOf, canonProductType } from '@/lib/domain/product';
import { fuelDisplay, fuelEmbeddedCc } from '@/lib/domain/vehicle-master-match';

// 검색어 토큰화 1엔트리 메모 — 한 번의 필터 패스에서 매 항목이 같은 q로 queryTokens를 재계산하던 것을 1회로.
// 같은 q면 같은 배열 참조 반환. 반환 배열은 읽기 전용으로만 소비됨(matchHay는 every로 순회만).
let _tokQ: string | undefined;
let _tokRes: string[] = [];
export function queryTokens(q: string): string[] {
  if (q === _tokQ) return _tokRes;
  _tokQ = q;
  _tokRes = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return _tokRes;
}

export function matchHay(hay: string, q: string): boolean {
  const tokens = queryTokens(q);
  if (!tokens.length) return true;
  const h = hay.toLowerCase();
  return tokens.every((t) => h.includes(t));
}

function parts(...xs: unknown[]): string {
  return xs
    .filter((v) => v != null && String(v).trim() !== '' && String(v) !== '-')
    .map((v) => String(v))
    .join(' ')
    .toLowerCase();
}

/** productHaystack 캐시 — 매물 객체는 세션 내 불변. 검색 타이핑마다 전량 haystack 재빌드하던 비용 제거(첫 계산 후 캐시). */
const productHaystackCache = new WeakMap<object, string>();

/** 매물 — 스키마 원자 + 파생(차명·심사·연료정규화) + 임베드 정책 핵심. */
export function productHaystack(p: EntityRecord): string {
  const cached = productHaystackCache.get(p as object);
  if (cached !== undefined) return cached;
  const pol = policyOf(p);
  const cc = Number(p.engine_cc) || fuelEmbeddedCc(p.fuel_type);
  const hay = parts(
    vehicleName(p),
    creditDisplay(p),
    p.product_code, p.car_number, p.vin, p.cert_car_name, p.type_number, p.engine_type,
    p.maker, p.model, p.sub_model, p.variant, p.trim_name, p.vehicle_class,
    p.year, p.fuel_type, fuelDisplay(p.fuel_type), p.drive_type, p.transmission,
    p.mileage != null && p.mileage !== '' ? `${p.mileage}km` : '',
    cc > 0 ? `${cc}cc` : '',
    p.seats != null && p.seats !== '' ? `${p.seats}인승` : '',
    p.ext_color, p.int_color, p.usage, p.first_registration_date,
    p.options, p.fp_options, p.accident_history,
    p.vehicle_status, canonProductType(p.product_type), p.deposit_free, p.review_status,
    p.event_tags, p.promo_tags,
    p.provider_company_code, p.provider_name, p.provider_name_full, p.provider_company_name,
    p.partner_code, p.partner_name, p.company_name, p.company_code,
    p.policy_code, p.catalog_id, p.location, p.partner_memo,
    p.vehicle_age_expiry_date,
    // 정책 임베드(검색용 핵심)
    pol.policy_code, pol.policy_name, pol.policy_type, pol.screening_criteria,
    pol.credit_grade, pol.rental_region, pol.payment_method, pol.license_period,
    pol.basic_driver_age, pol.driver_age_lowering, pol.annual_mileage,
    pol.deposit_installment, pol.maintenance_service, pol.personal_driver_scope,
    pol.business_driver_scope,
  );
  productHaystackCache.set(p as object, hay);
  return hay;
}

export function matchProductQuery(p: EntityRecord, q: string): boolean {
  return matchHay(productHaystack(p), q);
}

/** 계약문의 방 */
export function roomHaystack(rm: EntityRecord): string {
  return parts(
    rm._key, rm.product_code, rm.product_uid,
    rm.vehicle_name, rm.car_number, rm.vehicle_number,
    rm.maker, rm.model, rm.sub_model,
    rm.agent_code, rm.agent_name, rm.agent_channel_code, rm.agent_uid,
    rm.provider_company_code, rm.provider_uid, rm.provider_name,
    rm.linked_contract, rm.last_message, rm.last_sender_code, rm.last_sender_name,
    rm.last_sender_role,
  );
}

export function matchRoomQuery(rm: EntityRecord, q: string): boolean {
  return matchHay(roomHaystack(rm), q);
}

/** 계약 */
export function contractHaystack(c: EntityRecord): string {
  return parts(
    c.contract_code, c.contract_status, c.contract_date, c.is_draft,
    c.product_code, c.product_uid,
    c.car_number_snapshot, c.maker_snapshot, c.model_snapshot, c.sub_model_snapshot,
    c.vehicle_name_snapshot, c.year_snapshot, c.fuel_type_snapshot,
    c.customer_name, c.customer_phone, c.customer_birth,
    c.customer_company_name, c.customer_business_number, c.customer_address,
    c.delivery_region, c.driver_license_no, c.residence_type,
    c.agent_code, c.agent_name, c.agent_channel_code,
    c.provider_company_code, c.provider_name, c.partner_code, c.partner_name,
    c.policy_code, c.policy_name_snapshot, c.sign_status, c.sign_token,
    c.rent_month_snapshot, c.rent_amount_snapshot, c.deposit_amount_snapshot,
  );
}

export function matchContractQuery(c: EntityRecord, q: string): boolean {
  return matchHay(contractHaystack(c), q);
}

/** 정산 */
export function settlementHaystack(s: EntityRecord): string {
  return parts(
    s.settlement_code, s.contract_code, s.car_number, s.customer_name,
    s.provider_company_code, s.partner_code, s.agent_code, s.agent_channel_code,
    s.settlement_status, s.contract_date,
    s.rent_amount, s.fee_rate, s.fee_amount, s.agent_payout, s.net_amount, s.clawback_amount,
  );
}

export function matchSettlementQuery(s: EntityRecord, q: string): boolean {
  return matchHay(settlementHaystack(s), q);
}

/** 회원 */
export function memberHaystack(u: EntityRecord): string {
  return parts(
    u.user_code, u.uid, u.name, u.role, u.partner_type,
    u.partner_code, u.company_code, u.company_name,
    u.agent_channel_code, u.contact, u.phone, u.email,
    u.status, String(u.status || '') === 'pending' ? '승인대기' : '',
  );
}

export function matchMemberQuery(u: EntityRecord, q: string): boolean {
  return matchHay(memberHaystack(u), q);
}

/** 정책 */
export function policyHaystack(pol: EntityRecord): string {
  return parts(
    pol.policy_code, pol.policy_name, pol.policy_type,
    pol.screening_criteria, pol.credit_grade, pol.rental_region,
    pol.payment_method, pol.license_period, pol.annual_mileage,
  );
}

export function matchPolicyQuery(pol: EntityRecord, q: string): boolean {
  return matchHay(policyHaystack(pol), q);
}
