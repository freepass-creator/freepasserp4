/**
 * 엔카 원자 학습 — 실수 없이 자동으로 돌려도 되는 것과, 사람 손에 남는 것.
 *
 *  ent카 「차종마스터 신규」는 중고 시세 428종(M/SM/T/U)만. 신차·FL을 시트에 지어 넣지 않는다.
 *  이름은 vehicle-master.json. 행키만 stamp가 박는다. 이름과 안 맞으면 비운다.
 */
export const ENCAR_ATOMS_CACHE = 'tmp/encar-atoms.json';
export const ENCAR_LEARN_MEMORY = 'data/encar-learn-memory.json';

export type EncarLearnAlias = {
  from: string;
  to: string;
  gen?: string;
  plates: number;
  /** json 사전에 이미 있으면 자동 스냅. pending 은 사람·검토 후에만 json에 올린다. */
  status: 'json' | 'pending';
};

export type EncarLearnMemory = {
  updated: string;
  encar: { rows: number; sm: number; t: number };
  aliases: EncarLearnAlias[];
  /** 엔카 시트에 세부모델이 없어 stamp가 키를 못 박는 표기. 비슷한 차로 안 붙인다. */
  missingEncar: { sub: string; n: number; note: string }[];
  lastStamp?: { cars: number; tKeep: number; tFill: number; tHold: number };
};

/** 자동 적용 가능 — 엔카에 원자 1개로 재현되고 차명·연료와 안 싸운다. */
export const ENCAR_AUTO_OK = [
  '엔카 시트에 같은 세부모델·연료·배기·트림이 정확히 하나',
  '차명에 e-트론/전기가 없으면 전기 원자를 안 붙인다',
  '이미 있는 M/SM/T는 이름과 맞을 때만 유지',
] as const;

/** 자동 금지 — 학습 기록만 남긴다. */
export const ENCAR_AUTO_HOLD = [
  '엔카 시트에 없는 세대(FL·디 엣지·신차·수입 일부) — 원자키를 만들지 않는다',
  '트림 후보가 여럿',
  '아이오닉5 NE ↔ N, A6 ↔ A6 e-트론 같은 비슷한 차',
  '라이브 ERP 차종마스터 탭 · mf- 신규 발급',
] as const;
