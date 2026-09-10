/**
 * **조건칸의 «줄이 서는 규칙» — 집에 하나뿐인 정본.**
 *
 * ★★★사장님 2026-09-10
 *   「필터 했을 때 **0인 필터를 없애 버리니까 필터가 막 이렇게 올라갔다 내려갔다** 하잖아.
 *    그러니까 있는 필터에서 뭘 잡았을 때 그게 없으면 그 필터 값을 없애는 게 아니라
 *    그냥 **그 필터가 옆에다가 0이라고** 해줘야지」
 *   「**공통으로 쓰는 것들은 한 군데서 고치면 다 동일하게 고쳐져야지.** 좀 이상하다는 생각이 드는데?」
 *
 * ⚠⚠ **그 말씀이 맞았고, 실제로 그렇게 틀어졌다.** 이 규칙이 손님 동(`lib/shop/query.ts`)과
 *   업무동(`lib/domain/product-filters.ts`)에 **손으로 두 번** 적혀 있었다. 그래서 2026-09-10 에
 *   손님 동만 고치고 업무동을 하루 남겨 뒀고, 사장님은 여전히 흔들리는 화면을 보셨다.
 *   ⇒ 규칙을 **이 파일 하나로** 모은다. 여기 한 줄을 고치면 두 동이 같이 바뀐다.
 *
 * ★★**무엇이 공통이고 무엇이 «갈려야» 하나** — 이걸 섞으면 안 된다.
 * ```
 *   공통(여기)   줄이 서나 안 서나 · 차례를 무엇이 정하나 · 0 을 어떻게 쓰나
 *   갈림(각 동)  어떤 축이 있나 · 값의 «이름»(손님 말 ↔ 업무 말) · 무엇을 세는가
 * ```
 *   손님 동은 2026-09-04 에 «일부러» 제 조건 정본을 갖게 됐다(그 파일 머리말 — 업무동 잣대로
 *   모수를 세다 축 셋을 통째로 잃은 사고). 그 «갈림»은 그대로 두고, **규칙만** 여기서 만난다.
 *
 * ★셈은 두 벌이다.
 * ```
 *   base   조건을 다 푼 모수(재고 전체)   →  줄이 «있나» · «어느 차례로» 서나
 *   count  지금 조건 모수(교차 집계)      →  숫자만
 * ```
 *   그래서 무엇을 눌러도 줄 수와 순서가 안 바뀐다 — **숫자만 오르내린다.**
 * ★재고에 **아예 없는** 값은 그래도 안 선다(`base === 0`) — 「지금 0」과 「원래 없다」는 다르다.
 */

/** 조건칸 한 줄 — 「무엇을(key) · 지금 몇 대(count) · 원래 몇 대(base)」. */
export type Standing = { key: string; count: number; base: number };

const at = (m: Map<string, number> | number[], k: string | number): number =>
  (Array.isArray(m) ? m[k as number] : m.get(String(k))) ?? 0;

/**
 * **차례가 «정해진» 축** — 값 목록이 규격으로 있는 축(차종·심사·연료·구간…).
 * 적은 순서가 곧 화면 순서다(대수로 다시 세우지 않는다 — 손님이 아는 순서가 이미 있다).
 */
export function standingFixed(
  order: readonly string[],
  base: Map<string, number> | number[],
  live: Map<string, number> | number[],
): Standing[] {
  return order
    .map((key, i) => ({
      key,
      base: at(base, Array.isArray(base) ? i : key),
      count: at(live, Array.isArray(live) ? i : key),
    }))
    .filter((o) => o.base > 0);
}

/**
 * **차례를 «대수»로 매기는 축** — 값이 데이터에서 나오는 축(제조사·차급·색상·공급사…).
 *
 * ⚠⚠ **차례는 `base` 로 매긴다.** 지금 건수로 매기면 누를 때마다 줄이 위아래로 뛴다 —
 *   실측 2026-09-10, 업무동에서 「연료=전기」 하나에 공급사 줄이 통째로 뒤집혔다.
 * ★`limit` 은 **자른 뒤에도 차례가 안 바뀌게** base 기준으로 자른다(스물을 세우면 그게 벽이다).
 */
export function standingRanked(
  base: Map<string, number>,
  live: Map<string, number>,
  opts: {
    /** 같은 대수일 때의 2차 잣대. 안 주면 이름 순(한글). */
    tie?: (a: string, b: string) => number;
    /** 대수 순이 아니라 «이 순서»로 세울 때(연식처럼 값 자체에 순서가 있는 축). */
    order?: (a: string, b: string) => number;
    /** 앞에서 몇 개까지 */
    limit?: number;
  } = {},
): Standing[] {
  const tie = opts.tie ?? ((a, b) => a.localeCompare(b, 'ko'));
  const rows = [...base.entries()]
    .map(([key, b]) => ({ key, base: b, count: at(live, key) }))
    .filter((o) => o.base > 0)
    .sort(opts.order
      ? (a, b) => opts.order!(a.key, b.key)
      : (a, b) => b.base - a.base || tie(a.key, b.key));
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

/** 한 벌 세기 — 「이 매물이 이 값이다」를 Map 으로. 두 동이 같은 꼴로 센다. */
export function tallyBy<T>(rows: readonly T[], of: (row: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) { const v = of(r); if (v) m.set(v, (m.get(v) || 0) + 1); }
  return m;
}

/** 술어로 세기 — 값 하나가 여러 줄에 걸릴 수 있는 축(구간·기간처럼). */
export function tallyMatch<T>(
  rows: readonly T[], keys: readonly string[], hit: (row: T, key: string) => boolean,
): Map<string, number> {
  const m = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const r of rows) for (const k of keys) if (hit(r, k)) m.set(k, (m.get(k) || 0) + 1);
  return m;
}
