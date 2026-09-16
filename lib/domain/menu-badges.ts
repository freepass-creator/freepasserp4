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
import { settlementNeedsAttention } from '@/lib/domain/settlement-display';

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

  /*
   * ★★**«붙을 자리»가 없으면 세지도 않는다** — 2026-09-16.
   *   이 숫자는 `HAMBURGER_KEYS`(위)가 `/chat` 하나만 통과시켜서 **어디에도 안 붙는다.**
   *   `menuItemBadge`·`menuBadgeTotal` 둘 다 그 Set 으로 거르고, `AppTabBar` 의 `badgeKey` 는
   *   정의된 탭이 하나도 없다(`lib/tabbar.tsx` 실측). 그런데도 `store.list('settlement', co)` 는
   *   **정산 컬렉션을 통째로** 읽었다 — 관리자마다, 포커스·가시성 전환마다, 소비자 0 인 채로.
   *   ⇒ 「계산만 하고 버려지는」 낭비만 걷는다. **화면은 한 픽셀도 안 바뀐다.**
   *
   * ⚠⚠ **배지를 «띄우는» 것은 다른 일이다 — 대표 확인이 먼저다.**
   *   `/settlement` 를 `HAMBURGER_KEYS` 에 넣으면 관리자에게 「정산대기 N건」 배지가 **새로 생긴다.**
   *   그건 관리자가 하루를 여는 숫자를 하나 더 만드는 일이라, 무엇을 «내 차례»로 셀지
   *   (`settlementNeedsAttention` 의 뜻)까지 같이 정해야 한다. 여기서 몰래 켜지 않는다.
   *   ★켜기로 하면 이 `if` 와 `HAMBURGER_KEYS` 를 **같이** 고친다 — 한쪽만 고치면 또 버려진다.
   *
   * ⚠ `/contract` 쪽(위)은 그대로 둔다 — 거긴 이미 읽어 온 `contracts` 를 «거를» 뿐이라
   *   아낄 읽기가 없다. 없애도 얻는 게 없고, 배지를 켤 때 다시 짜야 한다.
   */
  if (role === 'admin' && HAMBURGER_KEYS.has('/settlement')) {
    try {
      const setts = await store.list('settlement', co);
      const pending = setts.filter((s) => s._deleted !== true && settlementNeedsAttention(s)).length;
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
