'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  CarFront, MessageCircleMore, FileText, Box, Settings, type LucideIcon,
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
  inventory: Box,
  settings: Settings,
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
  policy: '정책관리',
  settlement: '월별정산',
  members: '회원·파트너',
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
};

/** 하단 탭 항목 — 공급사·관리자만 재고 추가 */
export function appTabsFor(role: Role): AppTab[] {
  const tabs: AppTab[] = [
    { href: '/', label: tabLabel('product'), icon: NAV_ICON.product },
    { href: '/chat', label: tabLabel('chat'), icon: NAV_ICON.chat, badgeKey: '/chat' },
    { href: '/contract', label: tabLabel('contract'), icon: NAV_ICON.contract, badgeKey: '/contract' },
  ];
  if (role === 'provider' || role === 'admin') {
    tabs.push({ href: '/inventory', label: tabLabel('inventory'), icon: NAV_ICON.inventory });
  }
  tabs.push({ href: '/settings', label: tabLabel('settings'), icon: NAV_ICON.settings });
  return tabs;
}

export function isTabRoute(path: string, role?: Role): boolean {
  if (path === '/') return true;
  if (path === '/chat' || path.startsWith('/chat/')) return true;
  if (path === '/contract' || path.startsWith('/contract/')) return true;
  if (path === '/settings' || path.startsWith('/settings/')) return true;
  if (path === '/inventory' || path.startsWith('/inventory/')) {
    return role == null || role === 'provider' || role === 'admin';
  }
  return false;
}

/** @deprecated role 없이 판별 — inventory 포함 */
export const TAB_ROUTES = ['/', '/chat', '/contract', '/inventory', '/settings'] as const;
