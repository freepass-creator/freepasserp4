import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildTemplateFieldsFromRecords,
  freepassVehicleStateIssueError,
  frozenTemplateStateFromRecords,
  isFrozenTemplateState,
  omitTemplateSemanticStateFields,
} from '../lib/domain/esign-template-fields';
import { productMatchesTemplate } from '../lib/domain/esign-vehicle-selection';
import { findTemplate } from '../lib/domain/esign-templates';

const contract: Record<string, unknown> = {
  contract_code: 'SNAP-1', contract_date: '2026-08-10', customer_name: '계약 당시 고객', customer_phone: '01012345678',
  provider_company_code: 'RP900', vehicle_name_snapshot: '계약 당시 차량', rent_month_snapshot: 48, rent_amount_snapshot: 600_000,
  driver_age_snapshot: '만 24세 이상',
  contract_kind: 'rent_return',
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
  insurer_name: '테스트손해보험 주식회사',
};
const partner: Record<string, unknown> = { partner_code: 'RP900', name: '계약 당시 렌터카', ceo: '계약 당시 대표', bank_name: '계약은행', bank_account: '100-200' };
const product: Record<string, unknown> = {
  product_code: 'VEH-SNAP-1', car_number: '12가3456', engine_cc: 1_598, mileage: 12_400,
  ext_color: '외장 색상', int_color: '내장 색상', product_type: '중고렌트',
};

const issued = buildTemplateFieldsFromRecords({ contract, policy, partner, product });
const noSpecialSnapshot = buildTemplateFieldsFromRecords({
  contract: { ...contract, special_terms_snapshot: '없음', contract_draft: JSON.stringify({ special_terms: '변경 가능한 초안 문구' }) },
  policy,
  partner,
  product,
});
assert.equal(noSpecialSnapshot.fields.special_terms, '없음', '특약 없음 스냅샷은 변경 가능한 초안 문구를 PDF에 남기지 않는다');
const snapshot = structuredClone({ templateFields: issued.fields, templateState: issued.state });
const sealedJson = JSON.stringify(snapshot);

contract.customer_name = '나중에 바꾼 고객';
contract.rent_amount_snapshot = 999_999;
policy.basic_driver_age = '만 30세 이상';
partner.ceo = '나중에 바꾼 대표';
product.engine_cc = 1_998;
product.mileage = 99_999;
const rebuilt = buildTemplateFieldsFromRecords({ contract, policy, partner, product });

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
assert.equal(snapshot.templateFields.car_number, '12가3456');
assert.equal(snapshot.templateFields.engine_cc, '1,598cc');
assert.equal(snapshot.templateFields.odometer_delivery, '12,400km');
assert.equal(snapshot.templateFields.insurer_name, '테스트손해보험 주식회사');
assert.doesNotMatch(sealedJson, /내부심사-절대노출금지|내부등급-절대노출금지|내부환수-절대노출금지/);
assert.notEqual(rebuilt.fields.customer_name, snapshot.templateFields.customer_name);
assert.notEqual(rebuilt.fields.company_ceo, snapshot.templateFields.company_ceo);
assert.equal(rebuilt.fields.engine_cc, '1,998cc');
assert.equal(rebuilt.fields.odometer_delivery, '99,999km');

const ev = buildTemplateFieldsFromRecords({
  contract, policy, partner,
  product: { product_code: 'VEH-EV-1', engine_cc: 0, mileage: 0 },
});
assert.equal(ev.fields.engine_cc, '', '전기·수소차 또는 미입력 배기량은 0cc를 만들지 않는다');
assert.equal(ev.fields.odometer_delivery, '0km', '신차의 0km 주행거리는 실제 값으로 남긴다');

// 상품·보험 상태는 templateFields/초안 입력이 아니라 발행 시 선택한 조합에서 따로 고정한다.
const rentalState = frozenTemplateStateFromRecords({
  contract: { ...contract, contract_kind: 'rent_return', customer_type: '개인' },
  product,
  insuranceSide: '회사포함',
});
assert.deepEqual(rentalState, { co: 'auto', pd: '렌트선택형', ins: '포함', ct: '개인', car: '등록완료', tax: '개인' });
assert.equal(isFrozenTemplateState(rentalState), true);
const directSubscriptionState = frozenTemplateStateFromRecords({
  contract: { ...contract, contract_kind: 'sub_buyout', customer_type: '개인사업자', car_number_snapshot: '100신0001' },
  product: { ...product, car_number: '100신0001', is_pending_plate: true, vin: 'KMH12345678901234' },
  insuranceSide: '고객직접',
});
assert.deepEqual(directSubscriptionState, { co: 'auto', pd: '구독인수형', ins: '별도', ct: '개인', car: '신차', tax: '사업자' });
assert.equal(freepassVehicleStateIssueError({ car_number_snapshot: '차량 미정' }, null).length > 0, true);
assert.equal(freepassVehicleStateIssueError({ car_number_snapshot: '100신0001' }, null), '');
const semanticOverride = omitTemplateSemanticStateFields({
  ...issued.fields, co: 'sonogong', pd: '구독인수형', ins: '별도', ct: '법인', car: '신차', tax: '사업자',
});
assert.equal(['co', 'pd', 'ins', 'ct', 'car', 'tax'].every((key) => !(key in semanticOverride)), true);
assert.equal(productMatchesTemplate(product, findTemplate('freepass-rent-standard')), true);
assert.equal(productMatchesTemplate({ ...product, product_type: '신차구독' }, findTemplate('freepass-rent-standard')), false);

const issueRoute = readFileSync('app/api/freepass-esign/contracts/[contractCode]/route.ts', 'utf8');
const publicRoute = readFileSync('app/api/freepass-esign/public/[token]/route.ts', 'utf8');
const chakhandealPreviewRoute = readFileSync('app/api/chakhandeal/contracts/[contractCode]/template-fields/route.ts', 'utf8');
const chakhandealSendRoute = readFileSync('app/api/chakhandeal/contracts/send/route.ts', 'utf8');
assert.match(issueRoute, /v4\/esign_sessions\/\$\{hash\}[\s\S]*snapshot,/);
assert.match(issueRoute, /activeSession\(currentSession\) && hasFrozenFreepassTemplateState\(currentSession\)/);
assert.match(publicRoute, /session\.snapshot/);
assert.match(publicRoute, /hasFrozenFreepassTemplateState\(session\)/);
assert.match(publicRoute, /status !== 'signed' && !hasFrozenFreepassTemplateState\(session\)/);
assert.match(issueRoute, /hasFrozenFreepassTemplateState\(session\)/);
assert.doesNotMatch(publicRoute, /buildFreepassIssueSnapshot/);
assert.match(chakhandealPreviewRoute, /product:\s*bundle\.product/);
assert.match(chakhandealSendRoute, /legacyProductSnap[\s\S]*overlayProductSnap/);
assert.match(chakhandealSendRoute, /\{ \.\.\.\(legacyProduct \|\| \{\}\), \.\.\.\(overlayProduct \|\| \{\}\) \}/);
assert.match(chakhandealSendRoute, /const legacyProduct = findByCar[\s\S]*const overlayProduct = findByCar/);
assert.match(chakhandealSendRoute, /!product \|\| !productMatchesTemplate\(product, standardTemplate\)/);
const freepassServer = readFileSync('lib/server/freepass-esign.ts', 'utf8');
const freepassDocument = readFileSync('lib/server/freepass-esign-document.ts', 'utf8');
const contractTemplate = readFileSync('public/contract-template/rental-contract.html', 'utf8');
assert.match(freepassServer, /templateFields: omitTemplateSemanticStateFields\(templateSnapshot\.fields\)/);
assert.match(freepassServer, /templateState,/);
assert.match(freepassServer, /productMatchesTemplate\(args\.product, template\)/);
assert.match(freepassServer, /delete overrides\.insurer_name/);
assert.match(freepassServer, /hasFrozenFreepassTemplateState/);
assert.match(freepassDocument, /isFrozenTemplateState\(snapshot\.templateState\)/);
assert.match(contractTemplate, /if\(!SEALED\) state\[k\]=o\[k\]/);
assert.match(contractTemplate, /if\(SEALED&&SEALED_READY\) return/);
assert.match(contractTemplate, /SEALED_READY=true/);
assert.match(contractTemplate, /if\(String\(DATA\.vin\|\|''\)\.trim\(\)\) applyField\('vin'\)/);

console.log('✓ 전자계약 Snapshot: 발행값 불변 · 보험사/상품상태 봉인 · 상태 입력 우회 차단 · 고객 화면 재조립 금지');
