import { canSendChakhandealContract, chakhandealIssuePayload, type ChakhandealActor } from '../lib/domain/chakhandeal-esign';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
}

const contract = {
  contract_code: 'TMP-260804-01-test',
  agent_uid: 'agent-1',
  agent_channel_code: 'channel-1',
  customer_name: '홍길동',
  customer_phone: '01012345678',
  car_number_snapshot: '12가3456',
  vehicle_name_snapshot: '테스트 차량',
  rent_month_snapshot: 12,
  rent_amount_snapshot: 500_000,
  deposit_amount_snapshot: 1_000_000,
  sign_token: 'must-not-leak',
  driver_license_no: 'must-not-leak',
};
const actor = (overrides: Partial<ChakhandealActor>): ChakhandealActor => ({
  uid: 'other', role: 'agent', rawRole: 'agent', agentChannelCode: '', ...overrides,
});

check('플랫폼 관리자 허용', canSendChakhandealContract(actor({ role: 'admin', rawRole: 'admin' }), contract));
check('계약 소유 영업자 허용', canSendChakhandealContract(actor({ uid: 'agent-1' }), contract));
check('같은 채널 관리자 허용', canSendChakhandealContract(actor({ rawRole: 'agent_admin', agentChannelCode: 'channel-1' }), contract));
check('다른 영업자 차단', !canSendChakhandealContract(actor({ uid: 'agent-2' }), contract));
check('다른 채널 관리자 차단', !canSendChakhandealContract(actor({ rawRole: 'agent_manager', agentChannelCode: 'channel-2' }), contract));
check('공급사 계정 차단', !canSendChakhandealContract(actor({ role: 'provider', rawRole: 'provider_admin' }), contract));

const payload = chakhandealIssuePayload({ memberCompany: 'freepass', templateId: 'standard-rental' }, contract);
const serialized = JSON.stringify(payload);
check('착한거래 계약 식별자 매핑', payload.externalRef === contract.contract_code);
check('핵심 계약 스냅샷 매핑', serialized.includes('12가3456') && serialized.includes('500000'));
check('자체 서명 토큰·면허번호 미전송', !serialized.includes('must-not-leak'));

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
