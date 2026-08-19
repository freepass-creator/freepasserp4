export type ProductReviewHierarchyEvidenceInput = {
  maker: string;
  model: string;
  subModel: string;
  rawTrim: string;
  supplierName: string;
  fuel: string;
  engineCc: number;
  drive: string;
  registrationMonth: string;
};

export type ProductReviewHierarchyEvidenceOverride = {
  ruleId: 'bmw_g60_520i_m_spt' | 'tesla_model3_pre_2026_07_long_range_awd';
  sourcePhrase: string;
  targetSubModel: string;
  targetTrim: string;
  ignoredSourceAxes?: readonly ('engine_cc' | 'drive')[];
};

const S = (value: unknown) => String(value ?? '').trim();
const compact = (value: unknown) => S(value).normalize('NFKC')
  .replace(/[\s·._()[\]/-]+/g, '')
  .toLowerCase();
const monthBetween = (value: string, start: string, end: string) => Boolean(value)
  && value >= start
  && value <= end;

/**
 * 공급사 원문이 더 구체적인데 구조화 열이 과거 세대/일반 토큰으로 오염된
 * 재현 사례만 복구한다. 이 함수는 후보를 확정하지 않는다. 호출자가 현재
 * 규격검토본에서 기술축·생산기간까지 대조해 유일한 행인지 다시 증명해야 한다.
 */
export function productReviewHierarchyEvidenceOverride(
  input: ProductReviewHierarchyEvidenceInput,
): ProductReviewHierarchyEvidenceOverride | null {
  const maker = S(input.maker);
  const model = S(input.model);
  const subModel = compact(input.subModel);
  const rawTrim = compact(input.rawTrim);
  const supplierName = S(input.supplierName);
  const fuel = S(input.fuel);
  const drive = S(input.drive).toUpperCase();

  // public/data/master-aliases.json의 사람 검토 규칙
  // `520i M Spt -> 520i M 스포츠`와 동일한, G60 범위 한정 복구다.
  if (maker === 'BMW'
    && model === '5시리즈'
    && subModel === compact('5시리즈 G60')
    && (!rawTrim || rawTrim === compact('520i M Spt'))
    && /(?:^|[^0-9A-Za-z])520i\s+M\s+Spt(?:$|[^0-9A-Za-z])/i.test(supplierName)
    && fuel === '가솔린'
    && input.engineCc >= 1950
    && input.engineCc <= 2050
    && (!drive || ['2WD', 'RWD'].includes(drive))
    && input.registrationMonth >= '2023-10') {
    return {
      ruleId: 'bmw_g60_520i_m_spt',
      sourcePhrase: '520i M Spt',
      targetSubModel: '5시리즈 G60',
      targetTrim: '520i M 스포츠',
    };
  }

  // 2026-07부터 시작하는 Premium Long Range RWD와 혼동하지 않는다.
  // 공급사 직접 원문에는 구동축이 없고 정제 꼬리에만 AWD가 있으므로, 구동은
  // 근거로 쓰지 않는다. 2024-04~2026-06 기간 + Long Range 완전구절로만 제안한다.
  if (maker === '테슬라'
    && model === '모델 3'
    && subModel === compact('모델 3')
    && rawTrim === compact('Premium')
    && /(?:^|[^0-9A-Za-z가-힣])(?:Model|모델)\s*3\s+Long\s+Range\s+Premium(?:$|[^0-9A-Za-z가-힣])/i.test(supplierName)
    && fuel === '전기'
    && monthBetween(input.registrationMonth, '2024-04', '2026-06')) {
    return {
      ruleId: 'tesla_model3_pre_2026_07_long_range_awd',
      sourcePhrase: '모델3 Long Range Premium',
      targetSubModel: '모델 3 FL',
      targetTrim: 'Long Range',
      ignoredSourceAxes: ['engine_cc', 'drive'],
    };
  }

  return null;
}
