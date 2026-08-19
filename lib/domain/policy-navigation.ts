export type PolicySection = 'basic' | 'terms' | 'ins' | 'esign';

export function policySectionForField(key: string): PolicySection {
  if (/^(injury_|property_|self_body_|uninsured_|own_damage_|annual_roadside_|insurer_|designated_garage|self_damage_|replacement_car_)/.test(key)) return 'ins';
  if (['basic_driver_age', 'driver_age_lowering', 'driver_age_upper_limit', 'license_period', 'age_lowering_cost', 'screening_criteria', 'disqualification_conditions', 'sales_notes', 'credit_grade'].includes(key)) return 'basic';
  if (['annual_mileage', 'mileage_upcharge_per_10000km', 'payment_method', 'payment_timing', 'payment_due_date', 'rental_region', 'delivery_fee', 'deposit_installment', 'deposit_card_payment', 'insurance_included', 'personal_driver_scope', 'business_driver_scope', 'additional_driver_allowance_count', 'additional_driver_cost', 'maintenance_service', 'commission_clawback_condition'].includes(key)) return 'terms';
  return 'esign';
}

export function policyEditUrl(policyCode: string, field: string): string {
  const params = new URLSearchParams({
    policy: policyCode,
    section: policySectionForField(field),
    field,
    edit: '1',
    return: 'esign',
  });
  return `/policy?${params.toString()}`;
}


/**
 * 파트너사관리 → 정책 편집 화면(사장님 2026-08-19 「정책관리 메뉴는 필요 없고, 파트너사관리에서 공급사별로 등록·수정·삭제」).
 *   /policy 는 메뉴에서 빠지고 «그 공급사 정책만» 보이는 편집 화면으로 열린다(provider=코드 · return=partner).
 */
export function partnerPolicyUrl(providerCode: string, opts: { policy?: string; create?: boolean; section?: PolicySection; edit?: boolean } = {}): string {
  const params = new URLSearchParams({ provider: providerCode, return: 'partner' });
  if (opts.create) params.set('new', '1');
  if (opts.policy) params.set('policy', opts.policy);
  if (opts.section) params.set('section', opts.section);
  if (opts.edit) params.set('edit', '1');
  return `/policy?${params.toString()}`;
}
/** 파트너사관리로 돌아가기 — 그 공급사가 선택된 채로. */
export function partnerManageUrl(providerCode: string): string {
  return `/members?tab=partner&partner=${encodeURIComponent(providerCode)}`;
}
