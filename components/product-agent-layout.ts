'use client';

import { useIsMobile } from '@/lib/use-mobile';

/**
 * ★우측 영업자 칼럼 «치수 SSOT» — 여기 한 곳에서만 정한다.
 *
 * ⚠ 2026-09-04 까지 이 셋(BP · GAP · useAgentColumn)이 `ProductAgentPanel.tsx` 에도 **똑같이**
 *   정의돼 있었다. 그리고 이미 갈려 있었다 — GAP 이 여기 28, 저기 16.
 *   («화면이 쓰는 값은 28» 이었고 16 은 아무도 안 썼다. 누가 그걸 가져다 쓰는 순간
 *    본문 여백과 칼럼 간격이 12px 어긋난다.)
 *   ⇒ 정의는 여기만. 패널은 여기서 **가져다 쓴다**.
 *
 * 칼럼 폭(AGENT_COL_W)·위아래 숨 간격(CHROME_GAP)은 «칼럼 자신»의 내부 치수라
 * `ProductAgentPanel.tsx` 에 로컬로 둔다 — 페이지가 알 필요가 없다.
 */
/** 우측 영업 보조 칼럼이 서는 최소 폭. 이보다 좁으면 본문 아래로 쌓는다. */
export const AGENT_COL_BP = 1200;
/** 본문과 보조 칼럼의 공통 간격. */
export const AGENT_COL_GAP = 28;

/** 지금 우측 칼럼이 실제로 서는가 — 페이지가 본문 하단 여백을 정할 때도 쓴다. */
export function useAgentColumn(): boolean {
  return !useIsMobile(AGENT_COL_BP);
}
