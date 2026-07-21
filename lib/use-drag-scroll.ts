'use client';
import { useRef, useCallback, type PointerEvent as REPointerEvent } from 'react';

/** 가로 스트립 — 마우스/터치로 잡고 드래그 스크롤. 클릭과 드래그 구분(5px). */
export function useDragScroll() {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = useCallback((e: REPointerEvent<HTMLDivElement>) => {
    const el = ref.current; if (!el) return;
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
    el.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: REPointerEvent<HTMLDivElement>) => {
    const el = ref.current; const d = drag.current; if (!el || !d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 5) { d.moved = true; suppressClick.current = true; }
    if (d.moved) el.scrollLeft = d.left - dx;
  }, []);

  const onPointerUp = useCallback(() => { drag.current = null; }, []);

  /** 썸네일 onClick 맨 앞에서 호출 — 드래그였으면 true(선택 무시). */
  const consumeClick = useCallback(() => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return { ref, onPointerDown, onPointerMove, onPointerUp, consumeClick };
}
