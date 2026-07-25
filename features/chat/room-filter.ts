import type { EntityRecord } from '@/lib/intake/entities';
import type { Role } from '@/lib/domain/deal';
import { isInquiryOnly } from '@/lib/domain/contract';
import { unreadFor } from '@/lib/domain/messaging';
import { matchRoomQuery } from '@/lib/domain/search';
import { contractForRoom } from './room-display';

export type ChatSort = 'unread' | 'name';
export type ChatFilter = '미확인' | '문의' | 'all' | '완료' | '취소';

export const CHAT_SORTS: { value: ChatSort; label: string }[] = [
  { value: 'unread', label: '안읽음' },
  { value: 'name', label: '차명순' },
];

export const CHAT_FILTERS: { key: ChatFilter; label: string }[] = [
  { key: '미확인', label: '미확인' },
  { key: '문의', label: '문의' },
  { key: 'all', label: '전체' },
  { key: '완료', label: '완료' },
  { key: '취소', label: '취소' },
];

type Params = {
  rooms: EntityRecord[];
  query: string;
  filter: ChatFilter;
  sort: ChatSort | '';
  role: Role;
  contractIndex: Map<string, EntityRecord>;
  cancelledIndex: Map<string, EntityRecord>;
};

function matchesFilter(room: EntityRecord, params: Params): boolean {
  if (params.filter === 'all') return true;
  if (params.filter === '취소') return !!contractForRoom(params.cancelledIndex, room);
  const contract = contractForRoom(params.contractIndex, room);
  if (params.filter === '완료') return String(contract?.contract_status || '') === '계약완료';
  if (params.filter === '미확인') return isInquiryOnly(contract) && unreadFor(room, params.role) > 0;
  return params.filter !== '문의' || isInquiryOnly(contract);
}

export function filterChatRooms(params: Params): EntityRecord[] {
  return params.rooms
    .filter((room) => matchRoomQuery(room, params.query))
    .filter((room) => matchesFilter(room, params))
    .slice()
    .sort((a, b) => {
      if (!params.sort) return 0;
      if (params.sort === 'unread') {
        return unreadFor(b, params.role) - unreadFor(a, params.role)
          || Number(b.last_message_at || 0) - Number(a.last_message_at || 0);
      }
      return String(a.vehicle_name || '').localeCompare(String(b.vehicle_name || ''), 'ko');
    });
}

export function chatRoomPreviewCount(params: Omit<Params, 'sort'>): number {
  return params.rooms
    .filter((room) => matchRoomQuery(room, params.query))
    .filter((room) => matchesFilter(room, { ...params, sort: '' }))
    .length;
}
