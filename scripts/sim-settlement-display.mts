/**
 * 정산 표시 SSOT 회귀검증. writer·금액 엔진·저장소를 호출하지 않는다.
 * 실행: npx tsx scripts/sim-settlement-display.mts
 */
import type { EntityRecord } from '../lib/intake/entities';
import {
  UNKNOWN_SETTLEMENT_STATUS,
  buildSettlementDisplayIndex,
  compareSettlementDisplayStatus,
  matchesSettlementDisplayStatus,
  normalizeSettlementDisplayStatus,
  settlementDisplayTone,
  settlementListDisplay,
  settlementNetTone,
  settlementNeedsAttention,
} from '../lib/domain/settlement-display';

type Case = { name: string; ok: boolean; detail?: unknown };
const cases: Case[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  cases.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail == null ? '' : ` — ${JSON.stringify(detail)}`}`);
}

console.log('\n정산 표시 SSOT 회귀검증\n');

check('상태: 지원 상태는 그대로 유지', normalizeSettlementDisplayStatus(' 정산완료 ') === '정산완료');
check('상태: 누락값은 대기로 위장하지 않음', normalizeSettlementDisplayStatus('') === UNKNOWN_SETTLEMENT_STATUS);
check('상태: 지원외 값은 상태 확인', normalizeSettlementDisplayStatus('처리중') === UNKNOWN_SETTLEMENT_STATUS);
check('상태: 상태 확인은 red', settlementDisplayTone('처리중') === 'red');
check('필터: 누락값은 상태 확인에서 노출', matchesSettlementDisplayStatus({}, UNKNOWN_SETTLEMENT_STATUS));
check('필터: 누락값은 정산대기에 섞이지 않음', !matchesSettlementDisplayStatus({}, '정산대기'));
check('카운트: 정산대기 포함', settlementNeedsAttention({ settlement_status: '정산대기' }));
check('카운트: 환수대기 포함', settlementNeedsAttention({ settlement_status: '환수대기' }));
check('카운트: 상태 확인 포함', settlementNeedsAttention({ settlement_status: '임의상태' }));
check('카운트: 정산완료 제외', !settlementNeedsAttention({ settlement_status: '정산완료' }));
const workflowSorted = ['환수결정', '정산완료', '알수없음', '정산보류', '환수대기', '정산대기']
  .sort(compareSettlementDisplayStatus);
check(
  '정렬: 가나다순이 아닌 업무 흐름순',
  workflowSorted.join(' > ') === '정산대기 > 정산보류 > 정산완료 > 환수대기 > 환수결정 > 알수없음',
  workflowSorted,
);
check('순수익: 음수는 경고 토큰', settlementNetTone(-1) === 'danger');
check('순수익: 양수는 강조 토큰', settlementNetTone(1) === 'brand');
check('순수익: 0·비정상 값은 중립 토큰', settlementNetTone(0) === 'mute' && settlementNetTone('값없음') === 'mute');

const contracts: EntityRecord[] = [{
  _key: '-push-key',
  contract_code: 'CT-1',
  maker_snapshot: '기아',
  sub_model_snapshot: '더 뉴 쏘렌토 MQ4',
  trim_name_snapshot: '노블레스',
  car_number_snapshot: '12가3456',
  contract_date: '2026-07-11',
  customer_name: '김고객',
  provider_company_code: 'RP013',
  agent_uid: 'firebase-uid-for-agent-0001',
  agent_channel_code: 'SP001',
}];
const partners: EntityRecord[] = [
  {
    _key: 'provider-push',
    partner_code: 'RP013',
    partner_name: '주식회사 웰릭스렌터카',
  },
  {
    _key: 'channel-push',
    partner_code: 'SP001',
    partner_name: '서울 중앙 영업채널',
  },
];
const users: EntityRecord[] = [{
  _key: 'firebase-uid-for-agent-0001',
  uid: 'firebase-uid-for-agent-0001',
  user_code: 'S0035',
  name: '최영업',
}];
const index = buildSettlementDisplayIndex(contracts, partners, users);
const settlement: EntityRecord = {
  settlement_code: 'ST-1',
  contract_code: 'CT-1',
  settlement_status: '정산대기',
  vehicle_name_snapshot: '현대 잘못된 현재값',
  car_number: '99나9999',
  customer_name: '김고객',
  provider_company_code: 'RP013',
  agent_uid: 'firebase-uid-for-agent-0001',
  agent_code: 'S0035',
};
const display = settlementListDisplay(settlement, index);

check('조인: push key가 아닌 계약코드로 계약 연결', display.contract === contracts[0]);
check('T1: 정산 자체 값보다 계약 스냅샷 차량명 우선', display.vehicleName === '기아 더 뉴 쏘렌토 MQ4 노블레스', display.vehicleName);
check('T2: 계약 snapshot 차번 우선', display.plate === '12가3456', display.plate);
check('T2: 정산 결손 계약일은 계약에서 보강', display.contractDate === '2026-07-11', display.contractDate);
check('T3: 업체 코드를 실제 업체명 별칭으로 해석', display.providerName === '웰릭스', display.providerName);
check('T3: UID·업무코드를 실제 영업자명으로 해석', display.agentName === '최영업', display.agentName);
check('T3: 계약 영업채널 코드를 파트너 표시명으로 해석', display.channelName === '서울 중앙 영업채널', display.channelName);
check('T3: 고객명 유지', display.customerName === '김고객', display.customerName);

const snapshotOnly = settlementListDisplay({
  settlement_status: '정산완료',
  maker_snapshot: '현대',
  sub_model_snapshot: '아반떼 CN7',
  trim_name_snapshot: '모던',
}, buildSettlementDisplayIndex([], [], []));
check('T1: 계약 미조회 시 정산 snapshot으로 복원', snapshotOnly.vehicleName === '현대 아반떼 CN7 모던', snapshotOnly.vehicleName);

// settlement-import는 레거시 엑셀의 명칭을 *_code 필드에 그대로 보존한다.
const importedLegacy = settlementListDisplay({
  provider_company_code: '주식회사웰릭스렌터카',
  agent_code: '최영업',
  agent_channel_code: '서울채널',
}, buildSettlementDisplayIndex([], [], []));
check('T3: 임포트 업체명 code-field fallback (서울채널 행)', importedLegacy.providerName === '웰릭스', importedLegacy.providerName);
check('T3: 임포트 영업자명 code-field fallback (서울채널 행)', importedLegacy.agentName === '최영업', importedLegacy.agentName);
check('T3: 임포트 영업채널 명칭 fallback', importedLegacy.channelName === '서울채널', importedLegacy.channelName);

const unresolved = settlementListDisplay({
  provider_company_code: 'RP004',
  agent_code: 'S0035',
}, buildSettlementDisplayIndex([], [], []));
check('T3: 이름 미확인 코드를 업체명으로 위장하지 않음', unresolved.providerName === '', unresolved.providerName);
check('T3: 이름 미확인 코드를 영업자명으로 위장하지 않음', unresolved.agentName === '', unresolved.agentName);
check('T3: 이름 미확인 채널코드를 표시명으로 위장하지 않음', settlementListDisplay({ agent_channel_code: 'SP999' }, buildSettlementDisplayIndex([], [], [])).channelName === '');

const unresolvedUid = settlementListDisplay({
  agent_code: 'firebase-uid-for-agent-0001',
}, buildSettlementDisplayIndex([], [], []));
check('T3: UID를 영업자명으로 위장하지 않음', unresolvedUid.agentName === '', unresolvedUid.agentName);

const failed = cases.filter((item) => !item.ok);
console.log(`\n결과: ${cases.length - failed.length}/${cases.length} PASS\n`);
if (failed.length) process.exit(1);
