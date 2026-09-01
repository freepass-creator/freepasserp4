/**
 * **판매열 블록** — 공급사 시트 재고 탭 «같은 줄 맨 뒤»에 상품시트에 올라갈 모양 그대로 이어 붙인 칸들(사장님 2026-08-19 「정제된 시트 맨 뒷쪽에 올려야 할 거를 거기서 그대로 연습해서 상품시트에 가져온다」).
 *
 * ★자리: … 정제칸(차종분류) | **║** | ▸배차상태 ▸구분 ▸차량번호 ▸제조사 … (상품리스트 열 그대로) — 표(Table)는 이 끝까지 한 덩어리.
 * ★머리글: 상품시트 열 이름 앞에 「▸」를 붙인다 — 재고 탭에 이미 있는 이름(차량번호·제조사·모델·세부모델·세부트림·옵션·연식·연료·배기량 …)과 겹치지 않게.
 *   상품시트로 옮길 때 「▸」만 벗긴다. 탭마다 블록 머리는 그 탭 줄이 실리는 판매 탭의 머리행(상품리스트 / 손오공구독 / 오플구독)과 같다.
 * ★채우기: 발행기(publish-origin-tab · publish-sonogong-tab)가 줄을 계산해 «먼저 이 블록에 쓰고», 상품시트에는 같은 값을 모아 붙인다(차량번호로 줄을 찾는다).
 *   사람은 손대지 않는다(기계 칸, 회청색 머리). 출고불가 줄도 블록은 채운다(상품시트엔 안 실림) — 그 줄이 어떻게 보일지 그 자리에서 본다.
 */
export const SALES_BLOCK_DIVIDER = '║';
export const SALES_BLOCK_PREFIX = '▸';
export const isSalesBlockDivider = (name: unknown) => String(name ?? '').trim() === SALES_BLOCK_DIVIDER;
export const isSalesBlockColumn = (name: unknown) => String(name ?? '').trim().startsWith(SALES_BLOCK_PREFIX);
export const toBlockHeader = (salesColumn: string) => `${SALES_BLOCK_PREFIX}${String(salesColumn ?? '').trim()}`;
export const fromBlockHeader = (blockColumn: string) => String(blockColumn ?? '').trim().replace(new RegExp(`^${SALES_BLOCK_PREFIX}`), '');
/** 머리행에서 블록 시작(구분선 다음) 열 번호와 블록 열 이름(▸ 벗긴 것). 없으면 start=-1. */
export function findSalesBlock(header: readonly string[]): { start: number; columns: string[]; dividerAt: number } {
  const dividerAt = header.findIndex((h) => isSalesBlockDivider(h));
  if (dividerAt < 0) return { start: -1, columns: [], dividerAt: -1 };
  const columns: string[] = [];
  for (let i = dividerAt + 1; i < header.length; i++) { const h = String(header[i] ?? '').trim(); if (!isSalesBlockColumn(h)) break; columns.push(fromBlockHeader(h)); }
  return { start: dividerAt + 1, columns, dividerAt };
}
/** 재고 탭 → 그 줄이 실리는 판매 탭(블록 머리의 정본). 손오공 구독재고 → 손오공구독 · 픽업재고 → 픽업구독 · 오토플러스(RP023) → 오플구독 · 그 밖 → 상품리스트. */
export function salesTabForStockTab(providerCode: string, tabTitle: string): '상품리스트' | '손오공구독' | '픽업구독' | '오플구독' {
  const t = String(tabTitle ?? '').trim();
  if (providerCode === 'RP023') return '오플구독';
  if (providerCode === 'RP012' && /픽업/.test(t)) return '픽업구독';
  if (providerCode === 'RP012' && /구독/.test(t)) return '손오공구독';
  return '상품리스트';
}
/** 블록 머리 배경(회청) — 기계 칸 표식. */
export const SALES_BLOCK_HEADER_COLOR = { red: 0.85, green: 0.89, blue: 0.93 };
export const SALES_BLOCK_DIVIDER_COLOR = { red: 0.33, green: 0.42, blue: 0.53 };
