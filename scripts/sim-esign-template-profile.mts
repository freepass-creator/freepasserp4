/**
 * 표준계약서 3벌 + 업체별·기준서식별 커스텀 선택 장부 회귀검증.
 * 실행: npx tsx scripts/sim-esign-template-profile.mts
 */
import {
  missingProviderContractIdentity,
  parseProviderTemplateOverrides,
  providerContractIdentity,
  resolveContractTemplateProfile,
} from '../lib/domain/esign-template-profile';
import { RENT_STANDARD_VERSION, findTemplate } from '../lib/domain/esign-templates';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
};

const empty = parseProviderTemplateOverrides(undefined);
check('설정이 없으면 커스텀 장부는 빈 객체', Object.keys(empty).length === 0);

const rent = findTemplate('freepass-rent-standard')!;
const subscriptionIncluded = findTemplate('freepass-subscription-insurance-included')!;
const standard = resolveContractTemplateProfile(rent, 'external-rent-standard-v1', 'RP999', empty);
check('미등록 업체는 표준계약서 적용',
  standard.mode === 'standard'
  && standard.externalTemplateId === 'external-rent-standard-v1'
  && standard.baseTemplateId === rent.id);

const overrides = parseProviderTemplateOverrides(JSON.stringify({
  rp012: {
    'freepass-rent-standard': {
      templateId: 'external-sonogong-rent-v1',
      label: '손오공 렌트 커스텀',
      version: 'sonogong-rent-v1',
      baseVersion: RENT_STANDARD_VERSION,
    },
  },
}));
const custom = resolveContractTemplateProfile(rent, 'external-rent-standard-v1', 'rp012', overrides);
check('공급사 코드는 대문자로 정규화', custom.providerCode === 'RP012');
check('등록된 업체의 해당 기준서식만 커스텀판 자동 적용',
  custom.mode === 'custom'
  && custom.externalTemplateId === 'external-sonogong-rent-v1'
  && custom.baseVersion === RENT_STANDARD_VERSION);
const untouched = resolveContractTemplateProfile(
  subscriptionIncluded, 'external-sub-included-v1', 'RP012', overrides,
);
check('같은 업체라도 커스텀하지 않은 다른 기준서식은 표준판', untouched.mode === 'standard');

let staleBlocked = false;
try {
  parseProviderTemplateOverrides(JSON.stringify({
    RP012: {
      'freepass-rent-standard': {
        templateId: 'old', label: '구버전', version: 'old-v1', baseVersion: 'old-standard',
      },
    },
  }));
} catch { staleBlocked = true; }
check('현재 표준판과 다른 커스텀판은 발행 설정 거부', staleBlocked);

let malformedBlocked = false;
try { parseProviderTemplateOverrides('{bad-json'); } catch { malformedBlocked = true; }
check('깨진 장부를 표준판으로 조용히 대체하지 않음', malformedBlocked);

const identity = providerContractIdentity({
  partner_code: 'RP012',
  name: '손오공렌트',
  representative_name: '홍길동',
  business_number: '123-45-67890',
  contact: '02-1234-5678',
  company_address: '서울시 강남구',
}, '');
check('기존 파트너 필드 별칭에서 법정 표시값 해석',
  identity.ceo === '홍길동' && identity.phone === '02-1234-5678');
check('정상 공급사 계약정보는 누락 없음', missingProviderContractIdentity(identity).length === 0);
check('법정 표시값이 비면 발행 전 차단',
  missingProviderContractIdentity(providerContractIdentity({ name: '빈 업체' }, 'RP999')).length >= 4);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
