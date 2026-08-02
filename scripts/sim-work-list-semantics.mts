/**
 * 계약문의·계약진행 목록 의미 체계 회귀검증.
 * 저장소/브라우저 없이 read-only resolver와 필터 규격만 검증한다.
 * 실행: npx tsx scripts/sim-work-list-semantics.mts
 */
import type { EntityRecord } from '../lib/intake/entities';
import { chatDisplayName } from '../lib/domain/deal';
import {
  STEPS,
  contractStage,
  contractTone,
  isContractCancelled,
  isContractCompleted,
  isContractInProgress,
  isInquiryOnly,
  needsContractFinalization,
  normalizeContractStatus,
} from '../lib/domain/contract';
import { contractHaystack, matchHay, roomHaystack } from '../lib/domain/search';
import {
  contractVehicleLabel,
  productVehicleLabel,
  roomVehicleLabel,
  withVehicleMaker,
} from '../lib/domain/vehicle-label';
import {
  buildContractIndex,
  buildProductLookup,
  chatCodeOf,
  contractForRoom,
  findRoomForContract,
  productForRoom,
  roomModel,
  roomTitle,
} from '../features/chat/room-display';
import { chatRowContract, filterChatRooms } from '../features/chat/room-filter';
import {
  CONTRACT_FILTER_OPTIONS,
  contractWorkflowGroup,
  filterContracts,
} from '../features/contract/contract-filter';
import { runContractMutation } from '../features/contract/contract-mutation';
import {
  compactTextParts,
  isOpaqueIdentity,
  isSafeBusinessCode,
  joinMetaText,
  retainVisibleSelection,
  workPartyParts,
} from '../features/work-list-display';

type Case = { name: string; ok: boolean; detail?: unknown };
const cases: Case[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  cases.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail == null ? '' : ` — ${JSON.stringify(detail)}`}`);
}

console.log('\n계약 업무 목록 의미 체계 회귀검증\n');

const product: EntityRecord = {
  _key: 'p1', product_code: 'p1', car_number: '12가3456', maker: '기아',
  sub_model: '스포티지', trim_name: '노블레스', provider_company_code: 'RP013', provider_name: '웰릭스',
};
const room: EntityRecord = {
  _key: 'CH_p1_U0001', product_code: 'p1', agent_code: 'U0001',
  vehicle_name: '스포티지', car_number: '12가3456', provider_company_code: 'RP013',
};
const baseContract: EntityRecord = {
  contract_code: 'C-1', product_code: 'p1', agent_code: 'U0001', agent_name: '김영업',
  provider_company_code: 'RP013', provider_name: '웰릭스', contract_status: '계약요청', maker_snapshot: '기아',
  sub_model_snapshot: '스포티지', car_number_snapshot: '12가3456', customer_name: '홍고객',
  customer_phone: '010-1234-5678',
};

// A. 제조사·차량명 SSOT
check('A1 상품 차량명에 제조사·트림 포함', productVehicleLabel(product) === '기아 스포티지 노블레스', productVehicleLabel(product));
check('A2 이미 앞에 있는 제조사 중복 금지', productVehicleLabel({ maker: '기아', vehicle_name: '기아 K5' }) === '기아 K5');
check('A3 이름 중간의 제조사도 중복 금지', withVehicleMaker('기아', '더 뉴 기아 K5') === '더 뉴 기아 K5');
check('A4 더 구체적인 레거시 전체 차명 보존', productVehicleLabel({
  maker: '기아', sub_model: 'K5', vehicle_name: '기아 K5 1.6T 시그니처',
}) === '기아 K5 1.6T 시그니처');
check('A5 상품이 방·계약 스냅샷보다 우선', roomVehicleLabel(room, product, baseContract) === '기아 스포티지 노블레스');
check('A6 계약 snapshot 전체 차명 보존', contractVehicleLabel({
  maker_snapshot: '제네시스', vehicle_name_snapshot: '제네시스 G80 2.5T',
}) === '제네시스 G80 2.5T');
check('A7 계약 maker+model fallback', contractVehicleLabel({ maker_snapshot: '현대', model_snapshot: '그랜저' }) === '현대 그랜저');
const liveLookup = buildProductLookup([product]);
const emptyLookup = buildProductLookup([]);
check('A8 문의 roomModel canonical', roomModel(room, liveLookup, emptyLookup, [baseContract], baseContract) === '기아 스포티지 노블레스');
check('A9 문의 roomTitle 차번+canonical', roomTitle(room, liveLookup, emptyLookup, [baseContract], baseContract) === '12가3456 기아 스포티지 노블레스');
const deletedLookup = buildProductLookup([{ ...product, _deleted: true }]);
check('A10 삭제상품 이름·상태 보존', roomModel(room, emptyLookup, deletedLookup, [], undefined) === '기아 스포티지 노블레스 (삭제)');
check('A11 차번만 있으면 차명으로 재사용하지 않음', roomModel({ car_number: '12가3456' }, emptyLookup, emptyLookup, [], undefined) === '차량명 미확인');
check('A12 복원 차량명 검색', filterChatRooms({
  rooms: [room], query: '기아 노블레스', filter: 'all', sort: '', role: 'admin',
  contractIndex: new Map(), cancelledIndex: new Map(),
  searchText: () => productVehicleLabel(product),
}).length === 1);

// B. 계약상태 — 미결 레거시를 임의 정규화하지 않고 눈에 띄게 표시
check('B1 상태 앞뒤 공백만 정리', normalizeContractStatus(' 계약철회 ') === '계약철회');
check('B2 canonical 상태 보존', normalizeContractStatus('계약완료') === '계약완료');
check('B3 null은 빈 값', normalizeContractStatus(null) === '');
const withdrawn: EntityRecord = { ...baseContract, contract_code: 'C-W', contract_status: '계약철회' };
check('B4 철회는 취소로 임의 판정하지 않음', !isContractCancelled(withdrawn));
check('B5 철회는 단순 문의가 아님', !isInquiryOnly(withdrawn));
check('B6 철회는 미결 활성 상태', isContractInProgress(withdrawn));
check('B7 철회 stage는 별도 적색 경고', contractStage(withdrawn).label === '계약철회' && contractStage(withdrawn).tone === 'red', contractStage(withdrawn));
check('B8 철회 tone 적색', contractTone('계약철회') === 'red');
check('B9 철회는 기본 진행 목록에 포함', filterContracts({ contracts: [withdrawn], query: '', filter: '진행', month: '', sort: '' }).length === 1);
check('B10 철회는 계약취소 필터에 미포함', filterContracts({ contracts: [withdrawn], query: '', filter: '계약취소', month: '', sort: '' }).length === 0);
check('B11 복원 계약차명 검색', filterContracts({
  contracts: [baseContract], query: '기아 스포티지', filter: '진행', month: '', sort: '',
  searchText: (contract) => contractVehicleLabel(contract),
}).length === 1);
const allChecksDone = Object.fromEntries(STEPS.flatMap((step) => step.checks.map((item) => [item.key, 'yes'])));
const transitionPending: EntityRecord = { ...baseContract, ...allChecksDone, contract_status: '계약요청' };
check('B12 5/5이나 raw 완료 전이면 완료 처리 대기', contractStage(transitionPending).label === '완료 처리 대기' && contractStage(transitionPending).tone === 'amber', contractStage(transitionPending));
check('B13 raw 계약완료는 녹색 완료', contractStage({ ...baseContract, contract_status: '계약완료' }).label === '계약완료' && contractStage({ ...baseContract, contract_status: '계약완료' }).tone === 'green');
const releaseRejected: EntityRecord = { ...baseContract, provider_delivery_response: '출고 불가' };
const docsRejected: EntityRecord = {
  ...baseContract, agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능',
  agent_docs_submitted: 'yes', provider_docs_review: '부결',
};
check('B14 출고 불가는 진행으로 오인하지 않고 적색', contractStage(releaseRejected).label === '출고 불가' && contractStage(releaseRejected).tone === 'red', contractStage(releaseRejected));
check('B15 서류 부결은 진행으로 오인하지 않고 적색', contractStage(docsRejected).label === '서류 부결' && contractStage(docsRejected).tone === 'red', contractStage(docsRejected));
check('B16 공백 포함 완료는 5/5 재처리 대상이 아님', !needsContractFinalization({
  ...baseContract, ...allChecksDone, contract_status: ' 계약완료 ',
}));
check('B17 5/5 raw 미완료는 재처리 대상', needsContractFinalization(transitionPending));
const inquiryStage: EntityRecord = { ...baseContract, contract_code: 'C-INQ' };
const docsStage: EntityRecord = {
  ...inquiryStage, contract_code: 'C-DOC',
  agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능',
};
const paymentStage: EntityRecord = {
  ...docsStage, contract_code: 'C-PAY',
  agent_docs_submitted: 'yes', provider_docs_review: '승인',
};
const agreementStage: EntityRecord = {
  ...paymentStage, contract_code: 'C-AGR',
  agent_balance_paid: 'yes', agent_final_paid: 'yes', provider_balance_confirmed: 'yes',
};
const releaseStage: EntityRecord = {
  ...agreementStage, contract_code: 'C-REL',
  provider_agreement_done: 'yes', provider_agreement_sent: 'yes',
};
const completedStage: EntityRecord = { ...releaseStage, contract_code: 'C-DONE', ...allChecksDone, contract_status: '계약완료' };
const cancelledStage: EntityRecord = { ...baseContract, contract_code: 'C-CANCEL', contract_status: '계약취소' };
const legacyWaiting: EntityRecord = { ...baseContract, contract_code: 'C-LEGACY', contract_status: '계약대기' };
const legacySent: EntityRecord = { ...baseContract, contract_code: 'C-LEGACY-SENT', contract_status: '계약발송' };
const missingStatus: EntityRecord = { ...baseContract, contract_code: 'C-MISSING-STATUS', contract_status: '' };
const workflowRows = [inquiryStage, docsStage, paymentStage, agreementStage, releaseStage, completedStage, cancelledStage];
const workflowCounts = ['계약문의', '서류', '입금', '약정', '출고', '계약완료', '계약취소'].map((filter) => (
  filterContracts({ contracts: workflowRows, query: '', filter: filter as Parameters<typeof filterContracts>[0]['filter'], month: '', sort: '' }).length
));
check('B18 화면 뱃지와 필터가 5단계·완료·취소를 같은 축으로 분류', workflowCounts.every((count) => count === 1), workflowCounts);
check('B19 철회·거부·5/5 전이실패·레거시·상태누락은 확인 필요', [
  withdrawn, releaseRejected, docsRejected, transitionPending, legacyWaiting, legacySent, missingStatus,
].every((contract) => contractWorkflowGroup(contract) === '확인 필요'));
check('B20 사장된 raw 계약요청·대기·발송 필터를 노출하지 않음', !CONTRACT_FILTER_OPTIONS.some((option) => (
  ['계약요청', '계약대기', '계약발송'].includes(option.label)
)));
const workflowSorted = filterContracts({
  contracts: [cancelledStage, completedStage, releaseStage, agreementStage, paymentStage, docsStage, inquiryStage, withdrawn],
  query: '', filter: 'all', month: '', sort: 'status',
}).map((contract) => String(contract.contract_code));
check('B21 단계순은 확인필요→문의→서류→입금→약정→출고→완료→취소', workflowSorted.join('|') === 'C-W|C-INQ|C-DOC|C-PAY|C-AGR|C-REL|C-DONE|C-CANCEL', workflowSorted);
const stableSameStage = filterContracts({
  contracts: [
    { ...inquiryStage, contract_code: 'C-00', contract_date: '2026-07-31' },
    { ...inquiryStage, contract_code: 'C-02', contract_date: '2026-08-02' },
    { ...inquiryStage, contract_code: 'C-01', contract_date: '2026-08-01' },
  ],
  query: '', filter: 'all', month: '', sort: 'status',
}).map((contract) => String(contract.contract_code));
check('B22 같은 단계는 최신 날짜 후 계약코드로 고정 정렬', stableSameStage.join('|') === 'C-02|C-01|C-00', stableSameStage);
check('B23 상태 없는 계약은 단순 문의로 오인하지 않음', !isInquiryOnly(missingStatus));
check('B24 상태 누락·레거시 대기·발송 행도 확인 필요 뱃지', [missingStatus, legacyWaiting, legacySent].every((contract) => (
  contractStage(contract).label === '상태 확인' && contractStage(contract).tone === 'red'
)));
check('B25 기본 취소 제외 목록에서 상태 누락을 숨기지 않음', filterContracts({
  contracts: [missingStatus], query: '', filter: '진행', month: '', sort: '',
}).length === 1);
check('B26 공백 포함 완료 helper 정규화', isContractCompleted({
  ...baseContract, contract_status: ' 계약완료 ',
}));

// C. 활성/취소 인덱스·레거시 조인·읽기 무부작용
const active: EntityRecord = { ...baseContract, contract_code: 'C-A', contract_status: '계약완료' };
const cancelled: EntityRecord = { ...baseContract, contract_code: 'C-X', contract_status: '계약취소' };
const activeIndex = buildContractIndex([active, cancelled], false);
const cancelledIndex = buildContractIndex([active, cancelled], true);
check('C1 active index는 활성 계약', contractForRoom(activeIndex, room)?.contract_code === 'C-A');
check('C2 cancelled index는 취소 계약', contractForRoom(cancelledIndex, room)?.contract_code === 'C-X');
check('C3 전체 행은 활성 상태', chatRowContract(room, 'all', activeIndex, cancelledIndex)?.contract_code === 'C-A');
check('C4 취소 행은 취소 이력', chatRowContract(room, '취소', activeIndex, cancelledIndex)?.contract_code === 'C-X');
check('C4b 전체에서도 명시 연결된 취소 계약을 문의로 오인하지 않음', chatRowContract(
  { ...room, linked_contract: 'C-X' }, 'all', activeIndex, cancelledIndex,
)?.contract_code === 'C-X');
check('C4c 연결 없는 문의를 과거 취소 계약으로 추정하지 않음', chatRowContract(
  room, 'all', new Map(), cancelledIndex,
) === undefined);
check('C5 취소 필터 실제 포함', filterChatRooms({ rooms: [room], query: '', filter: '취소', sort: '', role: 'admin', contractIndex: activeIndex, cancelledIndex }).length === 1);
const uidOnlyRoom: EntityRecord = { _key: 'legacy-room', product_uid: 'p1', agent_code: 'U0001' };
check('C6 product_uid 레거시 방도 계약 조인', contractForRoom(activeIndex, uidOnlyRoom)?.contract_code === 'C-A');
const conflictA: EntityRecord = { ...baseContract, contract_code: 'C-A', contract_status: '계약요청' };
const conflictB: EntityRecord = { ...baseContract, contract_code: 'C-B', contract_status: '계약요청' };
const conflictIndex = buildContractIndex([conflictA, conflictB], false);
check('C7 linked_contract가 동일 차량 fallback보다 우선', contractForRoom(conflictIndex, { ...room, linked_contract: 'C-B' })?.contract_code === 'C-B');
check('C7b 명시 연결이 현재 인덱스에 없으면 다른 계약으로 추정하지 않음', contractForRoom(
  conflictIndex, { ...room, linked_contract: 'C-MISSING' },
) === undefined);
check('C8 기존 방 찾기', findRoomForContract([room], active)?._key === room._key);
check('C8b 다른 계약에 명시 연결된 방을 동일 차량 fallback으로 재사용하지 않음', findRoomForContract([
  { ...room, linked_contract: 'C-B' },
], active) === undefined);
check('C9 일치 방이 없으면 생성 없이 undefined', findRoomForContract([room], { ...active, product_code: 'p9', agent_code: 'U9999', car_number_snapshot: '99가9999' }) === undefined);
const spacedComplete: EntityRecord = { ...active, contract_code: 'C-SP', contract_status: ' 계약완료 ' };
check('C10 공백 포함 완료도 chat 완료 필터에 포함', filterChatRooms({
  rooms: [room], query: '', filter: '완료', sort: '', role: 'admin',
  contractIndex: buildContractIndex([spacedComplete], false), cancelledIndex: new Map(),
}).length === 1);
const legacyProduct: EntityRecord = {
  ...product, _key: 'PC-CANON', product_code: 'PC-CANON', product_uid: 'EXT-LEGACY',
};
const legacyProductRoom: EntityRecord = { _key: 'legacy-product-room', product_uid: 'EXT-LEGACY', agent_code: 'U0001' };
const restoredLegacyProduct = productForRoom(buildProductLookup([legacyProduct]), legacyProductRoom);
check('C11 목록과 상세가 product_uid 레거시 매물을 같은 상품으로 복원', restoredLegacyProduct === legacyProduct);
check('C12 레거시 uid는 상세 get용 canonical product_code로 변환', String(restoredLegacyProduct?.product_code) === 'PC-CANON');

// D. 역할별 상대방과 내부 식별자 비노출
check('D1 영업자에게 공급사', joinMetaText(workPartyParts('agent', baseContract, { providerName: '웰릭스' })) === '웰릭스');
check('D2 공급사에게 담당자', joinMetaText(workPartyParts('provider', baseContract, { providerName: '웰릭스' })) === '김영업');
check('D3 공급사관리자에게 담당자', joinMetaText(workPartyParts('provider_admin', baseContract, { providerName: '웰릭스' })) === '김영업');
check('D4 영업관리자에게 공급사·담당자', joinMetaText(workPartyParts('agent_admin', baseContract, { providerName: '웰릭스' })) === '웰릭스 · 김영업');
check('D5 플랫폼관리자에게 공급사·담당자', joinMetaText(workPartyParts('admin', baseContract, { providerName: '웰릭스' })) === '웰릭스 · 김영업');
const opaque = 'AbCdEfGhIjKlMnOpQrStUvWxYz12';
check('D6 opaque UID 판정', isOpaqueIdentity(opaque));
check('D7 안전 업무코드 allow-list', ['U0001', 'AG102', 'RP013', 'agent_demo'].every(isSafeBusinessCode));
check('D8 임의 short UID는 업무코드 아님', !isSafeBusinessCode('short:uid'));
check('D9 opaque UID 비노출', workPartyParts('provider', { agent_code: opaque })[0] === '담당자 미확인');
check('D10 short UID 비노출', workPartyParts('provider', { agent_uid: 'short:uid', agent_code: 'short:uid' })[0] === '담당자 미확인');
check('D11 마지막 발신자를 계약 담당자로 오인하지 않음', workPartyParts('provider', { last_sender_name: '채팅응대자' })[0] === '담당자 미확인');
check('D12 실제 담당자 snapshot fallback', workPartyParts('provider', { agent_code: opaque }, { agentFallback: { agent_name: '이담당' } })[0] === '이담당');
check('D13 공급사 코드보다 실제 이름 우선', workPartyParts('agent', {
  provider_company_code: 'RP013', provider_name: '웰릭스',
}, { providerName: 'RP013' })[0] === '웰릭스');
check('D14 opaque 공급사 식별자 비노출', workPartyParts('agent', { provider_company_code: opaque })[0] === '공급사 미확인');
check('D15 채팅코드에서 unsafe agent 제거', chatCodeOf({ car_number: '12가3456', agent_code: opaque }) === 'CH-12가3456');
check('D16 UID를 그대로 복사한 업무코드 fallback 비노출', workPartyParts('provider', {
  agent_uid: 'usr_private', agent_code: 'usr_private',
})[0] === '담당자 미확인');
check('D17 채팅코드에서도 UID 복사값 비노출', chatCodeOf({
  car_number: '12가3456', agent_uid: 'usr_private', agent_code: 'usr_private',
}) === 'CH-12가3456');
check('D18 채팅 발신자는 내부코드보다 실제 이름 우선', chatDisplayName('provider', '제일오토렌탈', 'sup_jeil') === '제일오토렌탈');
check('D19 이름 없는 이관 메시지는 내부코드 대신 역할명', chatDisplayName('provider', '', 'sup_jeil') === '공급사');

// E. 검색 — 보이는 업무정보만, 여러 토큰은 AND
check('E1 raw+복원 표시값을 합쳐 다중토큰 AND', filterContracts({
  contracts: [baseContract], query: 'C-1 웰릭스', filter: 'all', month: '', sort: '',
  searchText: () => '웰릭스',
}).length === 1);
const piiContract: EntityRecord = { ...baseContract, customer_birth: '900101', sign_token: 'secret-sign-token' };
check('E2 생년월일은 목록 검색 인덱스에서 제외', !matchHay(contractHaystack(piiContract), '900101'));
check('E3 서명토큰은 목록 검색 인덱스에서 제외', !matchHay(contractHaystack(piiContract), 'secret-sign-token'));
check('E4 명시된 전화번호 검색은 유지', matchHay(contractHaystack(baseContract), '010-1234'));
check('E5 room agent_uid는 검색 인덱스에서 제외', !matchHay(roomHaystack({ ...room, agent_uid: opaque }), opaque));
check('E6 비표시 마지막 발신자명은 검색 인덱스에서 제외', !matchHay(roomHaystack({ ...room, last_sender_name: '숨은응대자' }), '숨은응대자'));
check('E7 비표시 채널코드는 검색 인덱스에서 제외', !matchHay(roomHaystack({ ...room, agent_channel_code: 'CH999' }), 'CH999'));
check('E8 비표시 사업자번호는 검색 인덱스에서 제외', !matchHay(contractHaystack({ ...baseContract, customer_business_number: '123-45-67890' }), '123-45-67890'));
check('E9 파생 상태도 보이는 문자열로 검색', filterContracts({
  contracts: [transitionPending], query: '완료 처리 대기', filter: 'all', month: '', sort: '',
  searchText: (contract) => contractStage(contract).label,
}).length === 1);
check('E10 화면에 숨긴 raw 상태는 일반 검색에 노출하지 않음', filterContracts({
  contracts: [transitionPending], query: '계약요청', filter: 'all', month: '', sort: '',
  searchText: (contract) => contractStage(contract).label,
}).length === 0);

// F. 구분자·선택 정합
check('F1 빈 메타 제거', compactTextParts([null, false, '', '   ']).length === 0);
check('F2 단일값에는 점 없음', joinMetaText(['A']) === 'A');
check('F3 복수값 사이에만 점', joinMetaText(['A', '', ' B ']) === 'A · B');
check('F4 고아 구분자 없음', !/^·|·$|·\s*·/.test(joinMetaText(['', 'A', null, 'B', ''])));
check('F5 보이는 선택 유지', retainVisibleSelection('C-A', ['C-A', 'C-B']) === 'C-A');
check('F6 숨긴 선택 해제', retainVisibleSelection('C-W', ['C-A']) === null);
check('F7 빈 선택 멱등', retainVisibleSelection(null, []) === null);

// G. 계약 변경 부분 성공 — 후속 엔진 실패여도 저장된 최신 상태 재조회·전역 알림
let partialPersisted = false;
let partialReloaded = false;
let partialNotified = 0;
let partialError = '';
try {
  await runContractMutation(
    async () => { partialPersisted = true; throw new Error('후속 전이 실패'); },
    async () => { partialReloaded = partialPersisted; },
    () => { partialNotified++; },
  );
} catch (error) {
  partialError = String((error as Error).message || error);
}
check('G1 부분 성공 후 오류를 호출자에게 유지', partialError === '후속 전이 실패');
check('G2 부분 성공 후 최신 상태 재조회', partialReloaded);
check('G3 부분 성공 후 메뉴·목록 알림', partialNotified === 1);

let reloadFailureNotified = 0;
let reloadFailure = '';
try {
  await runContractMutation(
    async () => undefined,
    async () => { throw new Error('재조회 실패'); },
    () => { reloadFailureNotified++; },
  );
} catch (error) {
  reloadFailure = String((error as Error).message || error);
}
check('G4 재조회 자체가 실패해도 전역 알림', reloadFailureNotified === 1);
check('G5 성공한 변경 뒤 재조회 실패도 숨기지 않음', reloadFailure === '재조회 실패');

let originalFailure = '';
try {
  await runContractMutation(
    async () => { throw new Error('원 전이 실패'); },
    async () => undefined,
    () => { throw new Error('알림 실패'); },
  );
} catch (error) {
  originalFailure = String((error as Error).message || error);
}
check('G6 알림 실패가 원래 엔진 오류를 가리지 않음', originalFailure === '원 전이 실패');

const failed = cases.filter((item) => !item.ok);
console.log(`\n${cases.length - failed.length}/${cases.length} PASS`);
if (failed.length) {
  console.error(`FAIL ${failed.length}: ${failed.map((item) => item.name).join(', ')}`);
  process.exit(1);
}
