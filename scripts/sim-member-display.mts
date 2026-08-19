/** 회원·회사 상태·유형 표시 회귀검사. 실행: npx tsx scripts/sim-member-display.mts */
import { partnerTypeLabel, UNCLASSIFIED_PARTNER_TYPE } from '../lib/domain/partner';
import { filterMembers, MEMBER_ACTIVE_OPTIONS, MEMBER_PARTNER_TYPE_OPTIONS, memberTypeLabel, PERSONAL_AGENT_COMPANY, PERSONAL_AGENT_LABEL } from '../features/members/member-filter';

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed += 1; console.log(`PASS ${name}`); return; }
  failed += 1;
  console.error(`FAIL ${name}`, detail ?? '');
};

check('영문 provider 정규화', partnerTypeLabel('provider', 'x') === '공급사');
check('레거시 RP 파트너는 공급사', partnerTypeLabel('파트너', 'RP013') === '공급사');
check('레거시 SP 파트너는 영업채널', partnerTypeLabel('파트너', 'SP001') === '영업채널');
check('의미 불명 PT 파트너는 임의 분류하지 않음', partnerTypeLabel('파트너', 'PT-0014') === UNCLASSIFIED_PARTNER_TYPE);
check('회사 유형 필터에 분류 필요 노출', MEMBER_PARTNER_TYPE_OPTIONS.some((option) => option.key === UNCLASSIFIED_PARTNER_TYPE));
check('계정 상태 필터에 승인대기 노출', MEMBER_ACTIVE_OPTIONS.some((option) => option.key === 'pending'));

const users = [
  { _key: 'pending', status: 'pending', is_active: '예' },
  { _key: 'inactive', status: 'active', is_active: '아니오' },
  { _key: 'inactive-false', status: 'active', is_active: false },
  { _key: 'rejected', status: 'rejected', is_active: '예' },
  { _key: 'active', status: 'active', is_active: '예' },
];
const byState = (active: 'active' | 'inactive' | 'pending') => filterMembers({
  rows: users, tab: 'user', query: '', sort: '', role: 'all', active, partnerType: 'all',
}).map((row) => row._key);
check('승인대기는 활성 필터와 겹치지 않음', JSON.stringify(byState('active')) === JSON.stringify(['active']), byState('active'));
check('비활성 상태가 문자열·boolean false·반려를 함께 포함',
  JSON.stringify(byState('inactive')) === JSON.stringify(['inactive', 'inactive-false', 'rejected']),
  byState('inactive'));
check('승인대기 상태 상호배타', JSON.stringify(byState('pending')) === JSON.stringify(['pending']), byState('pending'));

const unresolved = filterMembers({
  rows: [
    { _key: 'pt', partner_code: 'PT-0014', partner_type: '파트너' },
    { _key: 'rp', partner_code: 'RP013', partner_type: '파트너' },
  ],
  tab: 'partner', query: '', sort: '', role: 'all', active: 'all', partnerType: UNCLASSIFIED_PARTNER_TYPE,
});
check('분류 필요 필터가 미분류 회사만 선택', unresolved.length === 1 && unresolved[0]._key === 'pt', unresolved);

check('소속 없는 영업자는 개인영업자', memberTypeLabel('agent', '') === PERSONAL_AGENT_LABEL);
check('SP999 영업자는 개인영업자', memberTypeLabel('agent', PERSONAL_AGENT_COMPANY) === PERSONAL_AGENT_LABEL);
check('소속 있는 영업자는 영업자', memberTypeLabel('agent', 'SP001') === '영업자');

console.log(`\nmember display: ${passed}/${passed + failed} PASS`);
if (failed) process.exitCode = 1;
