'use client';
/**
 * 신차 견적 — **중고와 갈라서 선다**(사장님 2026-09-17 「중고차 견적기 따로, 신차 견적기 따로 해야함」).
 *
 * ★왜 갈랐나 — 한 화면에 둘을 얹으면 칸이 서로 남는다:
 *   중고는 «시세·연식·주행»을 사람이 넣고, 신차는 «옵션·조합규칙·제조사 색상»이 붙는다.
 *   사장님 「내가 애초에 견적기 욕심을 냈다 … 나눠서 하려고 한 게 실수야」 = 한 화면에 엮은 것을 가리킨다.
 * ★★**셈은 한 벌 그대로**다(사장님 「이 SSOT를 하나 두고 껍데기만 원하는 대로 바꿔서 쓰면 되지」) —
 *   화면만 `kind` 로 갈리고, 엔진·데이터·검사는 손대지 않았다.
 * ⚠ 원가를 보는 사람은 여기서도 **역할**이 가른다(`showsCost` · 관리자·공급사).
 */
import EstimateGate from '@/features/estimate/EstimateGate';
import EstimateApp from '@/features/estimate/EstimateApp';

export default function NewCarEstimatePage() {
  return <EstimateGate><EstimateApp surface="work" kind="new" /></EstimateGate>;
}
