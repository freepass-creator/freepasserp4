import type { EntityRecord } from '@/lib/intake/entities';

/**
 * 손님 카탈로그용 «큰 갈래» — 재고의 세밀한 값을 손님이 고를 수 있는 크기로 접는다.
 *
 * ★왜 접나
 *   재고의 `vehicle_class` 는 「승차형 세단 · 준중형 SUV · 대형 MPV · 경형 해치백 …」처럼
 *   스무 갈래가 넘는다(실측 2026-09-04). 영업자에게는 그 정밀도가 쓸모 있지만, 손님 화면에
 *   스무 개를 세우면 그게 또 벽이라 아무도 안 누른다. 손님이 실제로 말하는 단위는 넷이다.
 *
 * ⚠ **접는 것은 «보여 주는 이름»뿐이고 데이터는 안 건드린다.** 원본 `vehicle_class` 는 그대로
 *   두고 여기서 갈래만 계산한다 — 원본을 덮으면 영업자 화면·계약서가 같이 뭉개진다.
 *
 * ⚠ 전기·하이브리드는 여기 없다. 그건 차종이 아니라 **연료**라서 연료 축이 받는다.
 *   (시안에는 「전기·HEV」가 차종에 있었지만 데이터상 연료가 맞다)
 */
export const CUSTOMER_VEHICLE_CLASSES = ['승용', 'SUV', '승합', '화물·픽업'] as const;
export type CustomerVehicleClass = (typeof CUSTOMER_VEHICLE_CLASSES)[number];

/**
 * 재고의 세밀한 차종값 → 손님이 고르는 큰 갈래.
 * 못 알아본 값은 **빈 문자열**이다 — 억지로 「승용」에 밀어 넣으면 손님이 고른 조건과
 * 실제 차가 어긋난다. 빈 값은 그 축에서 조용히 빠진다.
 */
export function customerVehicleClass(p: EntityRecord): CustomerVehicleClass | '' {
  const v = String(p.vehicle_class || '').trim();
  if (!v) return '';
  // 순서가 중요하다 — 「소형 SUV」는 SUV 이지 승용이 아니고, 「소형화물」은 화물이다.
  if (/픽업|화물|밴|트럭/i.test(v)) return '화물·픽업';
  if (/SUV|RV/i.test(v)) return 'SUV';
  if (/MPV|승합|미니밴|버스/i.test(v)) return '승합';
  if (/세단|해치|왜건|쿠페|컨버터블|승용/i.test(v)) return '승용';
  return '';
}
