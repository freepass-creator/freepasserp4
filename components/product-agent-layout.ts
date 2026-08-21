'use client';

import { useIsMobile } from '@/lib/use-mobile';

/** 우측 영업 보조 칼럼이 서는 최소 폭. */
export const AGENT_COL_BP = 1200;
/** 본문과 보조 칼럼의 공통 간격. */
export const AGENT_COL_GAP = 28;

/** 페이지 본문이 보조 칼럼을 위한 하단 여백을 결정할 때 쓰는 가벼운 layout hook. */
export function useAgentColumn(): boolean {
  return !useIsMobile(AGENT_COL_BP);
}
