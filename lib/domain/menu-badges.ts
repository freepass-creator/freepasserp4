/**
 * 메뉴·탭 뱃지
 *   /chat(문의) = 내 안읽음 방 수
 *   /contract(계약) = 진행 중 — 하단탭만 (햄버거·합산에 안 넣음)
 *   /settlement = 정산대기·환수대기(관리자)
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { actor, type Role } from '@/lib/domain/deal';
import { roomsWithUnread, unreadRoomCount } from '@/lib/domain/messaging';
import { isInquiryOnly, isContractInProgress } from '@/lib/domain/contract';

export type MenuBadgeMap = Record<string, number>;

/** 햄버거 아이콘·메뉴행 = 문의 안읽음만. 정산·계약은 탭/해당 페이지. */
const HAMBURGER_KEYS = new Set(['/chat']);

export async function loadMenuBadges(role: Role, co = getCompanyId()): Promise<MenuBadgeMap> {
  const store = getStore();
  const me = actor(role);
  const out: MenuBadgeMap = {};

  try {
    const [rooms, contracts] = await Promise.all([store.list('room', co), store.list('contract', co)]);
    const mineRooms = role === 'admin' ? rooms
      : role === 'provider' ? rooms.filter((r) => String(r.provider_company_code) === me.code)
      : rooms.filter((r) => String(r.agent_code) === me.code);
    const contractOf = (rm: (typeof rooms)[number]) =>
      contracts.find((c) => String(c.product_code) === String(rm.product_code) && String(c.agent_code) === String(rm.agent_code) && c.contract_status !== '계약취소');
    const inquiryRooms = mineRooms.filter((r) => isInquiryOnly(contractOf(r)));
    const withUnread = await roomsWithUnread(inquiryRooms, role);
    // 뱃지 = 카운터만(soft 폴백·전량 메시지 스캔 결과 중 양수). roomsWithUnread가 열람 후 재계산.
    const unread = unreadRoomCount(withUnread, role);
    if (unread > 0) out['/chat'] = unread;

    const mineContracts = role === 'admin' ? contracts
      : role === 'provider' ? contracts.filter((c) => String(c.provider_company_code) === me.code)
      : contracts.filter((c) => String(c.agent_code) === me.code);
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
