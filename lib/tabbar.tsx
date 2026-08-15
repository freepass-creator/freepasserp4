'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  CarFront, MessageCircleMore, FileText, FileSignature, Box, Settings, type LucideIcon,
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
  // 전자계약 = 손님에게 나간 계약서를 보는 곳. /contract(5단계 업무)와 축이 다르다 —
  //   저기는 «우리 일이 어디까지», 여기는 «손님이 어디까지 서명했나»(2026-08-08 결정).
  esign: '전자계약',
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
  // 계약문의는 역할마다 «맞는 화면»이 나온다(관리자=응대 큐). 탭을 쪼개지 않는다 —
  //  같은 방을 두 입구로 두면 어느 쪽이 정본인지가 흐려진다(2026-08-08 결정).
  const tabs: AppTab[] = [
    // '/' 는 공개 안내 페이지(상품시트 입장)가 됐다 — 내부 매물 화면은 /finder 다(2026-08-15).
    { href: '/finder', label: tabLabel('product'), icon: NAV_ICON.product },
  ];
  if (role === 'agent') {
    tabs.push({ href: '/contract', label: tabLabel('contract'), icon: NAV_ICON.contract, badgeKey: '/contract' });
    tabs.push({ href: '/esign', label: tabLabel('esign'), icon: NAV_ICON.esign });
  } else {
    tabs.push({ href: '/chat', label: role === 'admin' ? '상담데스크' : tabLabel('chat'), icon: NAV_ICON.chat, badgeKey: '/chat' });
    tabs.push({ href: '/contract', label: tabLabel('contract'), icon: NAV_ICON.contract, badgeKey: '/contract' });
  }
  if (role === 'provider' || role === 'admin') {
    tabs.push({ href: '/inventory', label: tabLabel('inventory'), icon: NAV_ICON.inventory });
  }
  tabs.push({ href: '/settings', label: tabLabel('settings'), icon: NAV_ICON.settings });
  return tabs;
}

export function isTabRoute(path: string, role?: Role): boolean {
  if (path === '/finder' || path.startsWith('/finder/')) return true;
  if (path === '/chat' || path.startsWith('/chat/')) return true;
  if (path === '/contract' || path.startsWith('/contract/')) return true;
  if (path === '/esign' || path.startsWith('/esign/')) return role == null || role === 'agent' || role === 'admin';
  if (path === '/settings' || path.startsWith('/settings/')) return true;
  if (path === '/inventory' || path.startsWith('/inventory/')) {
    return role == null || role === 'provider' || role === 'admin';
  }
  return false;
}

/** @deprecated role 없이 판별 — inventory 포함 */
export const TAB_ROUTES = ['/', '/chat', '/contract', '/inventory', '/settings'] as const;
