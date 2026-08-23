import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildFreepassConsentProfile,
  freepassConsentOperationalBlocker,
  isFrozenFreepassConsentProfile,
} from '../lib/domain/freepass-esign-consents';
import { snapshotWithPrivateSubmission } from '../lib/domain/esign-signed-snapshot';

let pass = 0;
function check(label: string, actual: unknown) {
  assert.ok(actual, label);
  pass += 1;
}

const base = {
  landlordCompanyName: '검증 렌터카 주식회사',
  paymentMethod: '계좌이체',
  screeningCriteria: '무심사',
  requiredDocuments: [],
};

const plain = buildFreepassConsentProfile({ ...base, gpsInstalled: '미장착' });
check('일반 렌탈은 약관·개인정보만 동결', JSON.stringify(plain.requiredKeys) === JSON.stringify(['rental_terms', 'privacy']));
check('일반 렌탈은 GPS 동의를 강제하지 않음', !plain.requiredKeys.includes('gps'));
check('일반 렌탈 profile이 유효함', isFrozenFreepassConsentProfile(plain));

const conditional = buildFreepassConsentProfile({
  ...base,
  // 실제 시트/레거시에서 쓰는 뜻이 확정된 표기도 같은 동의 규격으로 봉인한다.
  gpsInstalled: 'GPS 장착',
  paymentMethod: '계좌이체',
  requiredDocuments: [{ key: 'resident_register', label: '주민등록등본', note: '', required: true }],
});
check('GPS 장착 계약에만 위치정보 동의가 추가됨', conditional.requiredKeys.includes('gps'));
check('추가서류 계약에만 서류 동의가 추가됨', conditional.requiredKeys.includes('supporting_documents_consent'));
check('계좌이체 계약은 별도 수납위임 없이 진행 가능함', !conditional.requiresExternalPaymentAuthorization && !freepassConsentOperationalBlocker(conditional));
check('조건부 profile이 유효함', isFrozenFreepassConsentProfile(conditional));
const cms = buildFreepassConsentProfile({ ...base, gpsInstalled: '미장착', paymentMethod: 'CMS' });
check('CMS는 본계약과 분리된 수납위임이 필요함', cms.cmsRequiredBeforeHandover && cms.requiresExternalPaymentAuthorization);
check('CMS 동의 흐름이 없는 상품은 링크 발행 전에 차단됨', /CMS 자동이체 상품/.test(freepassConsentOperationalBlocker(cms)) && !isFrozenFreepassConsentProfile(cms));
const card = buildFreepassConsentProfile({ ...base, gpsInstalled: '미장착', paymentMethod: '카드 자동결제' });
check('카드 자동결제도 수납위임 전에는 링크 발행을 막음', /카드 자동결제 상품/.test(freepassConsentOperationalBlocker(card)) && !isFrozenFreepassConsentProfile(card));
assert.throws(() => buildFreepassConsentProfile({ ...base, gpsInstalled: '미장착', screeningCriteria: '신용조회' }), /신용조회 계약/);
pass += 1;
for (const alias of ['신용확인', '신용심사', '심사필요', '신용 조회']) {
  assert.throws(() => buildFreepassConsentProfile({ ...base, gpsInstalled: '미장착', screeningCriteria: alias }), /신용조회 계약/);
  pass += 1;
}
assert.throws(() => buildFreepassConsentProfile({ ...base, gpsInstalled: '미장착', screeningCriteria: '기본심사' }), /심사조건/);
pass += 1;
assert.throws(() => buildFreepassConsentProfile({ ...base, gpsInstalled: '확인필요' }), /GPS 장착 여부/);
pass += 1;
assert.throws(() => buildFreepassConsentProfile({ ...base, gpsInstalled: '미장착', paymentMethod: '미정' }), /결제방식/);
pass += 1;

const consentTimes = Object.fromEntries(conditional.requiredKeys.map((key) => [key, 1_785_000_000_000]));
const signed = snapshotWithPrivateSubmission({
  templateFields: {},
  consentProfile: conditional,
}, {
  submittedAt: 1_785_000_000_000,
  customer_name: '검증 임차인',
  consentTimes,
});
const signedFields = signed.templateFields as Record<string, string>;
check('완료본에 실제 동의 키가 봉인됨', signedFields.esign_consent_keys === conditional.requiredKeys.join(','));
check('완료본에 동의 수가 명시됨', signedFields.esign_consent_status === '4건 필수 동의·계약조건 확인 완료');
check('완료본에 동의 항목명이 명시됨', /위치정보/.test(signedFields.esign_consent_summary) && /추가 제출서류/.test(signedFields.esign_consent_summary));

const incomplete = snapshotWithPrivateSubmission({ templateFields: {}, consentProfile: conditional }, {
  submittedAt: 1_785_000_000_000,
  consentTimes: { rental_terms: 1, privacy: 1 },
});
const incompleteFields = incomplete.templateFields as Record<string, string>;
check('누락 동의는 완료본에 완료로 표기하지 않음', !incompleteFields.esign_consent_status && !incompleteFields.esign_consent_keys);

const publicRoute = readFileSync('app/api/freepass-esign/public/[token]/route.ts', 'utf8');
const handoverRoute = readFileSync('app/api/freepass-esign/contracts/[contractCode]/handover/route.ts', 'utf8');
const issueBuilder = readFileSync('lib/server/freepass-esign.ts', 'utf8');
const template = readFileSync('public/contract-template/rental-contract.html', 'utf8');
check('고객 제출은 frozen consent profile을 검증함', /hasFrozenFreepassConsentProfile\(session\)/.test(publicRoute));
check('인도일 확정도 현재 동의 profile을 다시 검증함', /hasFrozenFreepassConsentProfile\(session\)/.test(handoverRoute));
check('CMS 미등록 계약은 인도일 확정을 막음', /cmsRequiredBeforeHandover === true/.test(handoverRoute));
check('CMS 미연동 상품은 발행 단계에서 먼저 막음', /freepassConsentOperationalBlocker\(consentProfile\)/.test(issueBuilder));
check('완료 PDF는 profile별 동의 행만 표시함', /data-consent-key="supporting_documents_consent"/.test(template) && /esign_consent_keys/.test(template));

console.log(`PASS: Freepass consent profile ${pass}/${pass}`);
