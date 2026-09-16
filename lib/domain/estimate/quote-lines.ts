/**
 * 견적 다섯 줄을 «한 곳»에서 만든다 — 화면(관리자·공급사)과 서버(영업자·손님)가 **같은 셈**을 쓴다.
 *
 * ★사장님 2026-09-16 「이거도 분리해서 freepass-견적기로 하자. 영업(자용으)로 해야 할 거고」 ·
 *   2026-09-06 「영업자랑 손님이 보는 거는 **원가 정보 빠진 거** 좋은 거야」.
 *
 * ⚠⚠ **원가를 브라우저로 내려보내지 않는다.** 예전에는 원가 설정을 화면이 받아 «화면이» 대여료를
 *   셌다. 그러면 영업자에게 원가를 숨기는 길이 없다 — 숨겨도 개발자도구로 그대로 보인다.
 *   ⇒ 원가를 볼 수 있는 사람만 화면에서 세고, 나머지는 **서버가 세서 «값만»** 보낸다(`/api/estimate/quote`).
 *   그래서 셈이 두 벌이 되면 안 된다. 이 파일이 그 한 벌이다.
 */
import { adjustResidual, configFrom, type AcqPath, type CostSettings } from './cost-settings';
import { createQuoteInput } from './quote-input.js';
import { safeComputeTerm } from './safe-calc.js';
import { monthlyRates, residualSchedule } from './residual-schedule';

/** 엔진이 돌려주는 한 줄 — 원가(`cost`·`subtotal`)가 «들어 있다». 화면 손익표가 이걸 읽는다. */
export type Card = {
  term: number; payVat?: number; monthlySupply?: number; months?: number;
  /** 엔진이 세우는 깃발 — 배기량을 모르면 자동차세가 «조용히 0» 이 된다. 화면이 말해야 한다. */
  incompleteCc?: boolean;
  subtotal?: number; deposit?: number; residualRate?: number;
  cost?: Record<string, number>;
};

/** 손님·영업자가 보는 한 줄 — **원가가 자리조차 없다**(있으면 언젠가 채워진다). */
export type CustomerLine = {
  term: number; payVat: number; deposit: number; prepay: number; buyout: number; incompleteCc: boolean;
};

/** 견적 한 벌을 세우는 데 필요한 것 전부 — 화면이 쥔 값과 1:1이다. */
export type QuoteAsk = {
  channel: 'rent' | 'sub';
  type: 'return' | 'acquire';
  acq: AcqPath;
  credit: string;
  newCar: boolean;
  /** 손님 표시가(할인 후) · 손님 기준값(표시가 − 세제감면) · 세제감면 */
  price: number; netPrice: number; saleTaxCredit: number;
  cc: number | null; fuel: string;
  mileage: number; year: number; nowYear: number;
  /** 영업수수료(%) — 건별로 고른다. */
  feePct: number;
  /** 잔가가 딛는 밑값(엔진이 곱하는 값) · 1~5년 잔가율(%) */
  residBase: number; residPct: Record<number, number>;
  /** 해마다의 조건 — 약정 개월 · 보증금% · 선납% */
  terms: { term: number; dep: number; pre: number }[];
  /** 만기인수율(%) — 월납에는 «안» 들어간다. 없으면 견적 잔가와 같다. */
  buyoutPct?: Record<number, number>;
};

const TERM_ANCHORS = [12, 24, 36, 48, 60];

/**
 * 다섯 줄(또는 물어본 만큼)을 센다 — **원가까지 들어 있는** 줄이다.
 * ⚠ 잔가는 다섯 점이 아니라 **1~60개월 전부**를 넘긴다(`residual-schedule`) — 18개월 약정도 제 잔가를 받는다.
 */
export function quoteCards(cost: CostSettings, ask: QuoteAsk): Card[] {
  // 신차는 «출고가»라 업금액을 안 얹는다(중고는 매입가에 얹는다) — `configFrom` 이 갈래로 고른다.
  const base = configFrom(cost, { newCar: ask.newCar, path: ask.acq, credit: ask.credit });
  // 수수료 칩은 건별로 고른다 — 원가 설정의 기본값을 이 견적에서만 덮는다.
  const adminCfg = { ...base, setting: { ...base.setting, salesFeeRate: { rent: ask.feePct / 100, sub: ask.feePct / 100 } } };
  const anchors: Record<number, number> = {};
  for (const t of TERM_ANCHORS) anchors[t] = ask.residBase * (ask.residPct[t] ?? 0) / 100;
  const raw: Record<number, number> = ask.residBase > 0
    ? monthlyRates(residualSchedule(ask.residBase, anchors), ask.residBase)
    : Object.fromEntries(TERM_ANCHORS.map((t) => [t, (ask.residPct[t] ?? 0) / 100]));
  // 「잔가로 조정」 — 원가 설정의 가감(±%p)을 곡선 전체에 얹는다(사장님 2026-09-06).
  const residualDefault = adjustResidual(raw, cost.residualAdjustPct);
  return ask.terms.map(({ term, dep, pre }) => {
    const input = createQuoteInput({
      adminCfg, channel: ask.channel, type: ask.type,
      form: {
        price: ask.price, cc: ask.cc, fuel: ask.fuel, accident: 'none',
        mileage: ask.newCar ? 0 : ask.mileage, year: ask.newCar ? ask.nowYear : ask.year, credit: ask.credit,
        saleTaxCredit: ask.saleTaxCredit,
        netPrice: ask.netPrice,
      },
      conditions: { depositPct: dep, prepayPct: pre },
      residual: null, residualDefault, credit: ask.credit, defaultGroup: 'B', nowYear: ask.nowYear,
    });
    return { ...safeComputeTerm(term, input, { idx: term }), term } as Card;
  });
}

/**
 * 원가를 **덜어 낸** 줄 — 서버가 영업자·손님에게 보내는 것은 이것뿐이다.
 * ⚠ 새 칸을 여기 늘릴 때는 「손님에게 보여도 되는 값인가」를 먼저 묻는다.
 */
export function customerLines(cards: Card[], ask: QuoteAsk): CustomerLine[] {
  return cards.map((c) => {
    const cond = ask.terms.find((t) => t.term === c.term);
    const buyoutPct = ask.buyoutPct?.[c.term] ?? ask.residPct[c.term] ?? 0;
    return {
      term: c.term,
      payVat: Math.round(c.payVat || 0),
      deposit: Math.round(c.deposit || 0),
      prepay: Math.round(ask.netPrice * (cond?.pre ?? 0) / 100),
      buyout: Math.round(ask.netPrice * buyoutPct / 100),
      incompleteCc: c.incompleteCc === true,
    };
  });
}
