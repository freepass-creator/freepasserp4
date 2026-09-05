import { computeTerm } from './calc.js';

// 입력이 완성된 뒤 계산이 실패한 상태를 미입력 placeholder와 분리한다.
// 계산 엔진은 엑셀 정합 대상이므로 여기서 결과만 검증하고 엔진 자체는 건드리지 않는다.
export function safeComputeTerm(term, input, extra = {}) {
  try {
    const result = computeTerm(term, input);
    const required = {
      payVat: result?.payVat,
      paySupply: result?.paySupply,
      deposit: result?.deposit,
      residualRate: result?.residualRate,
      residualAmt: result?.residualAmt,
      subtotal: result?.subtotal,
      totalCost: result?.cost?.totalCost,
    };
    const invalid = Object.entries(required).filter(([, value]) => !Number.isFinite(value));
    if (invalid.length) {
      console.error('[estimate] non-finite calculation result', { term, invalid: Object.fromEntries(invalid) });
      return { ...extra, term, months: term, calcError: true };
    }
    return { ...extra, ...result, calcError: false };
  } catch (error) {
    console.error('[estimate] calculation failed', { term, error });
    return { ...extra, term, months: term, calcError: true };
  }
}
