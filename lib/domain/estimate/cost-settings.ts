/**
 * 원가 설정 — 「원가」 화면(`/estimate/cost`)이 적고, 「견적」 화면(`/estimate`)이 읽는다.
 *
 * ★한 곳(SSOT). 두 화면이 각자 기본값을 들고 있으면, 원가를 고쳐도 견적이 안 바뀌는 날이 온다.
 *
 * ★기본값은 **엔진의 `DEFAULT_CONFIG` 에서 꺼낸다** — 여기서 숫자를 새로 적지 않는다.
 *   화면이 「6.5%」라고 보여주면 엔진도 6.5% 를 쓰고 있어야 한다. 안 그러면 화면이 거짓말을 한다.
 *
 * ⚠ 저장은 **지금은 브라우저 한 대**(localStorage)다. 회사 공용으로 두려면 저장소 노드와
 *   보안규칙을 정해야 한다(사장님 확인 필요). 그전까지 「저장」은 이 브라우저에만 남는다.
 *
 * ⚠ 목업(`프리패스-목업-원가설정.html`)에 있으나 **엔진이 아직 안 쓰는 칸**이 있다.
 *   지우지 않고 그대로 두되 화면에 「미반영」이라 적는다 — 없는 척하면 다음에 또 만든다.
 *     · 1차 탁송료 · 초기 상품화비 · 정기검사비
 *       → 엔진에 자리(`deliveryFee`/`etcInitRate`/`inspectionFee`)는 있고 값은 0 이다.
 *         「탁송·정기검사·기타초기비는 간접비로 보아 직접비 원가에 넣지 않는다」(대표 2026-09-05).
 *     · 일반관리·간접비 배분율 · 대손·리스크 충당 · 페이백 테이블 → 엔진에 자리가 없다.
 */
import { DEFAULT_CONFIG } from './default-config.js';

const D = DEFAULT_CONFIG as unknown as {
  interestRate: { rent: number; sub: number };
  marginRate: { rent: number; sub: number };
  loanRatio: number;
  acqTaxRate: { rent: number; sub: number };
  setting: {
    bondRate: number; regFee: number; insYear: number; selfRate: number;
    maintMonthly: number; gpsMonthly: number; parkingMonthly: number;
    salesFeeRate: { rent: number; sub: number };
  };
};

/** 화면이 다루는 값 — 전부 «사람이 읽는 단위»(퍼센트는 %, 돈은 원)다. 엔진 단위 환산은 `configFrom` 한 곳에서만. */
export type CostSettings = {
  // 취득
  bondPct: number; regFee: number;
  deliveryFee: number; initPrepFee: number;        // 미반영(간접비로 봄)
  // 금융
  interestPct: number; loanPct: number;
  // 직접 운영비
  maintMonthly: number; gpsMonthly: number; parkingMonthly: number;
  inspectionFee: number;                            // 미반영
  // 판관비
  overheadPct: number; badDebtPct: number;          // 미반영(엔진에 자리 없음)
  // 수수료
  salesFeePct: number;
  // 조건별(채널축)
  acqTaxRentPct: number; acqTaxSubPct: number;
  insYear: number; selfPct: number;
  marginRentPct: number; marginSubPct: number;
};

const pct = (v: number) => Math.round((v || 0) * 1000) / 10;   // 0.065 → 6.5

export const COST_DEFAULTS: CostSettings = {
  bondPct: pct(D.setting.bondRate), regFee: D.setting.regFee,
  deliveryFee: 0, initPrepFee: 0,
  interestPct: pct(D.interestRate.rent), loanPct: pct(D.loanRatio),
  maintMonthly: D.setting.maintMonthly, gpsMonthly: D.setting.gpsMonthly,
  parkingMonthly: D.setting.parkingMonthly, inspectionFee: 0,
  overheadPct: 0, badDebtPct: 0,
  salesFeePct: pct(D.setting.salesFeeRate.rent),
  acqTaxRentPct: pct(D.acqTaxRate.rent), acqTaxSubPct: pct(D.acqTaxRate.sub),
  insYear: D.setting.insYear, selfPct: pct(D.setting.selfRate),
  marginRentPct: pct(D.marginRate.rent), marginSubPct: pct(D.marginRate.sub),
};

const KEY = 'fp.estimate.cost.v1';

export function loadCostSettings(): CostSettings {
  if (typeof window === 'undefined') return COST_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return COST_DEFAULTS;
    const saved = JSON.parse(raw) as Partial<CostSettings>;
    // 저장된 뒤에 항목이 늘 수 있다 — 없는 칸은 기본값으로 채운다(빈 칸이 0 으로 굳지 않게).
    const out = { ...COST_DEFAULTS };
    for (const k of Object.keys(COST_DEFAULTS) as (keyof CostSettings)[]) {
      const v = saved[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch { return COST_DEFAULTS; }
}

export function saveCostSettings(cs: CostSettings): boolean {
  if (typeof window === 'undefined') return false;
  try { window.localStorage.setItem(KEY, JSON.stringify(cs)); return true; } catch { return false; }
}

/** 원가 설정 → 엔진이 받는 `adminCfg`. **환산은 여기 한 곳**에서만 한다. */
export function configFrom(cs: CostSettings) {
  const r = (v: number) => (v || 0) / 100;
  return {
    ...DEFAULT_CONFIG,
    interestRate: { rent: r(cs.interestPct), sub: r(cs.interestPct) },
    marginRate: { rent: r(cs.marginRentPct), sub: r(cs.marginSubPct) },
    loanRatio: r(cs.loanPct),
    acqTaxRate: { ...D.acqTaxRate, rent: r(cs.acqTaxRentPct), sub: r(cs.acqTaxSubPct) },
    setting: {
      ...D.setting,
      bondRate: r(cs.bondPct), regFee: cs.regFee,
      insYear: cs.insYear, selfRate: r(cs.selfPct),
      maintMonthly: cs.maintMonthly, gpsMonthly: cs.gpsMonthly, parkingMonthly: cs.parkingMonthly,
      salesFeeRate: { rent: r(cs.salesFeePct), sub: r(cs.salesFeePct) },
    },
  };
}
