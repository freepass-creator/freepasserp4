import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTemplateFieldsFromRecords } from '../lib/domain/esign-template-fields';

const contract: Record<string, unknown> = {
  contract_code: 'SNAP-1', contract_date: '2026-08-10', customer_name: '계약 당시 고객', customer_phone: '01012345678',
  provider_company_code: 'RP900', vehicle_name_snapshot: '계약 당시 차량', rent_month_snapshot: 48, rent_amount_snapshot: 600_000,
};
const policy: Record<string, unknown> = { insurance_included: '포함', basic_driver_age: '만 26세 이상', annual_mileage: '연 2만km' };
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
assert.notEqual(rebuilt.fields.customer_name, snapshot.templateFields.customer_name);
assert.notEqual(rebuilt.fields.company_ceo, snapshot.templateFields.company_ceo);

const issueRoute = readFileSync('app/api/freepass-esign/contracts/[contractCode]/route.ts', 'utf8');
const publicRoute = readFileSync('app/api/freepass-esign/public/[token]/route.ts', 'utf8');
assert.match(issueRoute, /v4\/esign_sessions\/\$\{hash\}[\s\S]*snapshot,/);
assert.match(publicRoute, /session\.snapshot/);
assert.doesNotMatch(publicRoute, /buildFreepassIssueSnapshot/);

console.log('✓ 전자계약 Snapshot: 발행값 불변 · 원본/정책/업체 변경 분리 · 고객 화면 재조립 금지');
