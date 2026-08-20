/**
 * **공급사 제공시트의 「AI 작업칸」 — 차량번호 하나당 차종을 «한 번만» 정한다.**
 *
 * ★왜(사장님 2026-08-14 — 「공급사시트에 AI가 작업해주는 칸들을 만들어서 공급사시트 자체에
 *   1회성으로 파워트레인 작업해놓고 그걸 갖고 오자」 · 「차량번호별로 한 번만 작업하면 되니까」)
 *   지금은 발행할 때마다 공급사 원문 「그랜저IG 21MY 자가용 하이브리드 르브랑」을 다시 읽어
 *   차종을 «추측»한다. 같은 차를 매주 새로 판단하고, 고쳐 놔도 다음 발행에 되돌아간다.
 *   그래서 파워트레인·세부트림이 영영 안 채워진다.
 *   차종을 **제공시트 칸에 적어 두면** 그 자리에 남는다. 발행은 그걸 그대로 실어 오기만 한다.
 *
 * ★칸의 자리 — 제공시트 **맨 앞**이다(「공급사가 직접 입력하는 거 뒤로」).
 *     [AI 작업칸] 차량번호 · 제조사 · 모델 · 세부모델 · 파워트레인 · 세부트림 · 정책코드
 *     [공급사 입력] 차명(세부모델+트림)〈원문〉 · 상태 · 분류 · 색 · 연식 · 연료 · 옵션 · 요금 …
 *   공급사는 새 차를 「차명(세부모델+트림)」에 적기만 하면 된다. 앞칸은 우리가 채운다.
 *
 * ★**이미 값이 있는 칸은 안 덮는다.** 그게 곧 「1회성」이다 —
 *   사람이 고친 값도, 공급사가 적어 준 값도 기계가 다시 밀어내지 않는다.
 *   기계가 다시 판단하는 것은 **빈 칸뿐**이다.
 * ⚠ 그래서 «틀린 값을 고치려면» 그 칸을 비우고 다시 돌리거나, 손으로 바로 고쳐야 한다.
 *   비워 두면 다음 채움 때 기계가 다시 넣는다.
 * ⚠ 이 칸들은 차종 다섯 축만 관할한다. **돈·상태·색은 AI 칸이 아니다** —
 *   그건 공급사가 매주 바꾸는 값이라 「한 번만」이 성립하지 않는다.
 */

const S = (v: unknown) => String(v ?? '').trim();

/** AI 가 채우는 차종 축. 제공시트·판매시트 열 이름이 같아야 한다. */
// ★파워트레인 축은 뺐다(사장님 2026-08-18 — 차종은 모델·세부모델·세부트림 3축, 연료·배기량은 따로).
export const AI_AXES = ['제조사', '모델', '세부모델', '세부트림'] as const;

/** AI 작업칸 블록 — 제공시트 맨 앞에 이 차례로 선다. */
export const AI_BLOCK = ['차량번호', ...AI_AXES, '정책코드'] as const;

/** 그 칸을 채워야 하는지 — 비어 있을 때만 채운다. */
export const needsFill = (cur: unknown) => !S(cur);

export type FillPlan = {
  /** 0-based 열 번호 → 넣을 값. 빈 칸만 담긴다. */
  cells: Map<number, string>;
  /** 이미 값이 있어 손대지 않은 칸 수. */
  kept: number;
  /** 기계가 확신을 못 해 못 채운 칸 수. */
  unknown: number;
};

/**
 * 한 줄에 무엇을 채울지 정한다. **빈 칸만** 채운다.
 *
 * @param row        지금 그 줄의 값(제공시트 그대로)
 * @param colOf      축 이름 → 그 줄에서의 열 번호(-1 이면 그 시트에 없는 칸)
 * @param guess      축 이름 → 기계가 고른 값(못 고르면 빈 글자)
 */
export function planFill(
  row: string[],
  colOf: (axis: string) => number,
  guess: (axis: string) => string,
): FillPlan {
  const cells = new Map<number, string>();
  let kept = 0;
  let unknown = 0;
  for (const axis of AI_AXES) {
    const i = colOf(axis);
    if (i < 0) continue;
    if (!needsFill(row[i])) { kept++; continue; }
    const v = S(guess(axis));
    if (!v) { unknown++; continue; }
    cells.set(i, v);
  }
  return { cells, kept, unknown };
}

/** 채운 뒤에도 비어 있는 칸이 몇 개인가 — «사람이 손봐야 할 일»의 크기다. */
export function countBlanks(rows: string[][], colOf: (axis: string) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const axis of AI_AXES) {
    const i = colOf(axis);
    out[axis] = i < 0 ? rows.length : rows.filter((r) => !S(r[i])).length;
  }
  return out;
}
