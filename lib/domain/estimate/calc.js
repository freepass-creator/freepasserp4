// ★이관 메모 — sonogong-estimator/src 에서 그대로 옮겼다(freepasserp.com 산하 견적 페이지, 설계서 §11).
//   바꾼 것은 **data 경로 한 줄뿐**(`../data/` → `./data/`)이다. 계산 로직은 한 글자도 안 건드렸다 —
//   그래서 scripts/test-estimate.mjs 39개가 그대로 통과해야 한다.
// ============================================================
// 손오공 견적 계산엔진 — 엑셀 "손오공_견적기_원본.xlsx" 1:1 이식
// 검증: 렌트/반납 차량가 24,200,000 cc1600 A군 →
//       2년 대여료(공급가) 639,724원 (엑셀 D36과 셀 단위 일치)
// ============================================================
import {
  FINANCE, RESIDUAL_TABLE,
  CHANNEL, FIXED, FUEL, ADJUST, BENEFIT,
  MARKUP_DEFAULT, POLICY, SETTING,
} from './data/cost-config.js';
import { turnoverCost } from './turnover-cost.js';

// 손오공 고객 견적서 월납입금 표기 — 렌트·구독 모두 천원 올림(ROUNDUP -3)
// (2026-06-12 팀장 요청: 렌트도 구독과 동일하게 라운드업)
function roundMonthly(channel, v) {
  return Math.ceil(v / 1000) * 1000;
}

// 정기검사비 — 1~2년차 면제, 3년차부터 1회씩 (2년0/3년1/4년2/5년3)
function inspectionCount(years) { return Math.max(0, Math.round(years) - 2); }

// 채널별 값 선택 — 설정이 { rent, sub } 형태면 채널로 고르고, 스칼라·배열이면 그대로.
// 신규 엑셀에서 금리·수익률·수당율·업금액·보증금 방식이 렌트/구독 비대칭이 되어 도입.
// 구버전 저장본(스칼라)은 그대로 통과하므로 하위호환이 깨지지 않는다.
export function pickCh(v, channel) {
  return (v && typeof v === 'object' && !Array.isArray(v) && channel in v) ? v[channel] : v;
}

// 차량가 업금액 — 세 형태를 받는다
//  · 정액 { fixed }  : 가격 무관 고정 가산  — 엑셀 렌터카기준 D10 = SUM(D7:D9)+1,500,000
//  · 정률 { rate }   : 차량가 × 비율        — 엑셀 구독기준   D10 = SUM(D7:D9)×1.2 → 가산 20%
//  · 구간표(배열)    : 가격구간(이하) 첫 매칭 가산액 (구버전 저장본 호환)
export function markupFor(price, spec) {
  if (spec && !Array.isArray(spec) && typeof spec === 'object') {
    if (spec.rate != null) return price * (+spec.rate || 0);
    if (spec.fixed != null) return +spec.fixed || 0;
  }
  const bs = Array.isArray(spec) && spec.length ? spec : MARKUP_DEFAULT;
  for (const b of bs) if (price <= b.max) return +b.add || 0;
  return +bs[bs.length - 1]?.add || 0;   // 상한 초과는 마지막 구간
}

export const TERMS = [24, 36, 48, 60]; // 약정 개월

// 보증금 배수표 — 엑셀 구독견적서_고객 26행.
//   F26 = F27×2 (2년) · H26 = H27×3 (3년) · M26 = H26 (4년) · S26 = M26 (5년)
//   4·5년이 3년 값을 그대로 쓰는 것은 셀에 명시된 참조라 그대로 재현한다.
//   인수형도 동일 구조 (AW26=AW27×2, AY26=AY27×3, BD26=AY26, BJ26=BD26).
export const DEPOSIT_MULTIPLE_DEFAULT = {
  24: { mult: 2, ref: 24 },
  36: { mult: 3, ref: 36 },
  48: { mult: 3, ref: 36 },
  60: { mult: 3, ref: 36 },
};

// 보증금 확정. 기본은 비율식(차량가×비율), 'payMultiple' 이면 월납입금 배수.
function resolveDeposit(term, input, payVat, byRate, channel) {
  if (pickCh(input.depositMode, channel) !== 'payMultiple') return byRate;
  const spec = (pickCh(input.depositMultiple, channel) || DEPOSIT_MULTIPLE_DEFAULT)[term];
  if (!spec) return byRate;
  const ref = spec.ref ?? term;
  // 참조 약정이 자기 자신이면 방금 구한 월납을 쓰고, 다르면 그 약정을 비율모드로 한 번만 다시 계산한다
  // (비율모드로 불러야 재귀가 끊긴다. 보증금은 월납에 영향을 주지 않으므로 월납 값은 동일하다.)
  const base = ref === term ? payVat : computeTerm(ref, { ...input, channel, depositMode: 'rate' }).payVat;
  return base * (spec.mult ?? 1);
}

// 원리금균등 상환 시 총 이자 = PMT×n − 원금
export function totalInterest(principal, monthlyRate, months) {
  if (monthlyRate === 0) return 0;
  const pmt = principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
  return pmt * months - principal;
}

// 자동차세 (연) — 배기량×cc단가 (구독=자가용/비영업, 렌트=영업) + 차령 할인 (자동 산출)
function cartaxPerYear(cc, channel, rates, age = null) {
  const brackets = CHANNEL[channel].cartaxBrackets;
  const r = rates?.[channel] || POLICY.cartaxRate[channel];
  const idx = brackets.findIndex((x) => cc <= x.maxCc);
  const perCc = r[idx] ?? brackets[idx].perCc;
  const base = cc * perCc;
  // 차령 할인 — 비영업용(구독)만: 3년차부터 매년 5%p씩, 최대 50% (지방세법). 영업용(렌트)은 차령경감 없음
  const disc = (channel === 'sub' && age != null) ? Math.min(0.5, Math.max(0, (age - 2) * 0.05)) : 0;
  return Math.round(base * (1 - disc));
}

// 세부모델 잔존율 → 차량 상태(사고·주행·연식) 보정 → 약정개월별 잔존율
// residualRates: {24,36,48,60} (세부모델 등록값) | 없으면 group(A/B/C) 폴백
// adjust: 관리자 보정 가중치 오버라이드 (없으면 ADJUST 기본값)
export function resolveResidualRate(term, {
  residualRates = null, group = 'A',
  accident = 'none', mileage = null, age = null, adjust = null,
  residualTable = null, ageBaked = false,
} = {}) {
  const A = { ...ADJUST, ...(adjust || {}), accident: { ...ADJUST.accident, ...(adjust?.accident || {}) } };
  const table = residualTable || RESIDUAL_TABLE;     // 관리자 기준표 우선
  const row = table[term] || RESIDUAL_TABLE[term] || null;   // 표에 없는 약정(예: 12개월)일 수 있다
  // 등급 단계가 줄어 그룹이 사라졌으면 최하 등급으로 폴백. 표 자체가 없으면 null.
  const gradeVal = row ? (row[group] ?? row.C ?? Object.values(row).filter((v) => typeof v === 'number').pop()) : null;
  const base = (residualRates && residualRates[term] != null)
    ? residualRates[term]
    : gradeVal;

  // ★ ageBaked: base(표준+델타)가 「시세 × 연식곡선」이라 시세가 이미 주행·사고·연식·상태를 반영한 값.
  //   → 여기서 다시 주행·사고·연식을 차감하면 이중반영이고, 특히 주행은 「잔가↓→감가↑→대여료↑」로
  //     방향이 거꾸로다(주행 많은 차는 시세가 싸서 이미 대여료가 싸야 맞음). 그래서 보정을 통째로 생략한다.
  if (ageBaked) return Math.max(0, base);

  // 1) 사고이력 — 잔존율 배수 (시세 미반영 경로: RTDB등록·A/B/C 등급표)
  let rate = base * (A.accident[accident] ?? 1);

  // 2) 누적 차감(%p) — 연식 입력 시에만 (미입력=엑셀 기준 그대로)
  let cut = 0;
  if (age != null) {
    if (mileage != null) {
      const expected = A.kmPerYear * Math.max(age, 1);    // 연식 대비 기대 주행
      const over = mileage - expected;
      if (over > 0) cut += (over / 10000) * A.mileagePer10k;
    }
    cut += (age - (A.baselineAge ?? 5)) * A.agePerYear;   // 기준5년: 신차면 음수(잔존↑)
  }
  cut = Math.max(-A.maxResidualCut, Math.min(cut, A.maxResidualCut));
  rate -= cut;

  return Math.max(0, rate);
}

// 단일 약정개월 견적
export function computeTerm(term, input) {
  const {
    channel = 'rent', type = 'return',
    price, cc = 1600, prepay = 0,
    residualRates = null, group = 'A',
    accident = 'none', mileage = null,
    fuel = 'gasoline', year = null,
    productization = false,
  } = input;
  const fuelCfg = FUEL[fuel] ?? FUEL.gasoline;
  // 전기차는 배기량이 없어 견적 산출용 고정 배기량을 쓴다 (강팀장 회신 2026-08-06: 1,000cc).
  // 엔진에서 강제한다 — 화면 입력값에 맡기면 0/공란이 들어와 자동차세가 0원이 된다.
  const quoteCc = fuelCfg.quoteCc != null ? fuelCfg.quoteCc : cc;
  // 관리자 조건 오버라이드 (엑셀 기준값 기본). 채널별 설정({rent,sub})이면 채널로 고른다.
  const ch$ = (v) => pickCh(v, channel);
  const interestRate = ch$(input.interestRate) ?? FINANCE.interestRate;
  const loanRatio = ch$(input.loanRatio) ?? FINANCE.loanRatio;
  // 잔존율 보정(연식·주행·사고). 견적 화면은 residualAdjust:true로 활성화하고,
  // 엑셀 회귀처럼 차량 상태가 없는 호출은 고정 A/B/C 잔가를 그대로 사용한다.
  const adjustOn = input.residualAdjust === true;
  const age = (adjustOn && year && input.nowYear) ? Math.max(0, input.nowYear - year) : null;

  const ch = CHANNEL[channel];
  const months = term;
  const years = months / 12;
  // 차량가 업금액 — 가격구간 가산(렌트·구독 공통). input.extra 명시 시 우선(엑셀 회귀용)
  const extra = input.extra != null ? input.extra : markupFor(price, ch$(input.markup));
  const priceTotal = price + extra;                // 차량가격 합계(원가산정 기준)
  const costEx = priceTotal / (1 + FINANCE.vat);   // 구입원가(VAT제외)

  // 보증금(비율식) — 순수 차량가 기준(업금액 제외). 엑셀 렌트견적서 F26 = ROUNDDOWN(차량가×F3, -5).
  // 구독은 신규 엑셀에서 「월납 배수」로 바뀌었고, 그건 payVat 확정 후 아래에서 다시 계산한다.
  const depositByRate = price * (ch$(input.depositRatio) ?? FINANCE.depositRatio);

  // 예상잔존가
  //  · 반납형: 잔존율 × 차량가합계
  //  · 인수형: 엑셀 H16 — 구입원가(VAT제외) × 잔가율(기본 10%). **보증금과 무관**하고
  //    원가소계에도 안 들어간다(인수형 차량원가는 구입원가 전액). 견적서 "만기 인수가" 표기용.
  //    검증: 렌트_인수형 D16=2,863,636.36 / 구독_인수형 D16=2,945,454.55 (신규 엑셀)
  const marketBaseRate = resolveResidualRate(term, {
    residualRates, group, accident: 'none', mileage: null, age: null,
    adjust: input.adjust, residualTable: input.residualTable,
  });
  const marketAdjustedRate = resolveResidualRate(term, {
    residualRates, group,
    accident: adjustOn ? accident : 'none', mileage: adjustOn ? mileage : null, age,
    adjust: input.adjust, residualTable: input.residualTable, ageBaked: input.residualAgeBaked === true,
  });
  let residualRate = null, residualAmt;
  if (type === 'acquire') {
    residualRate = ch$(input.acquireResidualRate) ?? SETTING.acquireResidualRate ?? 0.10;
    residualAmt = price * residualRate;
  } else {
    residualRate = marketAdjustedRate;
    residualAmt = residualRate * price;
  }
  // 잔존가·감가는 실제 차량가격 기준이다. 마크업은 아래 원가 산정에만 반영한다.
  const deprec = price - residualAmt; // 차량 감가(표시용)

  // ===== 손오공 엑셀 견적기 원가 (검증 완료) =====
  // 원가소계 = 차량원가(감가) + 이자 + 취득세 + 공채 + 자동차세 + GPS + 정비 + 주차장관리 + 영업수당 + [렌트: 보험+자차충당]
  const S = SETTING;
  const acqRate = input.acqTaxRate?.[channel] ?? POLICY.acqTaxRate[channel];
  // 차량원가 — 반납=차량가−잔존가(차 회수) / 인수=구입원가(VAT제외 전액, 엑셀 인수형 D17=D14)
  const carCost = (type === 'acquire') ? costEx : (priceTotal - residualAmt);
  // 인수형은 잔가를 차량원가에서 빼지 않으므로, 상태 악화로 줄어든 시장잔가만 위험원가로 반영한다.
  // 정상 기준보다 좋은 차량은 할인하지 않고 0을 하한으로 둔다.
  const conditionRisk = type === 'acquire'
    ? Math.max(0, marketBaseRate - marketAdjustedRate) * price
    : 0;
  // 이자 = 48개월 총이자. 반납=약정비례 ×min(약정,48)/48 / 인수=full 48개월치 고정 (엑셀 인수형 D18=F47)
  const loan = priceTotal * (loanRatio ?? S.loanRatio);
  const interest48 = totalInterest(loan, (interestRate ?? S.interestRate) / 12, 48);
  const interest = (type === 'acquire') ? interest48 : interest48 * Math.min(months, 48) / 48;
  // 취득세 = 구입원가 × 세율, 공채 = 구입원가 × 0.3%
  const acqTax = costEx * acqRate;
  const bond = costEx * (ch$(input.bondRate) ?? S.bondRate);
  // 등록비 — 번호판·인지대·등록대행 (1회성, 약정기간 안분). ★공채는 위 bond 라인에 별도이니 중복 금지.
  //   프리패스 원가모델 추가분(손오공 엑셀엔 없음) → 엔진 기본 0(엑셀 회귀 정합), 운영값은 DEFAULT_CONFIG.setting.regFee.
  const regFee = ch$(input.regFee) ?? S.regFee ?? 0;
  // 자동차세 = 배기량×단가×년수 (직접입력 우선). 차령할인은 cartaxPerYear 내부(엑셀 견적은 미반영)
  const cartaxYr = (input.cartaxYear != null && input.cartaxYear !== '') ? Number(input.cartaxYear)
    : (fuelCfg.taxYearFlat != null ? fuelCfg.taxYearFlat : cartaxPerYear(quoteCc, channel, input.cartaxRate, age));
  const cartax = cartaxYr * years;
  // 운영비
  const gps = (ch$(input.gpsMonthly) ?? S.gpsMonthly) * months;
  // 정비비 — 채널·유형별 (엑셀: 구독 1만 / 렌트반납 5천 / 렌트인수 1만)
  const maintMo = ch$(input.maintMonthly) ?? ch.maintPerMonth?.[type] ?? S.maintMonthly;
  const maint = maintMo * months;
  const parking = (ch$(input.parkingMonthly) ?? S.parkingMonthly) * months;  // 주차장+관리
  // 영업수당 = 차량가합계(마크업포함) × 4%, 상한 220만 (엑셀 MIN(D13×4%, 2.2M))
  const salesFee = Math.min(priceTotal * (ch$(input.salesFeeRate) ?? S.salesFeeRate), ch$(input.salesFeeCap) ?? S.salesFeeCap ?? FIXED.salesFeeCap);
  // 보험·자차충당·EW — 렌트만 (구독은 고객 명의 별도)
  const insurance = (channel === 'rent' ? (input.insYear ?? S.insYear) : 0) * years; // 대인·대물·자손
  const selfIns = (channel === 'rent' ? priceTotal * (input.selfRate ?? ch.selfInsRate ?? S.selfRate) : 0) * years; // 자차충당 1.2%
  const ew = (channel === 'rent' ? (input.ewPerYear ?? ch.ewPerYear?.[type] ?? 0) : 0) * years; // EW 연장보증 (렌트 반납 8만/년)
  // 원가소계 (대여료 원가 기준). 렌트·구독 모두 취득세를 정상 원가로 포함한다.
  // 구 엑셀의 렌트 인수형 일부 열에서 취득세를 다시 차감한 수식은 셀 오류이므로 재현하지 않는다.
  const subtotalBase = carCost + conditionRisk + interest + acqTax + bond + regFee + cartax + gps + maint + parking + salesFee + insurance + selfIns + ew;

  const margin = ch$(input.marginRate) ?? FINANCE.marginRate;
  // 손바뀜 위험원가 — 신용등급 계약유지율 기반(정상~0 / 중신용 0.33회 / 저신용 2.33회).
  //   반납형만(인수형은 고객이 차를 가져가 손바뀜 없음). 영업수수료·휴차가 대여료 비례라
  //   순환을 피하려 손바뀜 前 대여료(공급가)로 산정한다. input.credit 없으면 0 → 엑셀 회귀 불변.
  const baseRentSupply = (subtotalBase / months) * (1 + margin);
  const turnover = (input.credit && type === 'return')
    ? turnoverCost(input.credit, { monthlyRent: baseRentSupply, term: months, ...(input.turnover || {}) })
    : 0;
  const subtotal = subtotalBase + turnover;
  const totalCost = subtotal;   // 표시용

  const profit = subtotal / months * margin;   // 월 수익
  const buyoutNet = 0;

  const baseCostMonthly = subtotal / months;                  // 대여료 원가
  const prepayMonthly = prepay / months;
  // 대여료(공급) = 대여료원가 × (1+수익률),  VAT포함 = × (1+VAT)
  const rentalVat = baseCostMonthly * (1 + margin) * (1 + FINANCE.vat) - prepayMonthly;
  const rentalSupply = rentalVat / (1 + FINANCE.vat);

  // 초기비용(보증금+선납) 금융인정 — 들어온 전액 × 단일 인정율(기준 0). 엑셀 원가는 유지,
  // 최종 납입액에서만 차감 (회사가 선확보 자금으로 얻는 금융이익을 고객에게 환원)
  const B = input.benefit || BENEFIT;
  const creditRate = B.creditRate ?? B.interestRate ?? 0;         // 초기비용 금융인정율 — 기본 0 (엑셀엔 없음)
  const prepayBenefit = prepay * creditRate / 12;                 // 선납 인정
  const depositBenefit = type === 'acquire' ? 0 : depositByRate * creditRate / 12; // 보증금 금융인정 (반납형만)
  const benefit = prepayBenefit + depositBenefit;
  // 고객 월납입금 = 엑셀 견적서 표기값 (구독=천원올림 / 렌트=원값). benefit 기본 0(엑셀 일치)
  const payVat = roundMonthly(channel, rentalVat - benefit);  // 실 월납입(VAT포함)
  const paySupply = payVat / (1 + FINANCE.vat);        // 실 월납입(공급가)

  // 수익 분석 — 수익금액(profit)은 취득원가×수익률, 기간 무관 고정
  const marginMonthly = profit / months;
  const rentalProfit = profit;
  const salvage = type === 'acquire' ? residualAmt : Math.round(costEx * 0.1); // 인수형: 만기인수가 회수
  const residualValue = 1 - deprec / (priceTotal + acqTax);
  const totalProfit = rentalProfit + salvage + prepay;

  const out = {
    term, months, years,
    priceTotal, costEx, loan, residualRate, residualAmt, deprec,
    cost: { carCost, conditionRisk, interest, acqTax, bond, regFee, cartax, gps, maint, parking, salesFee, insurance, selfIns, ew,
            turnover, totalCost, residualAmt, deprec },
    turnover,   // 손바뀜 위험원가(총액, 등급 지정 시)
    subtotal, baseCostMonthly,
    monthlySupply: rentalSupply,   // 엑셀 원가 대여료(공급가) — 회귀/내부
    monthlyVat: rentalVat,         // 엑셀 원가 대여료(VAT포함) — 회귀/내부
    paySupply, payVat,             // 혜택 반영 실 월납입 — 표시·견적서
    benefit: { prepay: prepayBenefit, deposit: depositBenefit, total: benefit },
    deposit: depositByRate, buyoutNet,
    profit: { marginMonthly, rentalProfit, salvage, residualValue, totalProfit },
  };

  // 안전장치: 인수형 월대여료는 같은 조건 반납형보다 낮을 수 없음 (손님이 차를 가져가므로)
  if (type === 'acquire') {
    const ret = computeTerm(term, { ...input, type: 'return' });
    if (out.payVat < ret.payVat) {
      out.payVat = ret.payVat; out.paySupply = ret.paySupply;
      out.monthlyVat = ret.monthlyVat; out.monthlySupply = ret.monthlySupply;
      out.floored = true;        // 반납형 하한 적용됨
    }
  }
  // 보증금 확정 — 「월납 배수」 모드는 최종 월납입금 기준. 보증금은 월납 산식에 들어가지 않으므로
  // (엑셀 D35 = D30×(1+수익률) − 선납월) 여기서 계산해도 순환이 생기지 않는다.
  out.deposit = resolveDeposit(term, input, out.payVat, depositByRate, channel);
  return out;
}

// 전체 약정 견적 (24/36/48/60)
export function computeQuote(input) {
  return TERMS.map((t) => computeTerm(t, input));
}
