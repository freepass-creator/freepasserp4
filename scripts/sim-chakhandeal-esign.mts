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
  provider_company_code: 'RP012',
  sign_token: 'must-not-leak',
  driver_license_no: 'must-not-leak',
};
const partner = {
  partner_code: 'RP012',
  name: '손오공렌트',
  ceo: '홍길동',
  business_number: '1234567890',
  phone: '0212345678',
  address: '서울시 강남구',
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
  esign_required_documents: JSON.stringify([
    { key: 'resident_register', label: '주민등록등본', note: '최근 3개월 이내', required: true },
  ]),
};
const templateProfile = {
  mode: 'custom' as const,
  providerCode: 'RP012',
  externalTemplateId: 'external-sonogong-v1',
  label: '손오공 렌트 커스텀',
  version: 'sonogong-rent-v1',
  baseTemplateId: 'freepass-rent-standard' as const,
  baseVersion: 'sample-v1',
};
const payload = chakhandealIssuePayload({
  memberCompany: 'freepass',
  templateId: templateProfile.externalTemplateId,
  contractKind: 'rent_return',
  templateProfile,
}, contract, policy, '회사포함', partner);
const serialized = JSON.stringify(payload);
check('착한거래 계약 식별자 매핑', payload.externalRef === contract.contract_code);
check('외부 템플릿 ID와 계약유형을 분리',
  payload.templateId === 'external-sonogong-v1'
  && (payload.contractKind as { key?: string } | null)?.key === 'rent_return');
check('업체별 커스텀의 표준 기준판을 동봉',
  (payload.templateProfile as typeof templateProfile).baseTemplateId === 'freepass-rent-standard');
check('표준계약서에 공급사 법정 표시값 주입',
  (payload.data as { provider?: { code?: string; companyName?: string; ceo?: string } }).provider?.code === 'RP012'
  && (payload.data as { provider?: { companyName?: string } }).provider?.companyName === '손오공렌트'
  && (payload.data as { provider?: { ceo?: string } }).provider?.ceo === '홍길동');
check('핵심 계약 스냅샷 매핑', serialized.includes('12가3456') && serialized.includes('500000'));
check('자체 서명 토큰·면허번호 미전송', !serialized.includes('must-not-leak'));

// ── 손님 여정 페이로드 (ESIGN…INTEGRATION.md §3.1) ──
type Group = { key: string; rows: { label: string; value: string }[]; confirmLabel: string };
const groups = payload.consentGroups as Group[];
// 섹션 구성·순서는 sim-esign-contract-kind 가 본다. 여기선 «payload 에 실려 나가는가»만.
check('원자 섹션이 계약서 구성대로 실린다',
  groups.map((g) => g.key).join('|') === 'identity|vehicle|rental|payment|driver|insurance|accident|service',
  groups.map((g) => g.key));
check('묶음마다 동의 문구가 있다', groups.every((g) => !!g.confirmLabel));
check('동의 스냅샷 행에 Firebase 저장 불가 undefined 속성이 없다',
  groups.every((g) => g.rows.every((row) => Object.values(row).every((value) => value !== undefined))));
const rowValue = (key: string, label: string) => groups.find((g) => g.key === key)?.rows.find((r) => r.label === label)?.value;
// 표시 문자열을 우리가 굳혀 보낸다 — 저쪽이 다시 포맷하면 화면과 계약서 숫자가 갈린다.
check('월 대여료는 사람이 읽는 꼴', rowValue('rental', '월 대여료') === '500,000원', rowValue('rental', '월 대여료'));
check('대여기간은 차량 인도일 기준으로 표시한다', rowValue('rental', '대여기간') === '차량 인도일로부터 12개월', rowValue('rental', '대여기간'));
check('연락처에 하이픈이 붙는다', rowValue('identity', '연락처') === '010-1234-5678', rowValue('identity', '연락처'));
check('보증금이 있으면 금액으로', rowValue('rental', '보증금') === '1,000,000원', rowValue('rental', '보증금'));
check('고객은 관리자가 확정한 3종 중 한 계약서를 확인',
  rowValue('rental', '계약서 종류') === '프리패스 기본계약서 · 렌트·보험포함', rowValue('rental', '계약서 종류'));
check('고객 화면에 중복 만기 선택 행을 두지 않는다',
  !rowValue('rental', '만기 선택'), rowValue('rental', '만기 선택'));
check('고객은 확정된 만기 처리를 확인',
  !!rowValue('rental', '만기 처리')?.includes('반납'), rowValue('rental', '만기 처리'));
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
// 약관은 HTML 정본과 같은 21개 항목이며 대여 시작부터 반납·정산 순서로 구성된다.
check('약관은 정본으로 표시된다', agreement.isSample === false);
check('약관 28개 항목이 실린다', agreement.sections.length === 28, agreement.sections.length);
check('보험조건 조문이 실린다',
  agreement.sections.some((s) => (s as { t: string }).t.includes('제11조') && (s as { t: string }).t.includes('보험')));
check('신차·미정 계약에도 동일한 중고차 조건부 항을 보낸다',
  JSON.stringify(agreement.sections).includes('중고차량인 경우'));
const usedVehiclePayload = chakhandealIssuePayload({
  memberCompany: 'freepass', templateId: 'used-contract', contractKind: 'rent_return',
}, contract, policy, '회사포함', partner, { product: { product_type: '중고렌트' } });
check('중고 계약도 같은 약관 정본을 보낸다',
  JSON.stringify((usedVehiclePayload.agreement as { sections: unknown[] }).sections) === JSON.stringify(agreement.sections));
check('약관 본문이 잘리지 않았다',
  agreement.sections.every((s) => (s as { b: string }).b.length > 100));

// PII 경계 — 약관 문구에 이름이 언급될 수는 있지만 실제 전송 필드로는 존재하면 안 된다(§3).
const keysOf = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(keysOf);
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, nested]) => [key, ...keysOf(nested)]);
};
const forbiddenPiiKeys = keysOf(payload).filter((key) => {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  return ['residentnumber', 'jumin', 'ssn', 'customerssn', '주민등록번호'].includes(normalized);
});
check('주민번호 필드 미전송', forbiddenPiiKeys.length === 0, forbiddenPiiKeys);

const noTerm = { ...contract, rent_amount_snapshot: 0 };
let blocked = false;
try { chakhandealIssuePayload({ memberCompany: 'freepass', templateId: 't' }, noTerm); } catch { blocked = true; }
check('기간·금액 미동결 계약은 발행 거부', blocked);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
