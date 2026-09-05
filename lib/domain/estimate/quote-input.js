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

export function createQuoteInput({ adminCfg, channel, type, form, conditions, residual, residualDefault, credit, defaultGroup, nowYear }) {
  return {
    channel, type,
    price: Number(form.price), cc: Number(form.cc),
    cartaxYear: form.cartax ? Number(form.cartax) : null,
    fuel: form.fuel, accident: form.accident,
    group: residual?.group || defaultGroup,
    // 잔가율 우선순위: 세부모델 직접등록(RTDB) > 표준+델타(차종) > A/B/C 등급표(null 폴백)
    residualRates: residual?.r || residualDefault || null,
    // 표준+델타는 usedResidPct(연식)로 이미 연식이 반영된 값 → 연식 이중차감 방지(주행·사고는 계속 보정).
    residualAgeBaked: !residual?.r && !!residualDefault,
    credit: credit || form.credit || null,   // 신용등급(정상/중신용/저신용) → 손바뀜 위험원가
    mileage: form.mileage ? Number(form.mileage) : null,
    year: form.year ? Number(form.year) : null, nowYear,
    residualAdjust: true,
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
    insYear: adminCfg.setting?.insYear,
    selfRate: adminCfg.setting?.selfRate,
    maintMonthly: adminCfg.setting?.maintMonthly,
    gpsMonthly: adminCfg.setting?.gpsMonthly,
    parkingMonthly: adminCfg.setting?.parkingMonthly,
    salesFeeRate: adminCfg.setting?.salesFeeRate,
    acquireResidualRate: adminCfg.acquireResidualRate,
    depositMode: adminCfg.depositMode,
    depositMultiple: adminCfg.depositMultiple,
  };
}
