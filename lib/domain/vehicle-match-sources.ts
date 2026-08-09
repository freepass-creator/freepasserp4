/**
 * 차종 5단계 — **각 단계에서 어느 칸을 대조하는가**의 SSOT.
 *
 * ★왜 필요한가(2026-08-09 사장님 지적)
 *   매칭은 원래 계단식이다 — 모델 → 세부모델 → 파워트레인 → 세부트림 순으로 좁힌다.
 *   어려운 건 단계가 아니라 **각 단계에서 무엇을 근거로 삼느냐**다.
 *   그게 코드 여기저기 흩어져 있으면 「옵션칸이 모델 후보에 섞이는」 사고가 난다 —
 *   실측 2026-08-09: 빌린카 아반떼의 옵션 「아틀라스 화이트/N Line 전용…」 때문에
 *   **아반떼가 파사트로, K5 가 Q5 로** 붙었다(21대).
 *
 * ★가르는 기준 하나
 *   **「그 칸이 차를 특정하는가.」**
 *   옵션·비고는 색상·편의장비 나열이라 특정하지 못한다. 글자만 맞을 뿐이다.
 *   특정하지 못하는 칸은 **좁히는 근거로 쓰지 않고**, 이미 좁혀진 뒤 «힌트»로만 쓴다.
 *
 * ★공급사 시트가 칸을 어떻게 주든 같다
 *   한 칸에 다 적어 오면(「더뉴아반떼 25MY 자가용 가솔린 1.6 N라인 인스퍼레이션」) 그 칸을 문장으로 풀고,
 *   칸이 쪼개져 있으면 그 칸을 그대로 쓴다. **어느 칸을 보느냐는 아래 표가 정한다.**
 */

/** 매칭 단계. 위에서 아래로 좁혀진다. */
export type MatchStep = 'model' | 'sub_model' | 'variant' | 'trim_name';

export type StepSources = {
  step: MatchStep;
  label: string;
  /** 이 단계에서 **후보를 좁히는 근거**로 읽는 칸. */
  evidence: string[];
  /**
   * 좁힌 **뒤에** 보조로만 읽는 칸.
   * 후보를 만들지는 못하고, 이미 남은 후보 중 하나를 고를 때만 쓴다.
   */
  hintOnly: string[];
  why: string;
};

/** 차를 특정하지 못하는 칸 — 어느 단계에서도 «좁히는 근거»가 될 수 없다. */
export const NON_IDENTIFYING_FIELDS = ['options', 'partner_memo', 'usage', '_row_text'] as const;

export const MATCH_SOURCES: StepSources[] = [
  {
    step: 'model',
    label: '모델',
    evidence: [
      'model', 'sub_model', 'cert_car_name', 'vehicle_name',
      'trim_name', 'variant', 'engine_type', 'vehicle_class',
    ],
    hintOnly: [],
    why: '차명이 적힐 수 있는 칸 전부. 옵션·비고는 뺀다 — 「N Line」·「아틀라스」가 수입차 모델명과 맞는다.',
  },
  {
    step: 'sub_model',
    label: '세부모델(세대)',
    evidence: [
      'sub_model', 'model', 'cert_car_name', 'vehicle_name', 'trim_name',
      'catalog_id', 'year', 'first_registration_date',
    ],
    hintOnly: ['trim_extra'],
    why: '세대는 **연식**과 세대코드(CN7·DL3·LX3)로 갈린다. 연식을 놓치면 25년식이 2013년 세대로 붙는다.',
  },
  {
    step: 'variant',
    label: '파워트레인',
    evidence: ['variant', 'fuel_type', 'engine_cc', 'drive_type', 'seats', 'trim_name', 'engine_type'],
    hintOnly: ['options'],
    why: '연료·배기량·구동·인승. 옵션칸의 「4WD」 같은 표기는 보조로만 쓴다.',
  },
  {
    step: 'trim_name',
    label: '세부트림',
    evidence: ['trim_name', 'model', 'sub_model', 'cert_car_name', 'vehicle_name'],
    // 트림은 옵션칸에 적히기도 한다(「프레스티지」). 세대·파워트레인이 이미 정해진 뒤라 위험이 작다.
    hintOnly: ['trim_extra', 'options', 'partner_memo'],
    why: '이미 좁혀진 세대의 실트림 목록 안에서만 고른다. 목록에 없으면 비운다 — 지어내지 않는다.',
  },
];

export function sourcesFor(step: MatchStep): StepSources {
  return MATCH_SOURCES.find((x) => x.step === step) || MATCH_SOURCES[0];
}

/** 그 단계에서 후보를 좁히는 데 쓸 수 있는 칸인가. */
export function isEvidenceField(step: MatchStep, field: string): boolean {
  return sourcesFor(step).evidence.includes(field);
}

/** 어느 단계에서도 좁히는 근거가 못 되는 칸인가. */
export function isNonIdentifying(field: string): boolean {
  return (NON_IDENTIFYING_FIELDS as readonly string[]).includes(field);
}
