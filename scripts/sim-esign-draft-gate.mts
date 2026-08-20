/**
 * **저장 전 초안 검증이 «화면에서 고른 값»을 보는가** — 2026-08-20 실측 버그의 재발 방지.
 *
 * 화면(EsignSendCenter)은 보증금 납부 회차를 `draft.depositInstallment` 에 담고,
 * 검증기(validateEsignCenterContract)는 계약 레코드와 같은 자리인 `contract_draft` 에서 읽는다.
 * `draftInputRecord` 가 그 다리를 놓지 않으면 **보증금 있는 계약이 영원히 막힌다** —
 * 「일시납 또는 분납 회차를 선택해 주세요」가 골라도 안 사라지고 「계약서 만들기」가 계속 비활성이었다.
 */
import assert from 'node:assert/strict';
import {
  draftInputRecord, emptyEsignDraftInput, validateEsignCenterContract, depositInstallmentOptions,
} from '../lib/domain/esign-center';
import { applyPolicyDefaults } from '../lib/domain/policy-defaults';

const policy = applyPolicyDefaults({
  policy_code: 'POL-T', provider_company_code: 'RP-T', deposit_installment: '2회까지',
}).next as Record<string, unknown>;
const partner = {
  partner_code: 'RP-T', name: '테스트렌터카', ceo: '홍길동',
  business_number: '1108100001', phone: '02-0000-0001', address: '서울시 어딘가',
};
const product = {
  product_code: 'RP-T_00가0001', provider_company_code: 'RP-T',
  vehicle_status: '출고가능', vehicle_name: '테스트 차량',
};

const base = {
  ...emptyEsignDraftInput('direct', '2026-08-20'),
  providerCompanyCode: 'RP-T',
  policyCode: 'POL-T',
  productCode: product.product_code,
  vehicleName: '테스트 차량',
  carNumber: '00가0001',
  rentMonths: '36',
  rentAmount: '420000',
  depositAmount: '840000',
  paymentTiming: '선불' as const,
  driverAge: '만 26세 이상',
};

const blocksOf = (form: typeof base) => validateEsignCenterContract(draftInputRecord(form), partner, policy, product)
  .filter((c) => c.level === 'BLOCK');

// ① 회차를 안 골랐으면 막힌다 — 계약서에 빈칸이 나가면 안 된다.
const noChoice = blocksOf({ ...base, depositInstallment: '' });
assert.ok(noChoice.some((c) => c.key === 'deposit_installment'), '회차 미선택은 막아야 한다');

// ② ★고르면 풀린다 — 이게 안 되면 보증금 있는 계약을 아예 못 만든다.
const options = depositInstallmentOptions(policy, 840000);
assert.ok(options.includes('일시납'), `일시납이 선택지에 있어야: ${options.join('/')}`);
const chosen = blocksOf({ ...base, depositInstallment: '일시납' });
assert.equal(
  chosen.filter((c) => c.key === 'deposit_installment').length, 0,
  `일시납을 골랐는데도 막힌다: ${chosen.map((c) => c.message).join(' · ')}`,
);
assert.equal(chosen.length, 0, `초안이 다 채워졌으면 막는 이유가 없어야: ${chosen.map((c) => `${c.label}=${c.message}`).join(' · ')}`);

// ③ 정책이 허용하지 않는 회차는 막는다(2회까지인데 3회 분납).
const tooMany = blocksOf({ ...base, depositInstallment: '3회 분납' });
assert.ok(tooMany.some((c) => c.key === 'deposit_installment'), '정책 밖 회차는 막아야 한다');

// ④ 무보증(0원)이면 회차를 안 골라도 통과한다.
const free = blocksOf({ ...base, depositAmount: '0', depositInstallment: '' });
assert.equal(free.filter((c) => c.key === 'deposit_installment').length, 0, '보증금 0원은 회차를 묻지 않는다');

// ⑤ 다리 자체 — 초안 레코드가 계약 레코드와 같은 자리에 선택값을 싣는다.
const record = draftInputRecord({ ...base, depositInstallment: '일시납' });
assert.equal(JSON.parse(String(record.contract_draft)).deposit_installment, '일시납');

console.log('✓ 초안 발송 게이트: 보증금 회차 선택이 검증기에 전달됨 · 정책 밖 회차 차단 · 무보증 예외');
