/**
 * 관리자 월별 수수료 정산서 — 건별 settlement와 분리.
 * v3 BLOCKS 메타 + VAT 10% 계산 이식. 저장 = admin_settlement 엔티티.
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';

export type FieldMeta = {
  k: string;
  label: string;
  type: 'text' | 'num' | 'date' | 'select';
  calc?: boolean;
  opts?: string[];
};

export const ADMIN_SETTLE_STATUS = ['계약완료', '정산완료', '진행', '보류', '취소', '환수'] as const;

/** 엑셀 정산표 블록 메타(SSOT) — 폼·목록·계산 공유. */
export const ADMIN_SETTLE_BLOCKS: { title: string; key: string; fields: FieldMeta[] }[] = [
  {
    title: 'A. 계약 · 차량', key: 'A', fields: [
      { k: 'contract_code', label: '계약번호', type: 'text' },
      { k: 'settle_status', label: '상태표기', type: 'select', opts: [...ADMIN_SETTLE_STATUS] },
      { k: 'provider_name', label: '업체명(공급사)', type: 'text' },
      { k: 'received_date', label: '접수일', type: 'date' },
      { k: 'delivery_date', label: '인도일', type: 'date' },
      { k: 'rent_type', label: '렌트구분', type: 'text' },
      { k: 'product_type', label: '상품구분', type: 'text' },
      { k: 'car_number', label: '차량번호', type: 'text' },
      { k: 'model_name', label: '모델명', type: 'text' },
      { k: 'customer_name', label: '고객명', type: 'text' },
      { k: 'customer_phone', label: '연락처', type: 'text' },
      { k: 'contract_term', label: '계약기간', type: 'text' },
      { k: 'deposit', label: '보증금', type: 'num' },
      { k: 'rental_fee', label: '렌탈료', type: 'num' },
      { k: 'contract_rent', label: '계약대여료', type: 'num' },
    ],
  },
  {
    title: 'B. 공급사 수수료 (청구)', key: 'B', fields: [
      { k: 'fee_code', label: '수수료 고유코드', type: 'text' },
      { k: 'provider_fee_rate', label: '수수료율(공급사)', type: 'text' },
      { k: 'writer', label: '계약서 작성 담당자', type: 'text' },
      { k: 'sale_fee', label: '판매수수료', type: 'num' },
      { k: 'provider_incentive', label: '추가 인센티브', type: 'num' },
      { k: 'delivery_region', label: '출고지역', type: 'text' },
      { k: 'provider_fee_sum', label: '수수료 합계', type: 'num', calc: true },
      { k: 'provider_vat', label: '부가세', type: 'num', calc: true },
      { k: 'provider_bill', label: '청구 금액', type: 'num' },
    ],
  },
  {
    title: 'C. 에이전시 지급', key: 'C', fields: [
      { k: 'agency', label: '에이전시', type: 'text' },
      { k: 'agent_name', label: '영업자', type: 'text' },
      { k: 'agency_fee_rate', label: '수수료율(에이전시)', type: 'text' },
      { k: 'delivery_fee', label: '출고수수료', type: 'num' },
      { k: 'agency_incentive', label: '추가 인센티브', type: 'num' },
      { k: 'doc_agency_fee', label: '계약서 대행료', type: 'num' },
      { k: 'agency_fee_sum', label: '수수료 합계', type: 'num', calc: true },
      { k: 'agency_vat', label: '부가세', type: 'num', calc: true },
      { k: 'agency_pay', label: '지급액', type: 'num' },
      { k: 'monthly_profit', label: '당월수익', type: 'num', calc: true },
    ],
  },
];

const num = (v: unknown) => Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;

/** 부가세 10% · 청구/지급 · 당월수익. 청구/지급 직접입력이 있으면 우선. */
export function computeAdminSettlement(d: EntityRecord): EntityRecord {
  const providerFeeSum = num(d.sale_fee) + num(d.provider_incentive);
  const providerVat = Math.round(providerFeeSum * 0.1);
  const providerBillCalc = providerFeeSum + providerVat;
  const agencyFeeSum = num(d.delivery_fee) + num(d.agency_incentive) + num(d.doc_agency_fee);
  const agencyVat = Math.round(agencyFeeSum * 0.1);
  const agencyPayCalc = agencyFeeSum + agencyVat;
  const providerBill = d.provider_bill != null && d.provider_bill !== '' ? num(d.provider_bill) : providerBillCalc;
  const agencyPay = d.agency_pay != null && d.agency_pay !== '' ? num(d.agency_pay) : agencyPayCalc;
  return {
    provider_fee_sum: providerFeeSum,
    provider_vat: providerVat,
    provider_bill: providerBill,
    agency_fee_sum: agencyFeeSum,
    agency_vat: agencyVat,
    agency_pay: agencyPay,
    monthly_profit: providerBill - agencyPay,
  };
}

export function adminSettlementCode(month: string, contractCode: string): string {
  return `AS_${month}_${contractCode}`;
}

/** 건별 정산완료 → 월정산서 초안. sale_fee=R1, delivery_fee=R2 시드. */
export function fromCaseSettlement(s: EntityRecord, month: string): EntityRecord {
  const code = String(s.contract_code || '');
  const base: EntityRecord = {
    admin_settlement_code: adminSettlementCode(month, code),
    settle_month: month,
    contract_code: code,
    settle_status: '정산완료',
    provider_name: String(s.provider_company_code || ''),
    car_number: String(s.car_number || ''),
    model_name: String(s.sub_model_snapshot || s.vehicle_name_snapshot || ''),
    customer_name: String(s.customer_name || ''),
    customer_phone: String(s.customer_phone || ''),
    contract_term: s.rent_month_snapshot ? `${s.rent_month_snapshot}개월` : '',
    deposit: Number(s.deposit_amount_snapshot) || 0,
    rental_fee: Number(s.rent_amount) || 0,
    contract_rent: Number(s.rent_amount) || 0,
    product_type: String(s.product_type_snapshot || ''),
    fee_code: String(s.settlement_code || ''),
    provider_fee_rate: s.fee_rate_snapshot != null ? String(s.fee_rate_snapshot) : '',
    sale_fee: Number(s.fee_amount) || 0,
    agency: String(s.agent_channel_code || ''),
    agent_name: String(s.agent_code || ''),
    agency_fee_rate: s.agent_payout_rate_snapshot != null ? String(s.agent_payout_rate_snapshot) : '',
    delivery_fee: Number(s.agent_payout) || 0,
    source_settlement_code: String(s.settlement_code || ''),
  };
  return { ...base, ...computeAdminSettlement(base) };
}

/** 해당 월 정산완료 건 → 아직 없는 정산서만 생성. */
export async function importCompletedForMonth(month: string): Promise<{ created: number; skipped: number }> {
  const co = getCompanyId();
  const store = getStore();
  const cases = (await store.list('settlement', co)).filter((s) =>
    String(s.settlement_status) === '정산완료' && String(s.contract_date || '').slice(0, 7) === month
  );
  const existing = new Set((await store.list('admin_settlement', co)).map((r) => String(r._key || r.admin_settlement_code)));
  const creates: EntityRecord[] = [];
  let skipped = 0;
  for (const s of cases) {
    const rec = fromCaseSettlement(s, month);
    const key = String(rec.admin_settlement_code);
    if (existing.has(key)) { skipped++; continue; }
    creates.push(rec);
    existing.add(key);
  }
  if (creates.length) await store.save('admin_settlement', co, creates);
  return { created: creates.length, skipped };
}

export async function saveAdminSettlement(rec: EntityRecord): Promise<void> {
  const co = getCompanyId();
  const code = String(rec.admin_settlement_code || '');
  if (!code) throw new Error('admin_settlement_code 필요');
  const computed = { ...rec, ...computeAdminSettlement(rec) };
  const store = getStore();
  const prev = await store.get('admin_settlement', co, code);
  if (!prev) await store.save('admin_settlement', co, [computed]);
  else await store.update('admin_settlement', co, code, computed);
}

export function monthTotals(rows: EntityRecord[]): { bill: number; pay: number; profit: number; n: number } {
  return {
    n: rows.length,
    bill: rows.reduce((n, r) => n + num(r.provider_bill), 0),
    pay: rows.reduce((n, r) => n + num(r.agency_pay), 0),
    profit: rows.reduce((n, r) => n + num(r.monthly_profit), 0),
  };
}
