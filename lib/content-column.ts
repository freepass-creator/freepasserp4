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
 * 어떤 블록의 높이를 CSS 변수로 알린다 — 다른 칼럼이 그만큼 내려와 **윗선을 맞출** 때 쓴다.
 *
 * 상세 본문은 차명·칩 머리가 먼저 오고 그 아래가 사진이다. 우측 대여료 카드는 머리가 없으니
 * 그냥 두면 사진보다 위에서 시작한다. 머리 높이를 재서 그만큼 내리면 **사진과 같은 선**에 선다.
 * 글자가 두 줄로 접히면 높이가 달라지므로 상수로 박지 않고 잰다.
 */
export function useReportedHeight<T extends HTMLElement>(cssVar: string): (node: T | null) => void {
  const [node, setNode] = useState<T | null>(null);
  useEffect(() => {
    if (!node || typeof window === 'undefined') return;
    const measure = () => {
      document.documentElement.style.setProperty(cssVar, `${Math.round(node.getBoundingClientRect().height)}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty(cssVar);
    };
  }, [node, cssVar]);
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
