'use client';
// 컨텍스트 앱바 — 하나의 상단바가 화면(라우트)마다 내용을 바꿔 씀.
// 홈: 회사·렌즈(left) + 검색·입력(actions). 세부: ←이전·제목(back/title) + 수정·저장(actions).
// 웹=상단바에 back/title/left/actions, 모바일=상단바엔 title/left, back/actions는 하단 고정바.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type AppBarSlots = { back?: () => void; title?: ReactNode; left?: ReactNode; actions?: ReactNode };

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
