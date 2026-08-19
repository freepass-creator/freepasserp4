import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTemplateFieldsFromRecords } from '../lib/domain/esign-template-fields';

const contract: Record<string, unknown> = {
  contract_code: 'SNAP-1', contract_date: '2026-08-10', customer_name: '계약 당시 고객', customer_phone: '01012345678',
  provider_company_code: 'RP900', vehicle_name_snapshot: '계약 당시 차량', rent_month_snapshot: 48, rent_amount_snapshot: 600_000,
  driver_age_snapshot: '만 24세 이상',
  contract_draft: JSON.stringify({ special_terms: '테스트 특약' }),
};
const policy: Record<string, unknown> = {
  insurance_included: '포함', basic_driver_age: '만 26세 이상', annual_mileage: '연 2만km',
  injury_deductible: 300_000, property_deductible: '300,000원',
  personal_driver_scope: '계약자 본인',
  early_termination_rate_under1y: 0.3,
  early_termination_rate_over1y: '20%',
  impound_fee: 10_000,
  screening_criteria: '내부심사-절대노출금지',
  credit_grade: '내부등급-절대노출금지',
  commission_clawback_condition: '내부환수-절대노출금지',
};
const partner: Record<string, unknown> = { partner_code: 'RP900', name: '계약 당시 렌터카', ceo: '계약 당시 대표', bank_name: '계약은행', bank_account: '100-200' };

const issued = buildTemplateFieldsFromRecords({ contract, policy, partner, product: null });
const snapshot = structuredClone({ templateFields: issued.fields, templateState: issued.state });
const sealedJson = JSON.stringify(snapshot);

contract.customer_name = '나중에 바꾼 고객';
contract.rent_amount_snapshot = 999_999;
policy.basic_driver_age = '만 30세 이상';
partner.ceo = '나중에 바꾼 대표';
const rebuilt = buildTemplateFieldsFromRecords({ contract, policy, partner, product: null });

assert.equal(JSON.stringify(snapshot), sealedJson, '발행 시 만든 Snapshot 객체는 원본 변경으로 바뀌면 안 된다');
assert.equal(snapshot.templateFields.customer_name, '계약 당시 고객');
assert.equal(snapshot.templateFields.company_ceo, '계약 당시 대표');
assert.equal(snapshot.templateFields.deductible_liability_person, '30만원');
assert.equal(snapshot.templateFields.deductible_liability_property, '30만원');
assert.equal(snapshot.templateFields.driver_age, '만 24세 이상', '건별 선택 연령이 정책 기본연령보다 우선해야 한다');
assert.equal(snapshot.templateFields.driver_scope, '계약자 본인');
// 사장님 2026-08-19 — 위약금은 글로 실린다(정률·개월분·정액 겸용). 옛 0.3 도 「잔여 대여료의 30%」로.
assert.equal(snapshot.templateFields.early_termination_rate_y1, '잔여 대여료의 30%');
assert.equal(snapshot.templateFields.early_termination_rate_y2, '잔여 대여료의 20%');
assert.equal(snapshot.templateFields.impound_fee, '1일 10,000원');
assert.equal(snapshot.templateFields.special_terms, '테스트 특약');
assert.equal(snapshot.templateFields.car_number, '차량번호 미정');
assert.doesNotMatch(sealedJson, /내부심사-절대노출금지|내부등급-절대노출금지|내부환수-절대노출금지/);
assert.notEqual(rebuilt.fields.customer_name, snapshot.templateFields.customer_name);
assert.notEqual(rebuilt.fields.company_ceo, snapshot.templateFields.company_ceo);

const issueRoute = readFileSync('app/api/freepass-esign/contracts/[contractCode]/route.ts', 'utf8');
const publicRoute = readFileSync('app/api/freepass-esign/public/[token]/route.ts', 'utf8');
assert.match(issueRoute, /v4\/esign_sessions\/\$\{hash\}[\s\S]*snapshot,/);
assert.match(publicRoute, /session\.snapshot/);
assert.doesNotMatch(publicRoute, /buildFreepassIssueSnapshot/);

console.log('✓ 전자계약 Snapshot: 발행값 불변 · 원본/정책/업체 변경 분리 · 고객 화면 재조립 금지');
