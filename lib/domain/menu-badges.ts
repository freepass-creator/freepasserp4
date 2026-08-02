/**
 * 메뉴·탭 뱃지
 *   /chat(문의) = 아직 계약으로 넘어가지 않은 문의 중 내 안읽음 방 수
 *   /contract(계약) = 진행 중 — 하단탭만 (햄버거·합산에 안 넣음)
 *   /settlement = 정산대기·환수대기(관리자)
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type Role } from '@/lib/domain/deal';
import { getSession } from '@/lib/auth-session';
import { canAccessOwnedRecord } from '@/lib/domain/authorization';
import { roomsWithUnread, unreadRoomCount } from '@/lib/domain/messaging';
import { isInquiryOnly, isContractInProgress } from '@/lib/domain/contract';
import { isWorkspaceChatRoom } from '@/features/chat/room-filter';
import { buildContractIndex, contractForRoom } from '@/features/chat/room-display';

export type MenuBadgeMap = Record<string, number>;

/** 햄버거 아이콘·메뉴행 = 문의 안읽음만. 정산·계약은 탭/해당 페이지. */
const HAMBURGER_KEYS = new Set(['/chat']);

export async function loadMenuBadges(role: Role, co = getCompanyId()): Promise<MenuBadgeMap> {
  const store = getStore();
  const out: MenuBadgeMap = {};

  try {
    const [rooms, contracts] = await Promise.all([store.list('room', co), store.list('contract', co)]);
    const session = getSession();
    const mineRooms = rooms.filter((room) => canAccessOwnedRecord(session, room) && isWorkspaceChatRoom(room, role));
    // 페이지 목록과 같은 resolver를 써야 product_uid 레거시 방·linked_contract 충돌에서도
    // 메뉴의 "문의 안읽음" 숫자와 실제 문의 필터 결과가 어긋나지 않는다.
    const activeContractIndex = buildContractIndex(contracts, false);
    const contractOf = (room: (typeof rooms)[number]) => contractForRoom(activeContractIndex, room);
    const inquiryRooms = mineRooms.filter((r) => isInquiryOnly(contractOf(r)));
    const withUnread = await roomsWithUnread(inquiryRooms, role);
    // 뱃지 = 카운터만(soft 폴백·전량 메시지 스캔 결과 중 양수). roomsWithUnread가 열람 후 재계산.
    const unread = unreadRoomCount(withUnread, role);
    if (unread > 0) out['/chat'] = unread;

    const mineContracts = contracts.filter((contract) => canAccessOwnedRecord(session, contract));
    const inProgress = mineContracts.filter((c) => isContractInProgress(c)).length;
    if (inProgress > 0) out['/contract'] = inProgress;
  } catch { /* ignore */ }

  if (role === 'admin') {
    try {
      const setts = await store.list('settlement', co);
      const pending = setts.filter((s) => {
        if (s._deleted === true) return false;
        const st = String(s.settlement_status || '');
        return st === '정산대기' || st === '환수대기';
      }).length;
      if (pending > 0) out['/settlement'] = pending;
    } catch { /* ignore */ }
  }

  return out;
}

export function menuBadgeTotal(m: MenuBadgeMap): number {
  return Object.entries(m).reduce((a, [k, b]) => (HAMBURGER_KEYS.has(k) ? a + b : a), 0);
}

/** 햄버거 메뉴행에 뱃지 달지 여부(계약 진행 숫자는 숨김). */
export function menuItemBadge(m: MenuBadgeMap, href: string | undefined): number {
  if (!href || !HAMBURGER_KEYS.has(href)) return 0;
  return m[href] || 0;
}
