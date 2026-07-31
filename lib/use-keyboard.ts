'use client';
import { useEffect, useState } from 'react';

/**
 * 소프트 키보드가 실제로 올라와 있는지.
 *
 * **focus 여부로 판정하면 안 된다.** 뒤로가기로 키보드만 내려도 입력칸은 계속 focus 상태라,
 * focus 기준으로 하단바를 숨기면 키보드가 사라져도 하단바가 돌아오지 않는다
 * (= 목록으로 나갈 방법이 없어진다). 그래서 시각 뷰포트 축소로 잰다.
 *
 * supported=false 면 visualViewport 가 없는 환경(구형·데스크톱)이라 호출부가 focus 로 폴백한다.
 */
export function useKeyboardOpen(): { open: boolean; supported: boolean } {
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    setSupported(true);
    const read = () => {
      // 키보드 높이 = 레이아웃 뷰포트 − 시각 뷰포트(− 스크롤 오프셋).
      //  주소창이 접히는 것(≈60px)과 구분하려고 120px 여유를 둔다.
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      setOpen(gap > 120);
    };
    read();
    vv.addEventListener('resize', read);
    vv.addEventListener('scroll', read);
    return () => {
      vv.removeEventListener('resize', read);
      vv.removeEventListener('scroll', read);
    };
  }, []);

  return { open, supported };
}
