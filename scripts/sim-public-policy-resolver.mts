import assert from 'node:assert/strict';
import { createPublicPolicyResolver } from '../lib/server/public-policy-resolver';
import { sanitizeProductForGuest } from '../lib/domain/public-catalog';

type Rec = Record<string, any>;
const policy = (extra: Rec = {}): Rec => ({
  policy_code: 'POL_S01', _key: 'firestore-policy-doc-1', provider_company_code: 'RP001',
  insurance_included: '보험료 포함', annual_mileage: '연 20,000km', ...extra,
});

const resolve = createPublicPolicyResolver([
  policy(),
  policy({ policy_code: 'POL_P01', _key: 'firestore-policy-doc-p1', provider_company_code: 'RP003' }),
  policy({ policy_code: 'POL_RENT', _key: 'firestore-policy-doc-2', provider_company_code: 'RP002', policy_name: '렌트' }),
  policy({ policy_code: 'POL_SUB', _key: 'firestore-policy-doc-3', provider_company_code: 'RP002', policy_name: '구독' }),
]);

assert.equal(resolve({ policy_code: 'POL_S01' }).policy?.insurance_included, '보험료 포함', '업무코드 정책 조인이 깨졌습니다.');
assert.equal(resolve({ policy_code: 'firestore-policy-doc-1' }).policy?.insurance_included, '보험료 포함', 'Firestore 문서 ID 정책 조인이 깨졌습니다.');
assert.equal(resolve({ policy_code: 'POL_S1' }).policy?.insurance_included, '보험료 포함', '_S 제로패딩 정책 조인이 깨졌습니다.');
assert.equal(resolve({ policy_code: 'POL_P1' }).policy?.insurance_included, '보험료 포함', '_P 제로패딩 정책 조인이 깨졌습니다.');
assert.equal(resolve({ provider_company_code: 'RP001', product_type: '중고구독' }).policy?.insurance_included, '보험료 포함', '단일 공급사 정책 자동 해소가 깨졌습니다.');
assert.equal(resolve({ provider_company_code: 'RP002', product_type: '중고렌트' }).policy?.policy_name, '렌트', '상품구분 정책 해소가 깨졌습니다.');
assert.equal(resolve({ provider_company_code: 'RP002' }).policy, null, '모호한 정책을 임의 연결했습니다.');
assert.equal(resolve({ policy_code: 'POL_ORPHAN', _policy: { insurance_included: '보험료 별도' } }).policy, null, '고아 정책코드를 오래된 내장 정책으로 대체했습니다.');
const embedded = resolve({ _policy: { insurance_included: '보험료 별도' } });
assert.equal(embedded.policy?.insurance_included, '보험료 별도', '상품에 보존된 정책 fallback이 유실됐습니다.');
assert.equal(embedded.applyDefaults, false, '상품 내장 정책에 기본값 보충이 허용됐습니다.');
assert.equal(resolve({ policy_code: 'POL_S01', _policy: { insurance_included: '보험료 별도' } }).policy?.insurance_included, '보험료 포함', '외부 정책보다 임베드 정책이 우선했습니다.');

const linked = resolve({ policy_code: 'POL_S01' });
const guest = sanitizeProductForGuest('veh_test', { policy_code: 'POL_S01' }, linked.policy, { applyDefaults: linked.applyDefaults });
assert.equal((guest._policy as Rec)?.insurance_included, '보험료 포함', '해소된 보험값이 손님 응답에서 누락됐습니다.');
const sparseGuest = sanitizeProductForGuest('veh_sparse', {}, embedded.policy, { applyDefaults: embedded.applyDefaults });
assert.deepEqual(sparseGuest._policy, { insurance_included: '보험료 별도' }, '내장 정책 fallback에 원본에 없는 기본 보험·계약 조건이 추가됐습니다.');
const redacted = sanitizeProductForGuest('veh_redacted', {}, { insurance_included: '보험료 포함', fee_rate: 99, partner_memo: 'internal' }, { applyDefaults: false });
assert.deepEqual(redacted._policy, { insurance_included: '보험료 포함' }, '내장 정책 fallback에서 내부 정책값이 공개됐습니다.');
console.log('PASS public policy resolver: code/doc-id/padding/auto/ambiguous/embedded/public boundary');
