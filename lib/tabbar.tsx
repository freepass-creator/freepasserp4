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
 * 네비 워딩 SSOT — 웹 햄버거·모바일 탭·상태창 폴백 동일.
 * 짧은 탭 라벨 기준(상품·문의·계약·재고·설정). 페이지 본문 타이틀과 다를 수 있음.
 */
export const NAV_LABEL = {
  product: '상품',
  chat: '문의',
  contract: '계약',
  inventory: '재고',
  settings: '설정',
  policy: '정책',
  settlement: '월별정산',
  members: '회원·파트너',
  audit: '감사·휴지통',
  dataCheck: '데이터점검',
  dev: '개발도구',
} as const;

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
    { href: '/', label: NAV_LABEL.product, icon: NAV_ICON.product },
    { href: '/chat', label: NAV_LABEL.chat, icon: NAV_ICON.chat, badgeKey: '/chat' },
    { href: '/contract', label: NAV_LABEL.contract, icon: NAV_ICON.contract, badgeKey: '/contract' },
  ];
  if (role === 'provider' || role === 'admin') {
    tabs.push({ href: '/inventory', label: NAV_LABEL.inventory, icon: NAV_ICON.inventory });
  }
  tabs.push({ href: '/settings', label: NAV_LABEL.settings, icon: NAV_ICON.settings });
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
