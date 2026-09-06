/**
 * 원가 설정 — 「원가」 화면(`/estimate/cost`)이 적고, 「견적」 화면(`/estimate`)이 읽는다.
 *
 * ★한 곳(SSOT). 두 화면이 각자 기본값을 들고 있으면, 원가를 고쳐도 견적이 안 바뀌는 날이 온다.
 *
 * ★기본값은 **엔진의 `DEFAULT_CONFIG` 에서 꺼낸다** — 여기서 숫자를 새로 적지 않는다.
 *   화면이 「6.5%」라고 보여주면 엔진도 6.5% 를 쓰고 있어야 한다. 안 그러면 화면이 거짓말을 한다.
 *
 * ★저장은 **회사 공용**이다 — `app/api/estimate/cost/route.ts`(Firestore `settings/estimate_cost`).
 *   읽기는 로그인한 모두, 쓰기는 **관리자만**. 화면이 쓰는 문은 `cost-client.ts` 하나다.
 *   ⚠ 이 파일은 **서버도 읽는다**(그 라우트가 기본값·타입을 여기서 가져간다).
 *     그래서 여기에 `window`·firebase 를 들이지 않는다 — 순수한 값과 환산만 둔다.
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

/**
 * 화면이 다루는 값 — 전부 «사람이 읽는 단위»(퍼센트는 %, 돈은 원)다. 엔진 단위 환산은 `configFrom` 한 곳에서만.
 *
 * ★★2026-09-06 사장님 「**불변 데이터**(취득세·자동차세 같은 법정값) **말고는 다 다르다.**
 *   대출 얼마 받을 거냐, 금리가 얼마냐, 보험료가 얼마냐, **반납률이 얼마냐**, 저신용·중신용·고신용
 *   각자 회사마다 그 반납률을 얼마로 할 거냐 — 이런 건 다 다르기 때문에 **다 입력할 수 있게끔** 해야 돼.
 *   판관비도 빼서 계산해도 되지만 판관비를 넣어서 이익률 조정하든지, **이익률로 조정할지 잔가로 조정할지**
 *   이런 거는 다 좀 **자유롭게 조정**할 수 있게끔 해야 돼. 근데 그게 조합돼서 견적이 나오면 되는 거지」.
 *   ⇒ 그래서 손잡이가 넷이다 — **원가를 올리거나(항목·판관비) · 이익률을 올리거나 · 잔가를 내리거나 ·
 *     손바뀜(반납률)을 잡거나.** 어느 쪽으로 조정할지는 회사가 정한다.
 * ⚠ **법정값은 여기 없다** — 자동차세(cc단가)·개별소비세·부가세는 엔진이 자동으로 센다. 취득세율만
 *   영업용/비영업용이 갈려 화면에 둔다(회사가 아니라 «상품»이 정하는 값이라 채널축이다).
 */
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
  /** 차량가 업금액 — 매입가에 얹어 «취득원가»를 만든다. 감가·이자·수수료가 다 이 값 위에서 돈다. */
  markupRentPct: number; markupSubPct: number;
  /** EW(연장보증) — 렌트 반납형만. 연 단위. */
  ewYear: number;
  // 손바뀜(반납률) — 신용등급별 계약 유지율. 낮을수록 손바뀜이 잦아 위험원가가 커진다.
  retentionNormalPct: number; retentionMidPct: number; retentionLowPct: number;
  /** 손바뀜 회당 비용 — 상품화 · 왕복탁송 · 영업수수료(총대여료 대비 %) · 휴차 개월. */
  turnoverPrepFee: number; turnoverDeliveryFee: number; turnoverFeePct: number; turnoverVacancyMonths: number;
  /** 잔가 가감(±%p) — 「잔가로 조정」하는 손잡이. 곡선 전체를 통째로 올리거나 내린다. */
  residualAdjustPct: number;
};

const pct = (v: number) => Math.round((v || 0) * 1000) / 10;   // 0.065 → 6.5

/**
 * 기본값 = 엔진 `DEFAULT_CONFIG` + **손오공 운영값**.
 *
 * ★★2026-09-06 실측 — 손오공 견적기의 «실제 운영 설정»(RTDB `teamjpk-b70b7 /sonogong/config`)이
 *   코드 기본값과 셋 달랐다. 관리자가 화면에서 고친 값이고, 그게 **사장님이 「원래 책정해 놓은 것」**이다.
 *   ```
 *   대출 비율      80% → 90%
 *   주차장·관리   35,000 → 0     (3자 마켓이라 차를 우리가 세워 두지 않는다)
 *   영업수당율      5% → 3%
 *   ```
 *   ⇒ 여기서 덮는다. `default-config.js`(무손실 이관본)는 **안 고친다** — 그건 엑셀 회귀의 기준이다.
 *   ⚠ 이 셋을 안 맞추면 아반떼 2,500만 4년이 89만으로 나온다(운영값은 74만). 사장님이 「말이 되냐」 하신 값이다.
 */
export const COST_DEFAULTS: CostSettings = {
  bondPct: pct(D.setting.bondRate), regFee: D.setting.regFee,
  deliveryFee: 0, initPrepFee: 0,
  interestPct: pct(D.interestRate.rent),
  loanPct: 90,                       // ← 손오공 운영값(코드 기본 80)
  maintMonthly: D.setting.maintMonthly, gpsMonthly: D.setting.gpsMonthly,
  parkingMonthly: 0,                 // ← 손오공 운영값(코드 기본 35,000)
  inspectionFee: 0,
  overheadPct: 0, badDebtPct: 0,
  salesFeePct: 3,                    // ← 손오공 운영값(코드 기본 5%)
  acqTaxRentPct: pct(D.acqTaxRate.rent), acqTaxSubPct: pct(D.acqTaxRate.sub),
  insYear: D.setting.insYear, selfPct: pct(D.setting.selfRate),
  marginRentPct: pct(D.marginRate.rent), marginSubPct: pct(D.marginRate.sub),
  markupRentPct: 20, markupSubPct: 20,
  ewYear: 80000,
  retentionNormalPct: 97, retentionMidPct: 75, retentionLowPct: 30,
  turnoverPrepFee: 500000, turnoverDeliveryFee: 500000, turnoverFeePct: 3, turnoverVacancyMonths: 1,
  residualAdjustPct: 0,
};

/** 원가 설정 → 엔진이 받는 `adminCfg`. **환산은 여기 한 곳**에서만 한다. */
export function configFrom(cs: CostSettings) {
  const r = (v: number) => (v || 0) / 100;
  return {
    ...DEFAULT_CONFIG,
    interestRate: { rent: r(cs.interestPct), sub: r(cs.interestPct) },
    marginRate: { rent: r(cs.marginRentPct), sub: r(cs.marginSubPct) },
    loanRatio: r(cs.loanPct),
    markup: { rent: { rate: r(cs.markupRentPct) }, sub: { rate: r(cs.markupSubPct) } },
    acqTaxRate: { ...D.acqTaxRate, rent: r(cs.acqTaxRentPct), sub: r(cs.acqTaxSubPct) },
    // 판관비·대손 — 직접원가에 비율로 얹는다(엔진 `calc.js`. 기본 0이면 없던 것과 같다).
    overheadRate: r(cs.overheadPct),
    badDebtRate: r(cs.badDebtPct),
    /**
     * 손바뀜 — 신용등급별 «반납률(계약 유지율)»과 회당 비용.
     * ⚠ 키는 엔진(`turnover-cost.js` RETENTION)이 아는 이름이어야 한다. 「고신용」과 「정상」은 같은 칸이다.
     */
    turnover: {
      retention: {
        고신용: r(cs.retentionNormalPct), 정상: r(cs.retentionNormalPct),
        중신용: r(cs.retentionMidPct),
        저신용: r(cs.retentionLowPct), 무신용: r(cs.retentionLowPct),
      },
      productization: cs.turnoverPrepFee,
      deliveryRoundTrip: cs.turnoverDeliveryFee,
      feeRateOfRent: r(cs.turnoverFeePct),
      vacancyMonths: cs.turnoverVacancyMonths,
    },
    setting: {
      ...D.setting,
      bondRate: r(cs.bondPct), regFee: cs.regFee,
      insYear: cs.insYear, selfRate: r(cs.selfPct), ewYear: cs.ewYear,
      maintMonthly: cs.maintMonthly, gpsMonthly: cs.gpsMonthly, parkingMonthly: cs.parkingMonthly,
      deliveryFee: cs.deliveryFee, initPrepFee: cs.initPrepFee, inspectionFee: cs.inspectionFee,
      salesFeeRate: { rent: r(cs.salesFeePct), sub: r(cs.salesFeePct) },
    },
  };
}

/**
 * 잔가 곡선에 «가감(±%p)»을 얹는다 — 「잔가로 조정」하는 손잡이(사장님 2026-09-06).
 * ★잔가를 올리면 감가가 줄어 대여료가 내려간다. 이익률을 안 건드리고 값을 맞추는 길이다.
 * ⚠ 5~98% 로 가둔다. 100% 를 넘기면 「타고 나면 더 비싸지는 차」가 되고, 0 이면 감가가 차값 전부가 된다.
 */
export function adjustResidual(rates: Record<number, number>, pct: number): Record<number, number> {
  const d = (pct || 0) / 100;
  if (!d) return rates;
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(rates)) out[Number(k)] = Math.max(0.05, Math.min(0.98, v + d));
  return out;
}
