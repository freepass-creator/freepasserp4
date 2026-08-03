import type { EntityRecord } from '../lib/intake/entities';
import {
  collapseDuplicateEmptyRooms,
  duplicateEmptyRoomFamilies,
  verifyDuplicateRoomMessages,
  type RoomMessageState,
} from '../features/chat/room-dedupe';
import { roomsWithUnread } from '../lib/domain/messaging';

const cases: { name: string; ok: boolean; detail?: unknown }[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  cases.push({ name, ok, detail });
}

const base: EntityRecord = {
  _key: '-legacy-a',
  product_code: 'P1',
  product_uid: 'EXT1',
  agent_uid: 'UID1',
  agent_code: 'A1',
  agent_channel_code: 'CHANNEL1',
  provider_company_code: 'PROVIDER1',
  linked_contract: '',
  last_message: '',
  last_message_at: 0,
  unread_for_agent: 0,
  unread_for_provider: 0,
  unread_for_admin: 0,
};

const emptyEvidence = {
  messageState: new Map<string, RoomMessageState>([
    ['-legacy-a', 'empty'],
    ['-legacy-b', 'empty'],
  ]),
  contractOf: () => undefined,
};
const collapse = (
  rooms: EntityRecord[],
  messages: EntityRecord[] | null = [],
  contractOf: (room: EntityRecord) => EntityRecord | undefined = () => undefined,
) => {
  const withMessages = new Set((messages || []).map((message) => String(message.room_id || '')));
  const messageState = new Map<string, RoomMessageState>();
  for (const room of rooms) {
    const key = String(room._key || '');
    messageState.set(key, messages === null ? 'unknown' : withMessages.has(key) ? 'present' : 'empty');
  }
  return collapseDuplicateEmptyRooms(rooms, { messageState, contractOf });
};

const actualLike = Array.from({ length: 11 }, (_, index) => ({
  ...base,
  _key: `-actual-${String(index).padStart(2, '0')}`,
}));
check('D1 실데이터형 동일 빈 shell 11개는 표시 1개', collapse(actualLike).length === 1);

const canonical = { ...base, _key: 'CH_P1_A1' };
const preferred = collapse([{ ...base, _key: '-legacy-b' }, canonical, base]);
check('D2 현재 deterministic key가 있으면 표시 대표로 유지',
  preferred.length === 1 && preferred[0]._key === 'CH_P1_A1', preferred);

const messageRooms = [base, { ...base, _key: '-legacy-b' }];
check('D3 한 방에 실제 메시지가 하나라도 있으면 family 전부 보존', collapse(messageRooms, [{
  _key: 'M1', room_id: '-legacy-b', text: 'hello',
}]).length === 2);
check('D4 메시지 조회 실패(null)는 fail-closed로 전부 보존', collapse(messageRooms, null).length === 2);

check('D5 linked_contract 하나라도 있으면 family 전부 보존', collapse([
  base, { ...base, _key: '-legacy-b', linked_contract: 'C1' },
]).length === 2);
check('D6 fallback으로 찾은 계약 하나라도 있으면 family 전부 보존', collapse(
  messageRooms,
  [],
  (room) => room._key === '-legacy-b' ? { contract_code: 'C-LEGACY' } : undefined,
).length === 2);
check('D7 contract_code 메타가 하나라도 있으면 family 전부 보존', collapse([
  base, { ...base, _key: '-legacy-b', contract_code: 'C1' },
]).length === 2);

check('D8 unread 하나라도 있으면 family 전부 보존', collapse([
  base, { ...base, _key: '-legacy-b', unread_for_provider: 1 },
]).length === 2);
check('D9 legacy unread 변형도 0이 아니면 family 전부 보존', collapse([
  base, { ...base, _key: '-legacy-b', unread_legacy: 'yes' },
]).length === 2);
check('D10 last_message 하나라도 있으면 family 전부 보존', collapse([
  base, { ...base, _key: '-legacy-b', last_message: '상담 내용' },
]).length === 2);
check('D11 last_message_at 하나라도 있으면 family 전부 보존', collapse([
  base, { ...base, _key: '-legacy-b', last_message_at: 100 },
]).length === 2);
check('D12 last_sender 메타 하나라도 있으면 family 전부 보존', collapse([
  base, { ...base, _key: '-legacy-b', last_sender_uid: 'UID2' },
]).length === 2);

for (const [name, patch] of [
  ['상품', { product_code: 'P2' }],
  ['상품UID', { product_uid: 'EXT2' }],
  ['영업자', { agent_uid: 'UID2' }],
  ['영업자코드', { agent_code: 'A2' }],
  ['공급사', { provider_company_code: 'PROVIDER2' }],
  ['채널', { agent_channel_code: 'CHANNEL2' }],
] as const) {
  check(`D13 ${name}이 다르면 두 방 모두 보존`, collapse([
    base, { ...base, ...patch, _key: `-different-${name}` },
  ]).length === 2);
}

check('D14 소유 identity가 하나라도 결손이면 추정 병합하지 않음', collapse([
  { ...base, provider_company_code: '' },
  { ...base, _key: '-legacy-b', provider_company_code: '' },
]).length === 2);
check('D15 관리자 상담방은 중복처럼 보여도 보존', collapse([
  { ...base, is_admin_chat: true },
  { ...base, _key: '-legacy-b', is_admin_chat: true },
]).length === 2);

const mutationInput = [base, { ...base, _key: '-legacy-b' }];
const mutationBefore = JSON.stringify(mutationInput);
const mutationOutput = collapseDuplicateEmptyRooms(mutationInput, emptyEvidence);
check('D16 순수 표시 resolver는 입력 레코드를 변경하지 않음',
  JSON.stringify(mutationInput) === mutationBefore && mutationOutput !== mutationInput);

const unrelated: EntityRecord = {
  ...base, _key: '-unrelated', product_code: 'P-OTHER', product_uid: 'EXT-OTHER',
};
const candidateRooms = [base, { ...base, _key: '-legacy-b' }, unrelated];
const candidateFamilies = duplicateEmptyRoomFamilies(candidateRooms, { contractOf: () => undefined });
const scopedCalls: string[] = [];
let unexpectedFullReads = 0;
const scopedState = await verifyDuplicateRoomMessages(candidateFamilies, {
  listForRoom: async (roomId) => { scopedCalls.push(roomId); return []; },
  listAll: async () => { unexpectedFullReads++; return []; },
});
check('D17 scoped 검증은 strong-identity 중복 후보 id만 조회',
  scopedCalls.length === 2
  && scopedCalls.includes('-legacy-a')
  && scopedCalls.includes('-legacy-b')
  && !scopedCalls.includes('-unrelated')
  && unexpectedFullReads === 0,
scopedCalls);
check('D18 후보 scoped 검증 성공 시 빈 family만 접음', collapseDuplicateEmptyRooms(
  candidateRooms, { messageState: scopedState, contractOf: () => undefined },
).length === 2);

const failedState = await verifyDuplicateRoomMessages(candidateFamilies, {
  listForRoom: async (roomId) => {
    if (roomId === '-legacy-b') throw new Error('denied');
    return [];
  },
  listAll: async () => [],
});
check('D19 후보 한 방이라도 scoped 조회 실패면 family 전부 보존', collapseDuplicateEmptyRooms(
  candidateRooms, { messageState: failedState, contractOf: () => undefined },
).length === 3);

let noCandidateReads = 0;
await verifyDuplicateRoomMessages([], {
  listForRoom: async () => { noCandidateReads++; return []; },
  listAll: async () => { noCandidateReads++; return []; },
});
check('D20 중복 후보가 없으면 메시지 조회 0회', noCandidateReads === 0);

let fallbackReads = 0;
const fallbackState = await verifyDuplicateRoomMessages(candidateFamilies, {
  listAll: async () => {
    fallbackReads++;
    return [{ _key: 'M-FALLBACK', room_id: '-legacy-b' }];
  },
});
check('D21 scoped API 없는 fallback은 전량조회 정확히 1회', fallbackReads === 1);
check('D22 fallback 메시지 하나라도 있으면 family 전부 보존', collapseDuplicateEmptyRooms(
  candidateRooms, { messageState: fallbackState, contractOf: () => undefined },
).length === 3);

let failedFallbackReads = 0;
const failedFallbackState = await verifyDuplicateRoomMessages(candidateFamilies, {
  listAll: async () => { failedFallbackReads++; throw new Error('offline'); },
});
check('D23 fallback 전량조회 실패도 unknown으로 family 전부 보존',
  failedFallbackReads === 1 && collapseDuplicateEmptyRooms(
    candidateRooms, { messageState: failedFallbackState, contractOf: () => undefined },
  ).length === 3);

const unreadRooms: EntityRecord[] = [
  { _key: 'NO_READ', unread_for_admin: 7, last_read_at_admin: 0 },
  { _key: 'SCAN_OK', unread_for_admin: 9, last_read_at_admin: 100, last_message_at: 200 },
  { _key: 'SCAN_FAIL', unread_for_admin: 4, last_read_at_admin: 100, last_message_at: 200 },
  { _key: 'READ_CURRENT', unread_for_admin: 8, last_read_at_admin: 300, last_message_at: 200 },
  { _key: 'READ_LEGACY', unread_for_admin: 5, last_read_at_admin: 300 },
  { _key: 'SUMMARY_ZERO', unread_for_admin: 0, last_read_at_admin: 100, last_message_at: 200, last_sender_role: 'admin' },
];
const unreadScopedCalls: string[] = [];
let unreadUnexpectedFullReads = 0;
const scopedUnread = await roomsWithUnread(unreadRooms, 'admin', {
  list: async () => { unreadUnexpectedFullReads++; return []; },
  listMessagesForRoom: async (_companyId, roomId) => {
    unreadScopedCalls.push(roomId);
    if (roomId === 'SCAN_FAIL') throw new Error('denied');
    return [
      { _key: 'M-NEW', room_id: roomId, sender_uid: 'other', sender_role: 'agent', created_at: 200 },
      { _key: 'M-OLD', room_id: roomId, sender_uid: 'other', sender_role: 'agent', created_at: 50 },
    ];
  },
});
check('D24 unread 보정도 last_read>0 방만 scoped 조회',
  unreadScopedCalls.length === 2
  && unreadScopedCalls.includes('SCAN_OK')
  && unreadScopedCalls.includes('SCAN_FAIL')
  && !unreadScopedCalls.includes('NO_READ')
  && unreadUnexpectedFullReads === 0,
unreadScopedCalls);
check('D25 scoped unread 성공 방만 실제 메시지 수로 보정',
  Number(scopedUnread.find((room) => room._key === 'SCAN_OK')?.unread_for_admin) === 1);
check('D26 scoped unread 실패 방은 저장 카운터 유지',
  Number(scopedUnread.find((room) => room._key === 'SCAN_FAIL')?.unread_for_admin) === 4);
check('D27 last_read 없는 방은 조회 없이 저장 카운터 유지',
  Number(scopedUnread.find((room) => room._key === 'NO_READ')?.unread_for_admin) === 7);
check('D28 last_read>=last_message_at 방은 조회 없이 0 확정',
  !unreadScopedCalls.includes('READ_CURRENT')
  && Number(scopedUnread.find((room) => room._key === 'READ_CURRENT')?.unread_for_admin) === 0);
check('D29 last_message_at 없는 legacy 방은 조회 없이 저장 카운터 유지',
  !unreadScopedCalls.includes('READ_LEGACY')
  && Number(scopedUnread.find((room) => room._key === 'READ_LEGACY')?.unread_for_admin) === 5);
check('D30 요약상 미확인 0인 방은 scoped 조회를 생략',
  !unreadScopedCalls.includes('SUMMARY_ZERO')
  && Number(scopedUnread.find((room) => room._key === 'SUMMARY_ZERO')?.unread_for_admin) === 0);

let unreadFallbackReads = 0;
const fallbackUnread = await roomsWithUnread(unreadRooms, 'admin', {
  list: async () => {
    unreadFallbackReads++;
    return [{
      _key: 'M-FULL', room_id: 'SCAN_OK', sender_uid: 'other', sender_role: 'agent', created_at: 200,
    }];
  },
});
check('D31 unread scoped API 없는 adapter만 전량조회 1회', unreadFallbackReads === 1);
check('D32 fallback 성공에서 메시지 없는 미확인 가능 방은 0으로 보정',
  Number(fallbackUnread.find((room) => room._key === 'SCAN_FAIL')?.unread_for_admin) === 0);

const failed = cases.filter((item) => !item.ok);
for (const item of cases) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.ok || item.detail === undefined ? '' : ` :: ${JSON.stringify(item.detail)}`}`);
}
console.log(`\n${cases.length - failed.length}/${cases.length} passed`);
if (failed.length) process.exit(1);
