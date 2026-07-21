'use client';
// 컨텍스트 앱바 — 상단바=상태창(어디·맥락). 메뉴=우측.
// title = 페이지 상태(재고 · 차명 등). 없으면 TopBar가 라우트 라벨로 채움.
// 웹=상태+이전/액션+메뉴 / 모바일=상태+메뉴(이전·액션=하단).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type AppBarSlots = {
  back?: () => void;
  /** list = 같은 화면 목록 복귀 라벨. 기본 history = 이전. */
  backKind?: 'history' | 'list';
  /** 페이지 소개 — TopBar 중앙. 있으면 소속·이름 대신 표시. */
  title?: ReactNode;
  left?: ReactNode;
  actions?: ReactNode;
};

const Ctx = createContext<{ slots: AppBarSlots; set: (s: AppBarSlots) => void }>({ slots: {}, set: () => {} });

export function AppBarProvider({ children }: { children: ReactNode }) {
  const [slots, set] = useState<AppBarSlots>({});
  return <Ctx.Provider value={{ slots, set }}>{children}</Ctx.Provider>;
}

export function useAppBarSlots(): AppBarSlots {
  return useContext(Ctx).slots;
}

// 페이지가 자신의 앱바 내용을 설정. deps 변경 시 갱신, 언마운트 시 비움. slots=null이면 관여 안 함(오버레이용).
export function useAppBar(slots: AppBarSlots | null, deps: unknown[]) {
  const { set } = useContext(Ctx);
  useEffect(() => {
    if (!slots) return;
    set(slots);
    return () => set({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
