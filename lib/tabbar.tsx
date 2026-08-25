'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  CarFront, MessageCircleMore, FileText, FileSignature, Box, Settings, Star, type LucideIcon, Banknote,
} from 'lucide-react';
import type { Role } from '@/lib/domain/deal';

/** 탭바 표시 여부 — 상세 오버레이 때 숨김. */
const HideCtx = createContext<{ hide: boolean; setHide: (v: boolean) => void }>({
  hide: false,
  setHide: () => {},
});

export function TabBarProvider({ children }: { children: ReactNode }) {
  const [hide, setHide] = useState(false);
  return <HideCtx.Provider value={{ hide, setHide }}>{children}</HideCtx.Provider>;
}

export function useTabBarHidden() {
  return useContext(HideCtx).hide;
}

/** 상세 화면 등에서 탭바 숨김. */
export function useHideTabBar(hide: boolean) {
  const { setHide } = useContext(HideCtx);
  useEffect(() => {
    setHide(hide);
    return () => setHide(false);
  }, [hide, setHide]);
}

/** 하단 탭·상단 메뉴 공통 아이콘 SSOT */
export const NAV_ICON = {
  product: CarFront,
  chat: MessageCircleMore,
  contract: FileText,
  esign: FileSignature,
  inventory: Box,
  settlement: FileText,
  ledger: Banknote,
  settings: Settings,
  interest: Star,
} as const satisfies Record<string, LucideIcon>;

/**
 * 네비 워딩 SSOT — 웹 햄버거·페이지 타이틀.
 * 두 글자 약어 대신 무슨 일을 하는 곳인지 담는다(2026-07-21 결정).
 *   계약문의      = 단순 문의로 시작해 자연스럽게 계약으로 넘어가는 곳
 *   계약진행 및 정산 = 계약문의에서 넘어온 건 중 실제 계약이 진행되고 건별 정산까지 가는 곳
 *   월별정산      = 관리자 월 단위 정산(건별과 구분)
 */
export const NAV_LABEL = {
  product: '상품찾기',
  chat: '계약문의',
  contract: '계약진행 및 정산',
  inventory: '재고관리',
  settings: '설정',
  // 내가본상품 = 이 기기의 관심(찜)·최근 본 상품 모음(product-interest) — 모바일 하단탭 입구(사장님 2026-08-22)
  interest: '내가본상품',
  policy: '정책관리',
  // 계약서관리(/esign) = 계약서를 만들어 손님에게 보내고 서명을 추적하는 곳. /contract(계약진행)와 축이 다르다 —
  //   저기는 «내 계약이 어디까지 왔나», 여기는 «계약서를 보낸다/손님이 서명했나»(2026-08-08 결정).
  //   2026-08-19 사장님: 메뉴는 관리자 쪽(관리 그룹 맨 위, 파트너사관리 위)으로. 계약진행은 목록+진행상황 화면(원래 /contract).
  esign: '계약서관리',
  /**
   * 정산관리(/settlement/ledger) = 계약서를 보낸 «그다음». 계약이 인도되고 청구가 나가는 곳.
   * ★계약서관리 바로 밑에 둔다(사장님 2026-08-26 「계약서관리 밑에 정산관리 메뉴 만들어 주고
   *   그 메뉴에서 관리하자」) — 일이 이어지는 차례가 곧 메뉴 차례다.
   * ⚠ 월별정산(/settlement)과 다르다. 저건 옛 엔티티 위의 관리자 정산서고, 이건 «정산원장»이다.
   */
  ledger: '정산관리',
  settlement: '월별정산',
  members: '회원관리',
  partners: '파트너사관리',
  audit: '감사·휴지통',
  dataCheck: '데이터점검',
  dev: '개발도구',
  faq: '업무안내·QNA',
} as const;

/**
 * 하단 탭 전용 축약 — 탭 칸폭이 화면/5 라 4글자가 한계(11px 기준 ~44px).
 * 긴 정식명(NAV_LABEL)은 햄버거 메뉴·페이지 타이틀에서 그대로 보여준다. 여기 없는 키는 NAV_LABEL 사용.
 */
const NAV_TAB_LABEL: Partial<Record<keyof typeof NAV_LABEL, string>> = {
  contract: '계약진행',
};
const tabLabel = (k: keyof typeof NAV_LABEL): string => NAV_TAB_LABEL[k] ?? NAV_LABEL[k];

export type AppTab = {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: string;
  roles?: Role[];
  /** 준비중 — 자리만 보여주고 이동하지 않는다(햄버거 `soon` 과 같은 뜻). */
  soon?: boolean;
};

/**
 * 하단 탭 항목 — 햄버거(TopBar SIMPLE_GROUPS)와 같은 규칙.
 *   · 계약진행(/contract) = 목록 + 그 계약이 어디까지 왔는지(5단계) 보는 곳(사장님 2026-08-19).
 *   · 계약서관리(/esign)는 관리자 메뉴로 갔다 — 하단탭엔 없다.
 *   · **역할 무관 4탭 고정**(사장님 2026-08-22 「하단 버튼이 4개잖아 — 상품찾기·계약진행·재고관리/내가본상품·설정」):
 *     3번 칸만 갈린다 — 영업자=내가본상품(관심·최근) · 공급사/관리자=재고관리.
 *     정산확인은 탭에서 뺐다(햄버거 관리 메뉴에 그대로) — 모바일에서 매일 여는 화면이 아니다.
 */
export function appTabsFor(role: Role): AppTab[] {
  const tabs: AppTab[] = [
    // '/' 는 공개 안내 페이지(상품시트 입장)가 됐다 — 내부 매물 화면은 /finder 다(2026-08-15).
    { href: '/finder', label: tabLabel('product'), icon: NAV_ICON.product },
    { href: '/contract', label: tabLabel('contract'), icon: NAV_ICON.contract, badgeKey: '/contract' },
  ];
  if (role === 'provider' || role === 'admin') {
    tabs.push({ href: '/inventory', label: tabLabel('inventory'), icon: NAV_ICON.inventory });
  } else {
    tabs.push({ href: '/interest', label: tabLabel('interest'), icon: NAV_ICON.interest });
  }
  tabs.push({ href: '/settings', label: tabLabel('settings'), icon: NAV_ICON.settings });
  return tabs;
}

export function isTabRoute(path: string, role?: Role): boolean {
  if (path === '/finder' || path.startsWith('/finder/')) return true;
  if (path === '/chat' || path.startsWith('/chat/')) return true;
  if (path === '/contract' || path.startsWith('/contract/')) return true;
  if (path === '/settlement' || path.startsWith('/settlement/')) return role == null || role === 'admin';
  if (path === '/esign' || path.startsWith('/esign/')) return role == null || role === 'admin';
  if (path === '/settings' || path.startsWith('/settings/')) return true;
  if (path === '/interest' || path.startsWith('/interest/')) return true;
  if (path === '/inventory' || path.startsWith('/inventory/')) {
    return role == null || role === 'provider' || role === 'admin';
  }
  return false;
}

/** @deprecated role 없이 판별 — inventory 포함 */
export const TAB_ROUTES = ['/', '/chat', '/contract', '/inventory', '/settings'] as const;
