import type { EntityRecord } from '@/lib/intake/entities';
import type { Role } from '@/lib/domain/deal';
import { isContractCancelled, isInquiryOnly, normalizeContractStatus } from '@/lib/domain/contract';
import { replyAttentionFor, unreadFor } from '@/lib/domain/messaging';
import { matchHay, roomHaystack } from '@/lib/domain/search';
import { contractForRoom } from './room-display';
import { deskItemOf } from './admin-queue';
import { hasRoomStoredActivity } from '@/lib/domain/room-activity';

export type ChatSort = 'recent' | 'unread' | 'name' | 'wait';
export type ChatFilter = '미확인' | '미회신' | '문의' | 'all' | '완료' | '취소' | '내차례';

export const CHAT_SORTS: { value: ChatSort; label: string }[] = [
  { value: 'recent', label: '최근순' },
  { value: 'wait', label: '오래 기다린 순' },
  { value: 'unread', label: '안읽음' },
  { value: 'name', label: '차명순' },
];

/** 기본 = erp3 workspace와 동일하게 전체(계약상태 필터 없음). */
export const CHAT_FILTER_DEFAULT: ChatFilter = 'all';

export const CHAT_FILTERS: { key: ChatFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: '미확인', label: '미확인' },
  { key: '미회신', label: '미회신' },
  { key: '문의', label: '문의' },
  { key: '완료', label: '완료' },
  { key: '취소', label: '취소' },
];

/**
 * 같은 화면이 역할마다 다른 얼굴을 갖는다 — 관리자에게 계약문의는 **응대 대기함**이다.
 *
 * 공급사가 앱에 안 들어오므로 계약의 공급 몫은 운영자가 처리한다.
 * 그래서 관리자에게 필요한 첫 화면은 «내 차례»(내가 눌러야 넘어가는 건)다.
 * 안읽음(말이 왔나)과는 다른 축이라 필터를 따로 둔다 — 섞으면 둘 다 못 쓴다.
 */
export function chatFiltersFor(role: Role): { key: ChatFilter; label: string }[] {
  return role === 'admin'
    ? [{ key: '내차례' as ChatFilter, label: '내 차례' }, ...CHAT_FILTERS]
    : CHAT_FILTERS;
}

/** 역할과 무관하게 목록은 전체에서 시작한다. 필요한 큐는 상단 바로가기로 즉시 좁힌다. */
export function chatFilterDefaultFor(_role: Role): ChatFilter {
  return CHAT_FILTER_DEFAULT;
}

/** 계약문의의 기본 정렬은 역할과 무관하게 최근 메시지 순이다. */
export function chatSortDefaultFor(_role: Role): ChatSort | '' {
  return 'recent';
}

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

/** 빈 방 셸은 일반 목록·숫자에서 제외하되, 계약이 연결된 레거시 방은 보존한다. */
export function hasChatRoomActivity(
  room: EntityRecord,
  contractIndex: Map<string, EntityRecord>,
  cancelledIndex: Map<string, EntityRecord>,
): boolean {
  return hasRoomStoredActivity(room)
    || Boolean(chatRowContract(room, 'all', contractIndex, cancelledIndex));
}

/** 계약문의 숫자·목록이 모두 같은 활동 방 집합을 쓰게 하는 SSOT. */
export function activeChatRooms(
  rooms: readonly EntityRecord[],
  contractIndex: Map<string, EntityRecord>,
  cancelledIndex: Map<string, EntityRecord>,
): EntityRecord[] {
  return rooms.filter((room) => hasChatRoomActivity(room, contractIndex, cancelledIndex));
}

/**
 * 검색·필터에서 사라진 일반 선택은 닫되, 명시적 `?room=` 진입은 첫 메시지를 쓸 때까지 보존한다.
 * 빈 방은 일반 목록 숫자에는 안 잡히지만 딥링크 작업면까지 닫히면 문의를 시작할 수 없다.
 */
export function retainChatSelection(
  rooms: readonly EntityRecord[],
  selected: string | null,
  visibleRoomKeys: readonly string[],
  requestedRoom: string | null | undefined,
): string | null {
  const key = String(selected || '').trim();
  if (!key) return null;
  if (visibleRoomKeys.includes(key)) return key;
  const requested = String(requestedRoom || '').trim();
  return requested === key && rooms.some((room) => String(room._key) === key) ? key : null;
}

function matchesFilter(room: EntityRecord, params: Params): boolean {
  if (params.filter === 'all') return true;
  const contract = chatRowContract(room, params.filter, params.contractIndex, params.cancelledIndex);
  // 내 차례 = 계약 단계에서 «공급 몫»이 걸려 있는 방(= 운영자가 처리한다) + 아직 답 못 한 첫 문의.
  if (params.filter === '내차례') return deskItemOf(room, contract || null).bucket === 'mine';
  if (params.filter === '취소') return isContractCancelled(contract);
  if (params.filter === '완료') return normalizeContractStatus(contract?.contract_status) === '계약완료';
  // 취소 이력은 전용 탭에만 둔다. 새 문의로 재개하려면 새 방/새 연결을 만들어 lifecycle을 분리해야 한다.
  if (normalizeContractStatus(contract?.contract_status) === '계약취소') return false;
  if (params.filter === '미확인') return isInquiryOnly(contract) && unreadFor(room, params.role) > 0;
  if (params.filter === '미회신') return isInquiryOnly(contract) && replyAttentionFor(room, params.role) === 'unreplied';
  return params.filter !== '문의' || isInquiryOnly(contract);
}

export function filterChatRooms(params: Params): EntityRecord[] {
  return activeChatRooms(params.rooms, params.contractIndex, params.cancelledIndex)
    .filter((room) => matchHay(
      [roomHaystack(room), params.searchText?.(room) || ''].filter(Boolean).join(' '),
      params.query,
    ))
    .filter((room) => matchesFilter(room, params))
    .slice()
    .sort((a, b) => {
      if (!params.sort || params.sort === 'recent') {
        return Number(b.last_message_at || 0) - Number(a.last_message_at || 0);
      }
      if (params.sort === 'wait') {
        // 오래 기다린 것 먼저. 대화가 없는 방(0)은 기다림의 대상이 아니라 맨 뒤로.
        const av = Number(a.last_message_at || 0);
        const bv = Number(b.last_message_at || 0);
        if (!av !== !bv) return av ? -1 : 1;
        return av - bv;
      }
      if (params.sort === 'unread') {
        return unreadFor(b, params.role) - unreadFor(a, params.role)
          || Number(b.last_message_at || 0) - Number(a.last_message_at || 0);
      }
      return String(params.nameOf?.(a) || a.vehicle_name || '')
        .localeCompare(String(params.nameOf?.(b) || b.vehicle_name || ''), 'ko');
    });
}

export function chatRoomPreviewCount(params: Omit<Params, 'sort'>): number {
  return activeChatRooms(params.rooms, params.contractIndex, params.cancelledIndex)
    .filter((room) => matchHay(
      [roomHaystack(room), params.searchText?.(room) || ''].filter(Boolean).join(' '),
      params.query,
    ))
    .filter((room) => matchesFilter(room, { ...params, sort: '' }))
    .length;
}
