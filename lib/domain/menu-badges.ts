/**
 * 메뉴·탭 뱃지
 *   /chat(문의) = 아직 계약으로 넘어가지 않은 문의 중 내 안읽음 방 수
 *   /contract(계약) = 진행 중 — 하단탭만 (햄버거·합산에 안 넣음)
 *   /settlement = 정산대기·환수대기·상태확인(관리자)
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type Role } from '@/lib/domain/deal';
import { getSession } from '@/lib/auth-session';
import { canAccessOwnedRecord } from '@/lib/domain/authorization';
import { roomsWithUnread, unreadRoomCount } from '@/lib/domain/messaging';
import { isContractCancelled, isInquiryOnly, isContractInProgress } from '@/lib/domain/contract';
import { activeChatRooms, chatRowContract, isWorkspaceChatRoom } from '@/features/chat/room-filter';
import { buildContractIndex } from '@/features/chat/room-display';
import { deskItemOf } from '@/features/chat/admin-queue';

export type MenuBadgeMap = Record<string, number>;

/** 햄버거 아이콘·메뉴행 = 계약문의 뱃지만. 정산·계약은 탭/해당 페이지. */
const HAMBURGER_KEYS = new Set(['/chat']);

export async function loadMenuBadges(role: Role, co = getCompanyId()): Promise<MenuBadgeMap> {
  const store = getStore();
  const out: MenuBadgeMap = {};

  try {
    const [rooms, contracts] = await Promise.all([store.list('room', co), store.list('contract', co)]);
    const session = getSession();
    const scopedRooms = rooms.filter((room) => canAccessOwnedRecord(session, room) && isWorkspaceChatRoom(room, role));
    // 페이지 목록과 같은 resolver를 써야 product_uid 레거시 방·linked_contract 충돌에서도
    // 메뉴의 "문의 안읽음" 숫자와 실제 문의 필터 결과가 어긋나지 않는다.
    const activeContractIndex = buildContractIndex(contracts, false);
    const cancelledContractIndex = buildContractIndex(contracts, true);
    const mineRooms = activeChatRooms(scopedRooms, activeContractIndex, cancelledContractIndex);
    const contractOf = (room: (typeof rooms)[number]) => chatRowContract(
      room, '문의', activeContractIndex, cancelledContractIndex,
    );
    const inquiryRooms = mineRooms.filter((room) => {
      const contract = contractOf(room);
      return !isContractCancelled(contract) && isInquiryOnly(contract);
    });
    const withUnread = await roomsWithUnread(inquiryRooms, role);
    // 뱃지 = 카운터만(soft 폴백·열람 이력이 있는 방의 메시지 보정 결과 중 양수).
    // roomsWithUnread는 scoped 조회를 우선하고, 미지원 저장소에서만 전량 fallback을 한 번 사용한다.
    // 계약문의 뱃지 — 역할에 따라 **뜻이 다르다.**
    //  영업자·공급사 = 안읽음(말이 왔나).
    //  관리자        = «내 차례»(내가 눌러야 넘어가는 건 수). 관리자가 하루를 여는 숫자는
    //                  읽었느냐가 아니라 처리해야 할 건수다. 판정은 목록과 같은 순수 함수를 쓴다.
    if (role === 'admin') {
      const mineTurn = mineRooms.filter((room) => deskItemOf(room, contractOf(room) || null).bucket === 'mine').length;
      if (mineTurn > 0) out['/chat'] = mineTurn;
    } else {
      const unread = unreadRoomCount(withUnread, role);
      if (unread > 0) out['/chat'] = unread;
    }

    const mineContracts = contracts.filter((contract) => canAccessOwnedRecord(session, contract));
    const inProgress = mineContracts.filter((c) => isContractInProgress(c)).length;
    if (inProgress > 0) out['/contract'] = inProgress;
  } catch { /* ignore */ }

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
