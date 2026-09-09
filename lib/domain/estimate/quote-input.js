const GRADE_LETTERS = ['A', 'B', 'C', 'D', 'E'];

export function defaultResidualGroup(makers, makerId, gradeCount = 3) {
  const grades = GRADE_LETTERS.slice(0, Math.max(3, Math.min(5, gradeCount || 3)));
  const imported = makers.find((maker) => maker.id === makerId)?.origin === 'import';
  return imported ? grades[grades.length - 1] : grades[Math.floor((grades.length - 1) / 2)];
}

export function insuranceExclusions(channel) {
  const excluded = channel === 'sub';
  return { insurance: excluded, selfIns: excluded };
}

/**
 * **손바뀜(계약 유지율) 설정** — 신용등급마다, 회사마다 다르다.
 * ★사장님 2026-09-06 「반납률이 얼마냐, 저신용·중신용·고신용 **여기에서 각자 회사마다** 그 반납률을
 *   얼마로 할 거냐 — 이런 건 다 다르기 때문에 다 입력할 수 있게끔」.
 * ⚠ 안 넘기면 `turnover-cost.js` 의 기본 유지율(97/75/30)이 그대로 쓰인다 — 지금까지와 같다.
 */
function turnoverOpts(adminCfg, credit) {
  const t = adminCfg?.turnover;
  if (!t) return undefined;
  const r = t.retention?.[credit];
  const out = {};
  if (r != null) out.retention = r;
  for (const k of ['productization', 'deliveryRoundTrip', 'feeRateOfRent', 'vacancyMonths', 'depositMonths', 'penaltyRecoveryRate']) {
    if (t[k] != null) out[k] = t[k];
  }
  return Object.keys(out).length ? out : undefined;
}

export function createQuoteInput({ adminCfg, channel, type, form, conditions, residual, residualDefault, credit, defaultGroup, nowYear }) {
  const who = credit || form.credit || null;
  return {
    channel, type,
    price: Number(form.price), cc: Number(form.cc),
    cartaxYear: form.cartax ? Number(form.cartax) : null,
    fuel: form.fuel, accident: form.accident,
    // 전기차 구매보조금 — 엔진이 연료가 ev 일 때만 취득가에서 뺀다.
    evSubsidy: adminCfg?.evSubsidy ?? 0,
    /* 판매가격 세제감면(개소세·교육세) — 제조사가 준 「세제혜택 전 − 후」.
       손님 표시가는 「전」 그대로 두고 **원가에서만** 뺀다. 없으면 0(중고·제네시스·르노). */
    saleTaxCredit: Number(form.saleTaxCredit) || 0,
    group: residual?.group || defaultGroup,
    // 잔가율 우선순위: 세부모델 직접등록(RTDB) > 표준+델타(차종) > A/B/C 등급표(null 폴백)
    residualRates: residual?.r || residualDefault || null,
    // 표준+델타는 usedResidPct(연식)로 이미 연식이 반영된 값 → 연식 이중차감 방지(주행·사고는 계속 보정).
    residualAgeBaked: !residual?.r && !!residualDefault,
    credit: who,   // 신용등급(정상/중신용/저신용) → 손바뀜 위험원가
    // 손바뀜 — 유지율·회당비용을 관리자가 정한다(없으면 엔진 기본).
    turnover: turnoverOpts(adminCfg, who),
    mileage: form.mileage ? Number(form.mileage) : null,
    year: form.year ? Number(form.year) : null, nowYear,
    residualAdjust: true,
    // VAT 기준 — 'excluded' 면 감가·이자·수당·자차가 모두 구입원가(VAT 제외) 위에서 돈다.
    vatBase: adminCfg.vatBase,
    marginRate: adminCfg.marginRate,
    depositRatio: conditions.depositPct / 100,
    prepay: Math.round((Number(form.price) || 0) * conditions.prepayPct / 100),
    interestRate: adminCfg.interestRate,
    loanRatio: adminCfg.loanRatio,
    adjust: adminCfg.adjust,
    benefit: adminCfg.benefit,
    residualTable: adminCfg.residualTable,
    markup: adminCfg.markup,
    acqTaxRate: adminCfg.acqTaxRate,
    cartaxRate: adminCfg.cartaxRate,
    bondRate: adminCfg.setting?.bondRate,
    regFee: adminCfg.setting?.regFee,
    // 보험·자차 — 채널별 설정이 있으면 그것이 이긴다(없으면 엔진이 예전대로 렌트만 잡는다).
    insYear: adminCfg.insYear ?? adminCfg.setting?.insYear,
    selfInsuredYear: adminCfg.selfInsuredYear,
    selfRate: adminCfg.selfRate ?? adminCfg.setting?.selfRate,
    maintMonthly: adminCfg.setting?.maintMonthly,
    maintRate: adminCfg.setting?.maintRate,
    gpsMonthly: adminCfg.setting?.gpsMonthly,
    parkingMonthly: adminCfg.setting?.parkingMonthly,
    salesFeeRate: adminCfg.setting?.salesFeeRate,
    // 1회성 초기비 — 탁송·상품화·정기검사(기본 0. 넣으면 원가에 그대로 더해진다)
    deliveryFee: adminCfg.setting?.deliveryFee,
    initPrepFee: adminCfg.setting?.initPrepFee,
    inspectionFee: adminCfg.setting?.inspectionFee,
    // 끝날 때 — 회수 탁송(정액) · 매각 비용(잔존가 대비 비율)
    returnDeliveryFee: adminCfg.setting?.returnDeliveryFee,
    disposalFeeRate: adminCfg.setting?.disposalFeeRate,
    ewPerYear: adminCfg.ewPerYear ?? adminCfg.setting?.ewYear,
    // 판관비·대손 — 직접원가에 비율로 얹는다(기본 0)
    overheadRate: adminCfg.overheadRate,
    badDebtRate: adminCfg.badDebtRate,
    acquireResidualRate: adminCfg.acquireResidualRate,
    depositMode: adminCfg.depositMode,
    depositMultiple: adminCfg.depositMultiple,
  };
}
