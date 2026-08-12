import { replyAttentionFor, unreadFor } from '../lib/domain/messaging';
import {
  activeChatRooms,
  chatFilterDefaultFor,
  chatRoomPreviewCount,
  chatSortDefaultFor,
  filterChatRooms,
  requestedChatRoom,
  retainChatSelection,
} from '../features/chat/room-filter';
import type { EntityRecord } from '../lib/intake/entities';
import { hasRoomStoredActivity } from '../lib/domain/room-activity';
import { productRoomKey } from '../lib/domain/deal';

let failed = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}

const now = Date.now();
const unread: EntityRecord = {
  _key: 'unread', last_sender_role: 'agent', last_message_at: now - 100,
  unread_for_admin: 2, last_read_at_admin: now - 200,
};
const unreplied: EntityRecord = {
  _key: 'unreplied', last_sender_role: 'agent', last_message_at: now - 200,
  unread_for_admin: 0, last_read_at_admin: now - 100,
};
const replied: EntityRecord = {
  _key: 'replied', last_sender_role: 'admin', last_message_at: now - 300,
  unread_for_admin: 0, last_read_at_admin: now - 300,
};
const empty: EntityRecord = {
  _key: 'empty', product_code: 'P-EMPTY', last_message: '', last_message_at: 0,
};

check('미확인은 저장 숫자뱃지를 유지', unreadFor(unread, 'admin') === 2);
check('미확인 상태 판정', replyAttentionFor(unread, 'admin') === 'unread');
check('읽고 답하지 않은 문의는 미회신', replyAttentionFor(unreplied, 'admin') === 'unreplied');
check('관리자가 마지막 답변자면 정상', replyAttentionFor(replied, 'admin') === 'none');
check('관리자 기본 필터는 전체', chatFilterDefaultFor('admin') === 'all');
check('관리자 기본 정렬은 최근순', chatSortDefaultFor('admin') === 'recent');
check('영업자 기본 필터·정렬은 전체·최근순', chatFilterDefaultFor('agent') === 'all' && chatSortDefaultFor('agent') === 'recent');
check('빈 방 셸은 문의 활동이 아님', !hasRoomStoredActivity(empty));
check('계약 연결 방은 메시지 전에도 문의 활동', hasRoomStoredActivity({ ...empty, linked_contract: 'TMP-1' }));
check('방 결정키는 매물×영업자 조합', productRoomKey('P-1', 'A-1') === 'CH_P-1_A-1');
check('식별자 누락 시 고아 방 키를 만들지 않음', productRoomKey('', 'A-1') === '' && productRoomKey('P-1', '') === '');

const base = {
  rooms: [empty, replied, unread, unreplied], query: '', role: 'admin' as const,
  contractIndex: new Map<string, EntityRecord>(),
  cancelledIndex: new Map<string, EntityRecord>(),
};
const recent = filterChatRooms({ ...base, filter: 'all', sort: 'recent' });
check('최근 메시지 순 정렬', recent.map((r) => r._key).join(',') === 'unread,unreplied,replied');
const pending = filterChatRooms({ ...base, filter: '미회신', sort: 'recent' });
check('미회신 필터는 읽고 답하지 않은 방만 표시', pending.length === 1 && pending[0]._key === 'unreplied');
check('빈 방 셸은 일반 문의 목록에서 제외', !recent.some((room) => room._key === 'empty'));
check('빈 방도 명시적 딥링크로는 열 수 있음', requestedChatRoom(base.rooms, 'empty')?._key === 'empty');
check('전체 숫자도 활동 방만 집계', activeChatRooms(base.rooms, base.contractIndex, base.cancelledIndex).length === 3);
check('필터 미리보기 숫자도 빈 방 제외', chatRoomPreviewCount({ ...base, filter: 'all' }) === 3);
check('딥링크 빈 방 선택은 첫 메시지 전까지 유지', retainChatSelection(base.rooms, 'empty', recent.map((room) => String(room._key)), 'empty') === 'empty');
check('일반 빈 방 선택은 목록에 없으면 닫음', retainChatSelection(base.rooms, 'empty', [], null) === null);

if (failed) process.exit(1);
