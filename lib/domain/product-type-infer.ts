/**
 * 상품구분(신차렌트·중고렌트·신차구독·중고구독)을 **비어 있을 때만** 추론한다.
 *
 * ★사장님 기준(2026-08-10)
 *   · 오토플러스는 전부 중고렌트다.
 *   · 주행거리가 300km 를 넘으면 중고로 본다.
 *   · 번호판으로도 갈린다 — 임시번호(`100신…`)·번호 없음은 아직 안 나온 신차다.
 *
 * ★안 하는 것
 *   · **이미 값이 있으면 손대지 않는다.** 사람이 정한 구분이 규칙보다 세다.
 *   · 근거가 없으면 **비워 둔다.** 「주행 0km」는 신차라는 뜻이 아니라
 *     공급사가 안 적었다는 뜻일 때가 많다(실측: 중고렌트인데 0km 인 차가 있다).
 *     모르면서 신차라고 적으면 손님에게 새 차라고 말하게 된다.
 *   · 렌트/구독은 추론하지 않는다 — 주행거리·번호판으로는 알 수 없는 계약 형태다.
 *     공급사가 구독만 취급하는 경우에만 그 공급사 기본값으로 정한다.
 */
import { canonProductType, isAutoplusProduct, TEMP_PLATE_RE } from '@/lib/domain/product';
import type { EntityRecord } from '@/lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();

/** 중고로 보는 주행거리 문턱(km). 출고 직후 탁송·시운전이 300km 를 넘지 않는다. */
export const USED_KM_THRESHOLD = 300;

export type TypeInference = { type: string; why: string } | null;

/**
 * 빈 구분을 채울 값을 고른다. 채울 수 없으면 `null`.
 * @param defaults 공급사별 기본 계약형태(예: `{ RP023: '중고렌트' }`) — 확실한 곳만 넣는다.
 */
export function inferProductType(
  p: EntityRecord,
  defaults: Record<string, string> = {},
): TypeInference {
  // ★이미 있으면 손대지 않는다.
  if (canonProductType((p as Rec).product_type)) return null;

  const code = S((p as Rec).provider_company_code || (p as Rec).partner_code).toUpperCase();
  const fixed = canonProductType(defaults[code]);
  if (fixed) return { type: fixed, why: `공급사 기본값(${code})` };
  // 오토플러스는 전부 중고렌트다(사장님 확인).
  if (isAutoplusProduct(p)) return { type: '중고렌트', why: '오토플러스는 전부 중고렌트' };

  const kmRaw = S((p as Rec).mileage).replace(/[^\d]/g, '');
  const km = Number(kmRaw) || 0;
  const plate = S((p as Rec).car_number);
  const pending = !plate || TEMP_PLATE_RE.test(plate) || (p as Rec).is_pending_plate === true;

  // 주행이 문턱을 넘으면 중고. 「렌트/구독」은 모르므로 렌트로만 채운다 —
  // 구독은 계약 형태라 주행거리로 알 수 없다(구독이면 사람이 고쳐야 한다).
  if (kmRaw && km > USED_KM_THRESHOLD) return { type: '중고렌트', why: `주행 ${km.toLocaleString()}km` };

  /**
   * ★연식도 근거다(사장님 지적 2026-08-10).
   *
   * 「공급사가 중고라고 적으면 주행거리가 안 적힌 것」 — 맞다. 주행이 비어도 연식이 말해 준다.
   * 재작년 차가 신차일 수는 없다. 올해·내년(선출고) 것만 신차로 본다.
   * 연식은 오늘 세대 매칭의 1차 관문이기도 해서 대부분 채워져 있다.
   */
  const yearRaw = S((p as Rec).year).replace(/[^\d]/g, '');
  const year = yearRaw.length === 4 ? Number(yearRaw) : 0;
  const now = new Date().getFullYear();
  if (year && year < now) return { type: '중고렌트', why: `${year}년식(올해보다 이전)` };

  // 번호가 아직 없으면 신차다 — 번호판이 나오기 전이라는 뜻이다.
  if (pending) return { type: '신차렌트', why: '번호미정(임시번호·번호없음)' };

  /**
   * 남은 것: 번호가 있고 연식도 올해 이후인데 주행이 비었거나 300km 이하.
   * 주행이 아예 없으면 신차라 단정하지 않는다 — 「0km」는 «안 적었다»는 뜻일 때가 많다.
   */
  // 0km 도 «안 적었다»는 뜻일 때가 많다 — 실제로 중고렌트인데 0km 인 차가 있었다.
  if (!kmRaw || km <= 0) return null;
  return { type: '신차렌트', why: `${year || '연식미상'} · 주행 ${km}km(문턱 ${USED_KM_THRESHOLD}km 이하)` };
}
