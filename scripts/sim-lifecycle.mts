/**
 * 생애주기 시뮬레이션 — 공급사 등록 → 문의 → 5단계 → 첨부 → 정산원자.
 * 실제 도메인 함수(ensureRoom / createContractRequest / applyStepCheck)를 LocalAdapter 위에서 실행.
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
(globalThis as unknown as { localStorage: typeof ls; window: typeof globalThis }).localStorage = ls;
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
(globalThis as unknown as { window: { dispatchEvent: (e: Event) => boolean } }).window.dispatchEvent = () => true;
class CE extends Event { detail: unknown; constructor(t: string, i?: { detail?: unknown }) { super(t); this.detail = i?.detail; } }
(globalThis as unknown as { CustomEvent: typeof CE }).CustomEvent = CE;

process.env.NEXT_PUBLIC_DATA_BACKEND = ''; // LocalAdapter 강제

const { getStore } = await import('../lib/store');
const { getCompanyId } = await import('../lib/tenant');
const { seedIfEmpty } = await import('../lib/seed');
const { newId } = await import('../lib/domain/ids');
const { ensureRoom, createContractRequest, setRole } = await import('../lib/domain/deal');
const { applyStepCheck } = await import('../lib/domain/settlement-engine');
const { getProgress, STEPS } = await import('../lib/domain/contract');
import type { EntityRecord } from '../lib/intake/entities';

const log = (step: string, detail: unknown) => {
  console.log(`\n━━ ${step}`);
  console.log(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
};

const co = getCompanyId();
await seedIfEmpty(co);
const store = getStore();
log('0. backend', store.backend);

// ── 1. 공급사: 신규 차량 등록 ──
setRole('provider');
const productCode = newId('product');
const product: EntityRecord = {
  product_code: productCode,
  car_number: '99시9999',
  maker: '현대',
  model: '쏘나타',
  sub_model: '쏘나타 DN8',
  trim_name: '인스퍼레이션',
  year: '2024',
  fuel_type: '가솔린',
  vehicle_class: '중형',
  mileage: 8000,
  ext_color: '화이트',
  vehicle_status: '출고가능',
  product_type: '재렌트',
  provider_company_code: 'sup_jeil',
  price: {
    '36': { rent: 550000, deposit: 0, fee: 55000 },
    '48': { rent: 510000, deposit: 0, fee: 51000 },
  },
  photos: ['data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='30'><rect fill='#ddd' width='40' height='30'/></svg>")],
};
await store.save('product', co, [product]);
await store.update('product', co, productCode, product);
const savedP = await store.get('product', co, productCode);
log('1. 공급사 차량 등록', {
  product_code: savedP?.product_code,
  car_number: savedP?.car_number,
  vehicle_status: savedP?.vehicle_status,
  rent_36: (savedP?.price as { '36'?: { rent: number } })?.['36']?.rent,
});

// ── 2. 영업: 채팅방 + 계약문의 ──
setRole('agent');
const roomId = await ensureRoom(product);
log('2a. 채팅방', roomId);

const contractCode = await createContractRequest(
  product,
  { period: 36, customerName: '', customerPhone: '' },
  roomId,
);
let contract = (await store.get('contract', co, contractCode))!;
await applyStepCheck(contract, 'agent_delivery_inquiry', 'yes');
contract = (await store.get('contract', co, contractCode))!;
let prod = (await store.get('product', co, productCode))!;
log('2b. 계약문의(영업)', {
  contract_code: contract.contract_code,
  contract_status: contract.contract_status,
  progress: getProgress(contract),
  vehicle_status: prod.vehicle_status,
  rent_snapshot: contract.rent_amount_snapshot,
  month: contract.rent_month_snapshot,
});

// ── 3. 공급/영업 5단계 핸드셰이크 ──
const checks: [string, string, string][] = [
  ['provider', 'provider_delivery_response', '출고 가능'],
  ['agent', 'agent_docs_submitted', 'yes'],
  ['provider', 'provider_docs_review', '승인'],
  ['agent', 'agent_balance_paid', 'yes'],
  ['agent', 'agent_final_paid', 'yes'],
  ['provider', 'provider_balance_confirmed', 'yes'],
  ['agent', 'provider_agreement_done', 'yes'], // UI상 actor=agent
  ['provider', 'provider_agreement_sent', 'yes'],
  ['agent', 'agent_handover_confirmed', 'yes'],
  ['provider', 'provider_release_completed', 'yes'],
];

const trail: { who: string; key: string; value: string; progress: string; status: string; vehicle: string }[] = [];
for (const [who, key, value] of checks) {
  setRole(who as 'agent' | 'provider');
  if (key === 'provider_agreement_done') {
    await store.update('contract', co, contractCode, {
      customer_name: '시뮬손님',
      customer_phone: '010-5555-1212',
    });
  }
  contract = (await store.get('contract', co, contractCode))!;
  await applyStepCheck(contract, key, value);
  contract = (await store.get('contract', co, contractCode))!;
  prod = (await store.get('product', co, productCode))!;
  const pr = getProgress(contract);
  trail.push({
    who,
    key,
    value,
    progress: `${pr.done}/${pr.total}`,
    status: String(contract.contract_status),
    vehicle: String(prod.vehicle_status),
  });
}
log('3. 5단계 검수 궤적', trail);

// ── 4. 파일 첨부(ContractDocs와 동일: attachments data URL) ──
setRole('agent');
const att = {
  name: '면허증.pdf',
  size: 1200,
  type: 'application/pdf',
  at: Date.now(),
  url: 'data:application/pdf;base64,JVBERi0xLjAK',
  by_role: '영업자',
  by_name: '박영업',
};
await store.update('contract', co, contractCode, { attachments: [att] });
contract = (await store.get('contract', co, contractCode))!;
const atts = Array.isArray(contract.attachments) ? contract.attachments as { name: string }[] : [];
log('4. 첨부 서류', { count: atts.length, names: atts.map((a) => a.name) });

// ── 5. 정산 원자 확인 ──
const stCode = `ST_${contractCode}`;
const settlement = await store.get('settlement', co, stCode);
log('5. 정산', settlement ? {
  settlement_code: settlement.settlement_code,
  settlement_status: settlement.settlement_status,
  rent_amount: settlement.rent_amount,
  fee_rate: settlement.fee_rate,
  fee_amount: settlement.fee_amount,
  agent_payout: settlement.agent_payout,
  net_amount: settlement.net_amount,
  contract_code: settlement.contract_code,
  car_number: settlement.car_number,
} : 'MISSING — createSettlement 미실행');

// ── 요약 ──
const ok =
  !!savedP &&
  contract.contract_status === '계약완료' &&
  prod.vehicle_status === '출고불가' &&
  atts.length === 1 &&
  !!settlement &&
  settlement.settlement_status === '정산대기';

console.log('\n════════ 결과 ════════');
console.log(ok ? 'PASS — 생애주기 전 구간 통과' : 'FAIL — 어딘가 끊김');
console.log({
  product: productCode,
  room: roomId,
  contract: contractCode,
  contract_status: contract.contract_status,
  vehicle_status: prod.vehicle_status,
  steps: `${getProgress(contract).done}/${STEPS.length}`,
  attachments: atts.length,
  settlement: settlement ? `${settlement.settlement_code} (${settlement.settlement_status})` : null,
  fee: settlement ? `${settlement.fee_amount} / payout ${settlement.agent_payout}` : null,
});
process.exit(ok ? 0 : 1);
