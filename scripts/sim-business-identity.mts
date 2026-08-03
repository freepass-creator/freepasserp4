/** 역할별 사업자번호 canonical reader 회귀검사. 실행: npx tsx scripts/sim-business-identity.mts */
import {
  businessRegistrationIdentity,
  businessRegistrationNumberOf,
  hasBusinessRegistrationConflict,
  normalizeBusinessRegistrationNumber,
} from '../lib/domain/business-identity';

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`PASS ${name}`); return; }
  failed++; console.error(`FAIL ${name}`, detail ?? '');
};

check('사업자번호 숫자 canonical', normalizeBusinessRegistrationNumber('123-45-67890') === '1234567890');
check('파트너 기존 정본 business_number 우선',
  businessRegistrationNumberOf({ business_number: '123-45-67890', business_no: '9999999999' }, 'partner') === '1234567890');
check('회원 기존 정본 business_no 우선',
  businessRegistrationNumberOf({ business_no: '111-22-33333', business_number: '9999999999' }, 'user') === '1112233333');
check('legacy alias fallback',
  businessRegistrationIdentity({ business_no: '', business_number: '222-33-44444' }, 'user').source === 'business_number');
check('포맷만 다른 동일값은 충돌 아님',
  !hasBusinessRegistrationConflict({ business_no: '123-45-67890', business_number: '1234567890' }, 'user'));
check('서로 다른 alias 값은 충돌',
  hasBusinessRegistrationConflict({ business_no: '1234567890', business_number: '9999999999' }, 'user'));
check('계약 고객 사업자번호 우선순위',
  businessRegistrationNumberOf({ customer_business_number: '333-44-55555', business_number: '9999999999' }, 'contract') === '3334455555');

console.log(`\nbusiness identity: ${passed}/${passed + failed} PASS`);
if (failed) process.exitCode = 1;
