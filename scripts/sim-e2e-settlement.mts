/**
 * 3자 엔드투엔드 정산 시뮬레이션 — 실제 도메인 코드로 검증.
 *   공급사 차량등록 → 영업자 계약 5단계 완주 → 정산 생성(영업지급·공급수수료) → 관리자 월별정산(VAT) 연동.
 *   실행: npx tsx scripts/sim-e2e-settlement.mts
 */
const mem = new Map<string, string>();
const ls = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
(globalThis as unknown as { localStorage: typeof ls }).localStorage = ls;
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
(globalThis as unknown as { window: { dispatchEvent: (e: Event) => boolean } }).window.dispatchEvent = () => true;
class CE extends Event { detail: unknown; constructor(t: string, i?: { detail?: unknown }) { super(t); this.detail = i?.detail; } }
(globalThis as unknown as { CustomEvent: typeof CE }).CustomEvent = CE;

process.env.NEXT_PUBLIC_DATA_BACKEND = ''; // LocalAdapter 강제

const { getStore } = await import('../lib/store');
const { getCompanyId } = await import('../lib/tenant');
const { newId } = await import('../lib/domain/ids');
const { ensureRoom, createContractRequest, setRole } = await import('../lib/domain/deal');
const { applyStepCheck } = await import('../lib/domain/settlement-engine');
const { importCompletedForMonth } = await import('../lib/domain/admin-settlement');
import type { EntityRecord } from '../lib/intake/entities';

type Case = { name: string; ok: boolean; detail?: unknown };
const cases: Case[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  cases.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

const co = getCompanyId();
const store = getStore();
console.log('══ 3자 엔드투엔드 정산 ══');
console.log('backend:', store.backend, '· company:', co, '\n');

// ── 요율 SSOT 최소 시딩 (seed 샘플 오염 없이 격리) ──
await store.save('partner', co, [{ partner_code: 'sup_jeil', name: '제일오토렌탈', partner_type: '공급사', fee_rate: 0.1 }]);
await store.save('user', co, [{ uid: 'usr_park', user_code: 'usr_park', name: '박영업', role: 'agent', agent_channel_code: 'chn_seoul', agent_payout_rate: 0.04 }]);

// ── 1. 공급사 차량 등록 ──
setRole('provider');
const productCode = newId('product');
const RENT = 550000;
const product: EntityRecord = {
  product_code: productCode, car_number: '99시9999', maker: '현대', sub_model: '아반떼',
  vehicle_status: '출고가능', product_type: '재렌트', provider_company_code: 'sup_jeil',
  price: { '36': { rent: RENT, deposit: 0, fee: 55000 } },
};
await store.save('product', co, [product]);
const savedProd = await store.get('product', co, productCode);
check('1. 공급사 차량 등록', !!savedProd && String(savedProd.provider_company_code) === 'sup_jeil', savedProd?.car_number);

// ── 2. 영업자 계약 5단계 완주 ──
setRole('agent');
const roomId = await ensureRoom(product);
const contractCode = await createContractRequest(product, { period: 36, customerName: '', customerPhone: '' }, roomId);
let contract = (await store.get('contract', co, contractCode))!;
check('2a. 계약 생성(계약요청)', contract.contract_status === '계약요청', contractCode);
check('2b. 요율 동결(스냅샷)', Number(contract.fee_rate_snapshot) === 0.1 && Number(contract.payout_rate_snapshot) === 0.04,
  { fee: contract.fee_rate_snapshot, payout: contract.payout_rate_snapshot });

const steps: [string, string, string][] = [
  ['agent', 'agent_delivery_inquiry', 'yes'],
  ['provider', 'provider_delivery_response', '출고 가능'],
  ['agent', 'agent_docs_submitted', 'yes'],
  ['provider', 'provider_docs_review', '승인'],
  ['agent', 'agent_balance_paid', 'yes'],
  ['agent', 'agent_final_paid', 'yes'],
  ['provider', 'provider_balance_confirmed', 'yes'],
  ['agent', 'provider_agreement_done', 'yes'],
  ['provider', 'provider_agreement_sent', 'yes'],
  ['agent', 'agent_handover_confirmed', 'yes'],
  ['provider', 'provider_release_completed', 'yes'],
];
for (const [who, key, value] of steps) {
  setRole(who as 'agent' | 'provider');
  if (key === 'provider_agreement_done') await store.update('contract', co, contractCode, { customer_name: '시뮬손님', customer_phone: '010-5555-1212' });
  contract = (await store.get('contract', co, contractCode))!;
  await applyStepCheck(contract, key, value);
}
contract = (await store.get('contract', co, contractCode))!;
const prodAfter = await store.get('product', co, productCode);
check('2c. 계약완료', contract.contract_status === '계약완료', contract.contract_status);
check('2d. 차량 출고불가 락', prodAfter?.vehicle_status === '출고불가' && String(prodAfter?.locked_by_contract) === contractCode, prodAfter?.vehicle_status);

// ── 3. 정산 생성 & 금액 검증 (영업 지급·공급 수수료) ──
const stCode = `ST_${contractCode}`;
const st = await store.get('settlement', co, stCode);
const expFee = Math.round(RENT * 0.1);      // 55,000 공급 수수료(R1)
const expPayout = Math.round(RENT * 0.04);  // 22,000 영업 지급(R2)
const expNet = expFee - expPayout;          // 33,000 프리패스 순수익
check('3a. 정산 생성', !!st && st.settlement_status === '정산대기', stCode);
check('3b. 공급 수수료(R1)', Number(st?.fee_amount) === expFee, { got: st?.fee_amount, exp: expFee });
check('3c. 영업 지급(R2)', Number(st?.agent_payout) === expPayout, { got: st?.agent_payout, exp: expPayout });
check('3d. 순수익(R1−R2)', Number(st?.net_amount) === expNet, { got: st?.net_amount, exp: expNet });
check('3e. 귀속 연동(공급·영업 코드)', String(st?.provider_company_code) === 'sup_jeil' && String(st?.agent_code) === 'usr_park',
  { prov: st?.provider_company_code, agent: st?.agent_code });

// ── 4. 관리자 월별정산 (VAT) 연동 ──
setRole('admin');
await store.update('settlement', co, stCode, { settlement_status: '정산완료' }); // 관리자 "정산 확정"
const month = String(contract.contract_date || '').slice(0, 7);
const res = await importCompletedForMonth(month);
const asCode = `AS_${month}_${contractCode}`;
const asRow = await store.get('admin_settlement', co, asCode);
check('4a. 월별정산 불러오기', res.created >= 1, res);
check('4b. 공급 수수료 청구 반영(sale_fee=R1)', Number(asRow?.sale_fee) === expFee, { got: asRow?.sale_fee, exp: expFee });
check('4c. 영업 지급 반영(delivery_fee=R2)', Number(asRow?.delivery_fee) === expPayout, { got: asRow?.delivery_fee, exp: expPayout });
check('4d. 공급 부가세 10%', Number(asRow?.provider_vat) === Math.round(expFee * 0.1), { got: asRow?.provider_vat, exp: Math.round(expFee * 0.1) });
const expProviderBill = expFee + Math.round(expFee * 0.1);
const expAgencyPay = expPayout + Math.round(expPayout * 0.1);
check('4e. 월 순이익(청구−지급)', Number(asRow?.monthly_profit) === expProviderBill - expAgencyPay, { got: asRow?.monthly_profit, exp: expProviderBill - expAgencyPay });

// ── 결과 ──
const failed = cases.filter((c) => !c.ok);
console.log('\n════════ 결과 ════════');
console.log(`${cases.length - failed.length}/${cases.length} PASS`);
if (failed.length) { for (const f of failed) console.log('FAIL', f.name, f.detail ?? ''); process.exit(1); }
console.log('PASS — 공급사 등록 → 영업 계약완료 → 정산(공급수수료·영업지급) → 관리자 월별정산까지 3자 연동 확인');
process.exit(0);
