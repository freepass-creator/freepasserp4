'use client';
import { useEffect, useState } from 'react';

/**
 * 본문 칼럼의 왼쪽 끝을 **크롬(상단바)** 에 알려 준다 → `--fp-col-l`(뷰포트 기준 px).
 *
 * 상단바 햄버거와 하단 「이전」이 같은 세로선에 서야 한다. 그런데 크롬은 화면 기준이고
 * 본문은 옆에 보조 칼럼이 서면 화면 중앙이 아니다 — **화면 기준으로는 영영 못 맞춘다.**
 * 그래서 위치를 계산으로 흉내내지 않고 **본문에게 직접 물어본다.**
 *
 * 쓰는 쪽:
 *   const colRef = useContentColumn();   →   <main ref={colRef}>
 *   상단바: paddingLeft: `max(기본패딩, var(--fp-col-l))`
 *
 * ★사라질 때 변수를 지운다. 안 지우면 다음 페이지가 남의 칼럼 위치를 물려받아 햄버거가 떠 있는다.
 * ★우측(로그인 정보)은 건드리지 않는다 — 화면 오른쪽 끝이 제자리다(2026-08-08 사장님).
 */
const VAR = '--fp-col-l';

/**
 * 어떤 블록이 **자기 칼럼 맨 위에서 얼마나 내려와 있는지**를 CSS 변수로 알린다.
 * 옆 칼럼이 그만큼 내려오면 두 윗선이 맞는다.
 *
 * 상세 본문은 차명·칩 머리가 먼저 오고 그 아래가 사진이다. 우측 대여료 카드는 머리가 없으니
 * 그냥 두면 사진보다 위에서 시작한다.
 *
 * ★«머리 높이»가 아니라 **사진의 위치**를 잰다. 높이만 재면 머리의 아래 여백(margin)이 빠져
 *   딱 그만큼 어긋난다(실제로 11px 어긋났다). 여백·글자 줄바꿈·폰트가 바뀌어도 위치는 정확하다.
 */
export function useReportedTopOffset<T extends HTMLElement>(
  cssVar: string,
  /** 칼럼의 기준선. 상세는 언제나 <main> 안에 있다. */
  anchorSelector = 'main',
): (node: T | null) => void {
  const [node, setNode] = useState<T | null>(null);
  useEffect(() => {
    if (!node || typeof window === 'undefined') return;
    const measure = () => {
      const anchor = node.closest(anchorSelector);
      if (!anchor) return;
      const gap = node.getBoundingClientRect().top - anchor.getBoundingClientRect().top;
      document.documentElement.style.setProperty(cssVar, `${Math.max(0, Math.round(gap))}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    const anchor = node.closest(anchorSelector);
    if (anchor) ro.observe(anchor);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      document.documentElement.style.removeProperty(cssVar);
    };
  }, [node, cssVar, anchorSelector]);
  return setNode;
}

export function useContentColumn<T extends HTMLElement>(): (node: T | null) => void {
  // ref 객체가 아니라 state 로 받는다 — 본문은 로딩이 끝난 뒤에야 붙으므로(early return),
  //  deps [] 이펙트로는 «나중에 생긴 노드»를 영영 못 본다.
  const [node, setNode] = useState<T | null>(null);

  useEffect(() => {
    if (!node || typeof window === 'undefined') return;
    const measure = () => {
      const left = Math.max(0, Math.round(node.getBoundingClientRect().left));
      document.documentElement.style.setProperty(VAR, `${left}px`);
    };
    measure();
    // 폭이 바뀔 때만 다시 잰다(창 크기·보조 칼럼 등장/퇴장). 세로 스크롤로는 좌우가 안 변한다.
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    ro.observe(document.documentElement);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      document.documentElement.style.removeProperty(VAR);
    };
  }, [node]);

  return setNode;
}
