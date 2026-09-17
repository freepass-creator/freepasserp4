'use client';
/**
 * 중고 견적 — **신차와 갈라서 선다**(사장님 2026-09-17).
 *
 * ★중고의 중심은 «시세»다 — 우리에게 중고 시세 원장이 없어 신차 공표가 × 연식 잔가곡선으로 짚어 주고,
 *   사람이 고치면 그 값이 이긴다(「추정」 표시가 사라진다). 옵션 칸은 아예 없다 — 중고에 붙일 옵션표가 없다.
 * ★★셈은 신차와 **한 벌**이다. 갈린 것은 화면뿐이다.
 */
import EstimateGate from '@/features/estimate/EstimateGate';
import EstimateApp from '@/features/estimate/EstimateApp';

export default function UsedCarEstimatePage() {
  return <EstimateGate><EstimateApp surface="work" kind="used" /></EstimateGate>;
}
