'use client';
/**
 * 견적(업무) — 화면 본체는 `features/estimate/EstimateApp`.
 *
 * ★2026-09-17 에 본체를 뗐다(사장님 「웰릭스 형태로 해서 **손님들한테 견적기를 주려고**」).
 *   같은 화면이 두 자리에 선다 — 여기(업무 · 원가 보임)와 `/quote`(손님 · 신차 · 원가 없음).
 *   한 벌이라야 손님 견적과 우리 견적이 안 갈린다.
 * ⚠ 문지기(`EstimateGate`)는 이 자리에만 있다. 손님 자리는 열려 있어야 한다.
 * ⚠ 누가 원가를 보나 = `lib/domain/estimate/audience` `showsCost`(관리자·공급사).
 *   면(面)이 아니라 «역할»이 가른다 — 업무 자리에 영업자가 들어와도 원가는 안 보인다.
 */
import EstimateGate from '@/features/estimate/EstimateGate';
import EstimateApp from '@/features/estimate/EstimateApp';

export default function EstimatePage() {
  return <EstimateGate><EstimateApp surface="work" /></EstimateGate>;
}
