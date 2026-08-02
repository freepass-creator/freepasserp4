import type { EntityRecord } from '@/lib/intake/entities';
import type { Role } from '@/lib/domain/deal';
import { isInquiryOnly, normalizeContractStatus } from '@/lib/domain/contract';
import { unreadFor } from '@/lib/domain/messaging';
import { matchHay, roomHaystack } from '@/lib/domain/search';
import { contractForRoom } from './room-display';

export type ChatSort = 'unread' | 'name';
export type ChatFilter = '미확인' | '문의' | 'all' | '완료' | '취소';

export const CHAT_SORTS: { value: ChatSort; label: string }[] = [
  { value: 'unread', label: '안읽음' },
  { value: 'name', label: '차명순' },
];

/** 기본 = erp3 workspace와 동일하게 전체(계약상태 필터 없음). */
export const CHAT_FILTER_DEFAULT: ChatFilter = 'all';

export const CHAT_FILTERS: { key: ChatFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: '미확인', label: '미확인' },
  { key: '문의', label: '문의' },
  { key: '완료', label: '완료' },
  { key: '취소', label: '취소' },
];

/**
 * erp3 workspace 목록 가시성 — `!_deleted && !is_admin_chat && !hidden_for_*`.
 * 관리자 소통방(ADMIN_* / is_admin_chat)은 별도 화면 전용이라 계약문의 목록에서 제외.
 * v4에서 새로 만든 방도 같은 규칙으로 통과(erp3에 없는 키는 erp4에만 노출).
 */
export function isWorkspaceChatRoom(room: EntityRecord, role: Role): boolean {
  if (room.is_admin_chat || String(room._key || '').startsWith('ADMIN_')) return false;
  if (role === 'admin' && room.hidden_for_admin) return false;
  if (role === 'provider' && room.hidden_for_provider) return false;
  if (role === 'agent' && room.hidden_for_agent) return false;
  return true;
}

type Params = {
  rooms: EntityRecord[];
  query: string;
  filter: ChatFilter;
  sort: ChatSort | '';
  role: Role;
  contractIndex: Map<string, EntityRecord>;
  cancelledIndex: Map<string, EntityRecord>;
  /** 화면에 복원된 차량명·상대방도 보이는 그대로 검색한다. */
  searchText?: (room: EntityRecord) => string;
  /** 차명순 역시 화면의 canonical 차량명을 기준으로 한다. */
  nameOf?: (room: EntityRecord) => string;
};

/** 취소 필터는 취소 이력을, 전체는 활성 우선 후 명시 연결된 취소 이력을 행 상태로 표시한다. */
export function chatRowContract(
  room: EntityRecord,
  filter: ChatFilter,
  contractIndex: Map<string, EntityRecord>,
  cancelledIndex: Map<string, EntityRecord>,
): EntityRecord | undefined {
  if (filter === '취소') return contractForRoom(cancelledIndex, room);
  const active = contractForRoom(contractIndex, room);
  // 전체 목록에서도 명시 연결된 취소 계약을 단순 문의로 오인하지 않는다.
  // 진행/문의/완료 필터에서는 기존처럼 취소 계약을 섞지 않는다.
  const explicitlyLinked = !!String(room.linked_contract || '').trim();
  return active || (filter === 'all' && explicitlyLinked ? contractForRoom(cancelledIndex, room) : undefined);
}

function matchesFilter(room: EntityRecord, params: Params): boolean {
  if (params.filter === 'all') return true;
  if (params.filter === '취소') return !!contractForRoom(params.cancelledIndex, room);
  const contract = chatRowContract(room, params.filter, params.contractIndex, params.cancelledIndex);
  if (params.filter === '완료') return normalizeContractStatus(contract?.contract_status) === '계약완료';
  if (params.filter === '미확인') return isInquiryOnly(contract) && unreadFor(room, params.role) > 0;
  return params.filter !== '문의' || isInquiryOnly(contract);
}

export function filterChatRooms(params: Params): EntityRecord[] {
  return params.rooms
    .filter((room) => matchHay(
      [roomHaystack(room), params.searchText?.(room) || ''].filter(Boolean).join(' '),
      params.query,
    ))
    .filter((room) => matchesFilter(room, params))
    .slice()
    .sort((a, b) => {
      if (!params.sort) return 0;
      if (params.sort === 'unread') {
        return unreadFor(b, params.role) - unreadFor(a, params.role)
          || Number(b.last_message_at || 0) - Number(a.last_message_at || 0);
      }
      return String(params.nameOf?.(a) || a.vehicle_name || '')
        .localeCompare(String(params.nameOf?.(b) || b.vehicle_name || ''), 'ko');
    });
}

export function chatRoomPreviewCount(params: Omit<Params, 'sort'>): number {
  return params.rooms
    .filter((room) => matchHay(
      [roomHaystack(room), params.searchText?.(room) || ''].filter(Boolean).join(' '),
      params.query,
    ))
    .filter((room) => matchesFilter(room, { ...params, sort: '' }))
    .length;
}
