// ★이관 메모 — sonogong-estimator/src 에서 그대로 옮겼다(freepasserp.com 산하 견적 페이지, 설계서 §11).
//   바꾼 것은 **data 경로 한 줄뿐**(`../data/` → `./data/`)이다. 계산 로직은 한 글자도 안 건드렸다 —
//   그래서 scripts/test-estimate.mjs 39개가 그대로 통과해야 한다.
// 잔가 조회 — 「국산 표준잔가 곡선 + 차종별 델타(±%p)」 (2026-09-05 대표 지시).
//   ★ 표준 하나 정해두고 차종은 ±만. 대부분 델타는 세그먼트 기본값, 예외만 관리자가 손봄.
//   시세 흐름이 바뀌면 STANDARD 곡선만 올리고 내리면 전 차종 일괄 반영된다.
//     신차:  매각가 = 출고가 × resid(약정연수)
//     중고:  매각가 = 매입시세 × resid(현재연식 + 약정) / resid(현재연식)   ← 시세 기반 자동
import DELTA from './data/residual-delta.json' with { type: 'json' };  // ★`with` 는 표준 ESM 수입 속성.
//   원본에는 없었다 — Vite 는 없어도 되지만 순수 node 는 ERR_IMPORT_ATTRIBUTE_MISSING 으로 막는다.
//   붙여야 `node` 로 잔가를 «직접 재볼» 수 있다(검산 경로를 막지 않는다). webpack/Next 도 그대로 통과한다.   // { "makerId/modelCode": {maker,model,seg,delta} }

// 국산 표준 잔가 곡선 (신차 출고가 대비 잔존율%, 연식 1~8년). ★ 4년 = 58% 앵커(국산 평균).
export const STANDARD = { 1: 85, 2: 75, 3: 66, 4: 58, 5: 51, 6: 44, 7: 38, 8: 33 };

const clampPct = (v) => Math.max(5, Math.min(98, v));   // 잔존율 상·하한

// 델타(±%p)를 표준 곡선에 얹어 그 차의 곡선을 만든다.
function curveWithDelta(delta) {
  const d = Number(delta) || 0, out = {};
  for (let y = 1; y <= 8; y++) out[y] = clampPct(STANDARD[y] + d);
  return out;
}

// 잔존율 곡선값. age 0(신차)은 출고가 100% 기준 — 중고 비율식에서 신차급 잔가가 과대되지 않게 한다.
// 8년 초과는 외삽(연 -5%p, 하한 8%).
function rate(curve, age) {
  const a = Math.round(age);
  if (a <= 0) return 1;                       // 신차(0년) = 출고가 100%
  if (curve[a] != null) return curve[a] / 100;
  const last = curve[8] ?? STANDARD[8];
  return Math.max(8, last - (a - 8) * 5) / 100;
}

export function residDelta(makerId, modelCode) {
  return Number(DELTA[`${makerId}/${modelCode}`]?.delta) || 0;   // 미등록 = 표준(델타 0)
}
export function residCurve(makerId, modelCode) {
  return curveWithDelta(residDelta(makerId, modelCode));
}
export function residMeta(makerId, modelCode) {
  return DELTA[`${makerId}/${modelCode}`] || null;   // {maker,model,seg,delta}
}

// 신차 잔가(매각가). price=출고가(원), years=약정연수(1~5)
export function newcarResidual(price, makerId, modelCode, years) {
  return (Number(price) || 0) * rate(residCurve(makerId, modelCode), years);
}
// 신차 잔가율(%) — 표시용
export function newcarResidPct(makerId, modelCode, years) {
  return rate(residCurve(makerId, modelCode), years) * 100;
}

// 중고 잔가(매각가). marketPrice=현재 매입시세(원), currentAge=현재 연식(년), years=약정
export function usedResidual(marketPrice, makerId, modelCode, currentAge, years) {
  const c = residCurve(makerId, modelCode);
  const now = rate(c, currentAge);
  if (now <= 0) return 0;
  const end = rate(c, (Number(currentAge) || 0) + years);
  return (Number(marketPrice) || 0) * (end / now);
}
// 중고 잔가율(현재 시세 대비 %) — 표시용
export function usedResidPct(makerId, modelCode, currentAge, years) {
  const c = residCurve(makerId, modelCode);
  const now = rate(c, currentAge);
  return now <= 0 ? 0 : (rate(c, (Number(currentAge) || 0) + years) / now) * 100;
}
