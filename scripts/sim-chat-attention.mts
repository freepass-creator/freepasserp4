import { replyAttentionFor, unreadFor } from '../lib/domain/messaging';
import { chatFilterDefaultFor, chatSortDefaultFor, filterChatRooms } from '../features/chat/room-filter';
import type { EntityRecord } from '../lib/intake/entities';

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

check('미확인은 저장 숫자뱃지를 유지', unreadFor(unread, 'admin') === 2);
check('미확인 상태 판정', replyAttentionFor(unread, 'admin') === 'unread');
check('읽고 답하지 않은 문의는 미회신', replyAttentionFor(unreplied, 'admin') === 'unreplied');
check('관리자가 마지막 답변자면 정상', replyAttentionFor(replied, 'admin') === 'none');
check('관리자 기본 필터는 전체', chatFilterDefaultFor('admin') === 'all');
check('관리자 기본 정렬은 최근순', chatSortDefaultFor('admin') === 'recent');
check('영업자 기본 필터·정렬은 전체·최근순', chatFilterDefaultFor('agent') === 'all' && chatSortDefaultFor('agent') === 'recent');

const base = {
  rooms: [replied, unread, unreplied], query: '', role: 'admin' as const,
  contractIndex: new Map<string, EntityRecord>(),
  cancelledIndex: new Map<string, EntityRecord>(),
};
const recent = filterChatRooms({ ...base, filter: 'all', sort: 'recent' });
check('최근 메시지 순 정렬', recent.map((r) => r._key).join(',') === 'unread,unreplied,replied');
const pending = filterChatRooms({ ...base, filter: '미회신', sort: 'recent' });
check('미회신 필터는 읽고 답하지 않은 방만 표시', pending.length === 1 && pending[0]._key === 'unreplied');

if (failed) process.exit(1);
