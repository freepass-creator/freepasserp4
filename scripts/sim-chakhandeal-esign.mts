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

// 발송은 플랫폼 관리자 한 사람 축으로만 열린다(2026-08-08 결정).
// 계약 소유·같은 채널 같은 «관계»는 판정에 넣지 않는다 — 넣는 순간 영업측이 다시 열린다.
check('플랫폼 관리자 허용', canSendChakhandealContract(actor({ role: 'admin', rawRole: 'admin' }), contract));
check('계약 소유 영업자도 차단', !canSendChakhandealContract(actor({ uid: 'agent-1' }), contract));
check('영업 관리자(agent_admin) 차단', !canSendChakhandealContract(actor({ rawRole: 'agent_admin', agentChannelCode: 'channel-1' }), contract));
check('영업 매니저(agent_manager) 차단', !canSendChakhandealContract(actor({ rawRole: 'agent_manager', agentChannelCode: 'channel-1' }), contract));
check('다른 영업자 차단', !canSendChakhandealContract(actor({ uid: 'agent-2' }), contract));
check('공급사 계정 차단', !canSendChakhandealContract(actor({ role: 'provider', rawRole: 'provider_admin' }), contract));
check('공급사 관리자 차단', !canSendChakhandealContract(actor({ role: 'provider', rawRole: 'provider' }), contract));
// role 만 위조해도 뚫리지 않는지 — 두 축이 모두 admin 일 때만 통과한다.
check('role 만 admin 인 위조 차단', !canSendChakhandealContract(actor({ role: 'admin', rawRole: 'agent_admin' }), contract));

const policy = {
  injury_compensation_limit: '무한',
  property_compensation_limit: '2억원',
  own_damage_min_deductible: '30만원',
  annual_mileage: '연 2만km',
  penalty_condition: '잔여 대여료의 30%',
  basic_driver_age: '만 26세 이상',
};
const payload = chakhandealIssuePayload({ memberCompany: 'freepass', templateId: 'standard-rental' }, contract, policy);
const serialized = JSON.stringify(payload);
check('착한거래 계약 식별자 매핑', payload.externalRef === contract.contract_code);
check('핵심 계약 스냅샷 매핑', serialized.includes('12가3456') && serialized.includes('500000'));
check('자체 서명 토큰·면허번호 미전송', !serialized.includes('must-not-leak'));

// ── 손님 여정 페이로드 (ESIGN…INTEGRATION.md §3.1) ──
type Group = { key: string; rows: { label: string; value: string }[]; confirmLabel: string };
const groups = payload.consentGroups as Group[];
check('원자 묶음 4개 · 순서 = 본인정보→차량정보→대여조건→보험',
  groups.map((g) => g.key).join('|') === 'identity|vehicle|rental|insurance', groups.map((g) => g.key));
check('묶음마다 동의 문구가 있다', groups.every((g) => !!g.confirmLabel));
const rowValue = (key: string, label: string) => groups.find((g) => g.key === key)?.rows.find((r) => r.label === label)?.value;
// 표시 문자열을 우리가 굳혀 보낸다 — 저쪽이 다시 포맷하면 화면과 계약서 숫자가 갈린다.
check('월 대여료는 사람이 읽는 꼴', rowValue('rental', '월 대여료') === '500,000원', rowValue('rental', '월 대여료'));
check('대여기간에 단위가 붙는다', rowValue('rental', '대여기간') === '12개월', rowValue('rental', '대여기간'));
check('연락처에 하이픈이 붙는다', rowValue('identity', '연락처') === '010-1234-5678', rowValue('identity', '연락처'));
check('보증금이 있으면 금액으로', rowValue('rental', '보증금') === '1,000,000원', rowValue('rental', '보증금'));
// 보증금 0 은 «값 없음»이 아니라 «무보증»이라는 계약 조건이다. 행이 사라지면 손님이 못 읽는다.
const zeroDeposit = chakhandealIssuePayload(
  { memberCompany: 'freepass', templateId: 't' },
  { ...contract, deposit_amount_snapshot: 0 },
).consentGroups as Group[];
check('보증금 0 은 «무보증»으로 읽힌다',
  zeroDeposit.find((g) => g.key === 'rental')?.rows.find((r) => r.label === '보증금')?.value === '무보증',
  zeroDeposit.find((g) => g.key === 'rental')?.rows.map((r) => `${r.label}=${r.value}`));
check('보험 라벨은 entities 사전 그대로', rowValue('insurance', '대인 보상한도') === '무한');
// 값이 없는 보장을 «—» 로 채우면 손님이 있는 걸로 읽는다.
check('정책에 없는 보험 행은 아예 빠진다', !rowValue('insurance', '자손 보상한도'));

check('필수서류 목록 동봉', Array.isArray(payload.requiredDocs) && (payload.requiredDocs as unknown[]).length > 0);
const agreement = payload.agreement as { version: string; isSample: boolean; requireReadThrough: boolean; sections: unknown[] };
check('약관 통독 강제', agreement.requireReadThrough === true);
check('약관 버전이 실린다', !!agreement.version);
check('샘플 약관은 샘플이라고 표시된다', agreement.isSample === true);

// PII 경계 — 주민번호·면허번호는 우리가 보내지 않는다(§3).
check('주민번호 필드 미전송', !/residentNumber|jumin|ssn|주민등록번호/i.test(serialized));

const noTerm = { ...contract, rent_amount_snapshot: 0 };
let blocked = false;
try { chakhandealIssuePayload({ memberCompany: 'freepass', templateId: 't' }, noTerm); } catch { blocked = true; }
check('기간·금액 미동결 계약은 발행 거부', blocked);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
