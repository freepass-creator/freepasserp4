import type { EntityRecord } from '@/lib/intake/entities';
import type { Role } from '@/lib/domain/deal';
import { isContractCancelled, isInquiryOnly, normalizeContractStatus } from '@/lib/domain/contract';
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

/** 일반 진입은 목록만 연다. 명시적인 `?room=` 딥링크가 있을 때만 해당 방을 선택한다. */
export function requestedChatRoom(
  rooms: EntityRecord[],
  requestedRoom: string | null | undefined,
): EntityRecord | undefined {
  const key = String(requestedRoom || '').trim();
  return key ? rooms.find((room) => String(room._key) === key) : undefined;
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

/** 행 상태는 필터와 무관하게 고정한다. 활성 계약 우선, 없으면 취소 이력을 fallback한다. */
export function chatRowContract(
  room: EntityRecord,
  _filter: ChatFilter,
  contractIndex: Map<string, EntityRecord>,
  cancelledIndex: Map<string, EntityRecord>,
): EntityRecord | undefined {
  const active = contractForRoom(contractIndex, room);
  // 명시 linked_contract는 contractForRoom이 fallback 추정보다 우선한다. 링크가 없을 때만
  // 현재 활성 계약을 먼저 쓰고, 활성 계약이 전혀 없으면 가장 최신 취소 이력을 한 번만 쓴다.
  return active || contractForRoom(cancelledIndex, room);
}

function matchesFilter(room: EntityRecord, params: Params): boolean {
  if (params.filter === 'all') return true;
  const contract = chatRowContract(room, params.filter, params.contractIndex, params.cancelledIndex);
  if (params.filter === '취소') return isContractCancelled(contract);
  if (params.filter === '완료') return normalizeContractStatus(contract?.contract_status) === '계약완료';
  // 취소 이력은 전용 탭에만 둔다. 새 문의로 재개하려면 새 방/새 연결을 만들어 lifecycle을 분리해야 한다.
  if (normalizeContractStatus(contract?.contract_status) === '계약취소') return false;
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
