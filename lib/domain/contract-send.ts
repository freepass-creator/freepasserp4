/**
 * 계약서 발송 — 매물·계약·파트너 → 템플릿 payload, draft 저장, 서명 토큰 발송.
 * 템플릿: /contract-template/rental-contract.html?embed=1 + Contract.setData.
 * 서명 상태기계는 sign.ts SSOT.
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { createSignToken } from '@/lib/domain/sign';

export type ContractPayload = Record<string, string>;

function priceText(price: unknown): string {
  if (!price || typeof price !== 'object') return '';
  const entries = Object.entries(price as Record<string, { rent?: number }>);
  if (!entries.length) return '';
  const sorted = entries
    .map(([k, v]) => ({ m: Number(k) || Number(String(k).split('_')[0]) || 0, rent: Number(v?.rent) || 0 }))
    .filter((x) => x.m && x.rent)
    .sort((a, b) => a.m - b.m);
  if (!sorted.length) return '';
  return sorted.map((x) => `${x.m}개월 ${x.rent.toLocaleString()}`).join(' / ');
}

function fmtWon(n: unknown): string {
  const v = Number(n) || 0;
  return v ? v.toLocaleString() : '';
}

function addMonthsEnd(start: string, months: number): string {
  if (!start || !months) return '';
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function vehicleName(p: EntityRecord): string {
  return [p.maker, p.model, p.sub_model, p.variant, p.trim_name]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** 계약(+매물·정책·파트너) → 템플릿 setData 페이로드. */
export async function buildContractPayload(contractCode: string): Promise<{
  contract: EntityRecord;
  product: EntityRecord | null;
  payload: ContractPayload;
}> {
  const co = getCompanyId();
  const store = getStore();
  const contract = await store.get('contract', co, contractCode);
  if (!contract) throw new Error('계약을 찾을 수 없습니다');

  const car = String(contract.car_number_snapshot || contract.car_number || '').trim();
  const pCode = String(contract.product_code || '').trim();
  const products = await store.list('product', co);
  const product = products.find((p) =>
    (pCode && String(p.product_code) === pCode) ||
    (car && String(p.car_number || '').replace(/\s/g, '') === car.replace(/\s/g, ''))
  ) || null;

  const polCode = String(product?.policy_code || contract.policy_code || '');
  const policies = polCode ? await store.list('policy', co) : [];
  const pol = (policies.find((t) => String(t.policy_code || t._key) === polCode) || {}) as EntityRecord;

  const provCode = String(product?.provider_company_code || product?.partner_code || contract.provider_company_code || '');
  const partners = provCode ? await store.list('partner', co) : [];
  const partner = partners.find((x) => String(x.partner_code || x._key) === provCode) || null;
  const provName = String(partner?.name || partner?.partner_name || '');

  let coKey = 'sonogong';
  const companyInject: ContractPayload = {};
  if (/손오공/.test(provName)) coKey = 'sonogong';
  else if (/스위치/.test(provName)) coKey = 'switchplan';
  else if (partner) {
    coKey = 'auto';
    companyInject.company_name = String(partner.name || partner.partner_name || partner.company_name || provName || '');
    companyInject.company_ceo = String(partner.ceo_name || '');
    companyInject.company_ceo_title = '대표';
    companyInject.company_biz_no = String(partner.business_number || '');
    companyInject.payment_bank = String(partner.bank_name || '');
    companyInject.payment_account_no = String(partner.bank_account || '');
    companyInject.payment_account_holder = String(partner.bank_holder || partner.name || partner.partner_name || '');
  }

  const ins = /별도|개인/.test(String(pol.insurance_included || '')) ? '별도' : '포함';
  const months = Number(contract.rent_month_snapshot) || 0;
  const start = String(contract.contract_date || '');
  const yr = String(product?.year || product?.model_year || '').trim();

  const saved = parseDraft(contract.contract_draft);
  const base: ContractPayload = {
    co: coKey,
    ins,
    ...companyInject,
    contract_code: String(contract.contract_code || ''),
    car_number: car || String(product?.car_number || ''),
    vehicle_name: String(contract.vehicle_name_snapshot || (product ? vehicleName(product) : '') || ''),
    fuel: String(product?.fuel_type || ''),
    model_year: yr ? (/년식/.test(yr) ? yr : `${yr}년식`) : '',
    options: Array.isArray(product?.options) ? (product!.options as string[]).join(', ') : String(product?.options || ''),
    vehicle_price: product ? priceText(product.price) : '',
    customer_name: String(contract.customer_name || ''),
    customer_phone: String(contract.customer_phone || ''),
    rent_amount: fmtWon(contract.rent_amount_snapshot),
    deposit_amount: fmtWon(contract.deposit_amount_snapshot),
    rent_month: months ? `${months} 개월` : '',
    contract_start: start,
    contract_end: addMonthsEnd(start, months),
    delivery_location: String(contract.delivery_address || ''),
    deposit_installment: String(contract.deposit_payment_type || pol.deposit_installment || ''),
    driver_age: String(pol.basic_driver_age || ''),
    annual_mileage: String(pol.annual_mileage || ''),
    maintenance_product: String(pol.maintenance_service || ''),
    coverage_liability_person: String(pol.injury_compensation_limit || ''),
    coverage_liability_property: String(pol.property_compensation_limit || ''),
    coverage_self_injury: String(pol.self_body_accident || ''),
    coverage_uninsured: String(pol.uninsured_damage || ''),
    self_damage_coverage: String(pol.own_damage_compensation || ''),
    emergency_dispatch_limit: String(pol.annual_roadside_assistance || ''),
    deductible_liability_person: String(pol.injury_deductible || ''),
    deductible_liability_property: String(pol.property_deductible || ''),
    self_damage_deductible_rate: String(pol.own_damage_repair_ratio || ''),
    self_damage_deductible_min: String(pol.own_damage_min_deductible || ''),
    self_damage_deductible_max: String(pol.own_damage_max_deductible || ''),
  };

  return { contract, product, payload: { ...base, ...saved } };
}

export function parseDraft(raw: unknown): ContractPayload {
  if (!raw) return {};
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return {};
    const out: ContractPayload = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (v != null && v !== '') out[k] = String(v);
    }
    return out;
  } catch { return {}; }
}

/** iframe 문서에서 data-field 스냅샷(동일출처). */
export function snapshotFromDoc(doc: Document): ContractPayload {
  const out: ContractPayload = {};
  doc.querySelectorAll('[data-field]').forEach((n) => {
    const k = n.getAttribute('data-field');
    if (!k) return;
    const el = n as HTMLElement;
    const v = ('value' in el ? String((el as HTMLInputElement).value) : el.textContent || '').trim();
    if (v) out[k] = v;
  });
  return out;
}

/** 임시저장 — contract.contract_draft. */
export async function saveContractDraft(contractCode: string, payload: ContractPayload): Promise<void> {
  const co = getCompanyId();
  await getStore().update('contract', co, contractCode, {
    contract_draft: JSON.stringify(payload),
    sign_draft_at: Date.now(),
  } as EntityRecord);
}

/** 발송 — draft 저장 + 서명 토큰. 반환 = 공개 링크 path용 token. */
export async function sendContractLink(contractCode: string, payload?: ContractPayload): Promise<string> {
  const co = getCompanyId();
  if (payload) await saveContractDraft(contractCode, payload);
  const c = await getStore().get('contract', co, contractCode);
  if (!c) throw new Error('계약 없음');
  return createSignToken(c);
}

export const TEMPLATE_SRC = '/contract-template/rental-contract.html?embed=1';
