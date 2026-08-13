/**
 * **차종마스터 표기 사전** — 「공급사가 쓴 말」을 「마스터가 쓰는 말」로 옮기는 규칙을 쌓아 둔다.
 *
 * ★왜(사장님 2026-08-13 — 「이걸 여기서 임의로 바꾸면서 학습을 해놔. 뭐를 어떻게 바꿀지
 *   다음에 갖고 올 때도 그대로 반영해야 하니까 계속 누적해서 학습해」)
 *   한 번 고치고 끝내면 다음 유입 때 같은 자리에서 또 틀린다. 고칠 때마다 **규칙을 남긴다.**
 *
 * ★마스터를 늘리는 것과 **다른 일**이다.
 *     마스터에 없는 축   → 마스터에 만든다(`fill-master-gap.mts`)
 *     마스터에 있는데 말이 다른 것 → **여기 사전에 적는다**
 *   섞으면 같은 등급이 두 층위로 앉는다(「아방가르드」와 「E300 아방가르드」가 따로 산다).
 *
 * ★규칙은 **좁게** 건다. 같은 말이라도 차종이 다르면 뜻이 다르다 —
 *   「트렌디」는 K7 에서 「LPI 트렌디(렌터카)」지만 셀토스에서는 그냥 「트렌디」다.
 *   그래서 제조사·모델·세부모델까지 묶어서 적는다. 넓게 걸고 싶으면 그 칸을 비운다.
 *
 * ⚠ 규칙을 지우는 일은 사람이 한다. 자동으로 지우지 않는다 — 지워야 할 규칙은
 *   «마스터가 그 말을 받아들이게 바뀐» 경우뿐이고, 그건 판단이 필요하다.
 */

export type AliasKind = 'variant' | 'trim' | 'model' | 'sub_model' | 'maker';

export type AliasRule = {
  kind: AliasKind;
  /** 어디에 거는 규칙인가. 빈 칸은 «가리지 않는다»는 뜻이다. */
  maker?: string;
  model?: string;
  sub_model?: string;
  /** 공급사·매물 쪽 말 */
  from: string;
  /** 마스터 쪽 말 */
  to: string;
  /** 이 규칙이 나온 근거 — 몇 대에서 봤나. 적을수록 오타일 가능성이 크다. */
  n?: number;
  /** 언제·무엇이 넣었나. 사람이 손으로 넣은 규칙은 `by: '사람'`. */
  at?: string;
  by?: string;
  /** 사람이 확인했나. 확인 안 된 규칙도 적용하되, 검수 목록에 남는다. */
  reviewed?: boolean;
};

export type AliasBook = { version: number; updated?: string; rules: AliasRule[] };

export const EMPTY_BOOK: AliasBook = { version: 1, rules: [] };

const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '').toLowerCase();

/** 같은 규칙인가 — 자리(kind·범위·from)가 같으면 같은 규칙이다. `to` 가 달라지면 덮어쓴다. */
export function sameSlot(a: AliasRule, b: AliasRule): boolean {
  return a.kind === b.kind
    && norm(a.maker) === norm(b.maker)
    && norm(a.model) === norm(b.model)
    && norm(a.sub_model) === norm(b.sub_model)
    && norm(a.from) === norm(b.from);
}

/**
 * 규칙을 사전에 넣는다. 이미 있으면 **대수만 더하고 `to` 는 새 것으로 맞춘다.**
 * 사람이 확인한 규칙(`reviewed`)은 자동 규칙이 덮지 못한다 — 손으로 고친 걸 기계가 되돌리면 안 된다.
 */
export function upsert(book: AliasBook, rule: AliasRule): { book: AliasBook; added: boolean; changed: boolean } {
  const rules = [...book.rules];
  const at = rules.findIndex((r) => sameSlot(r, rule));
  if (at < 0) {
    rules.push(rule);
    return { book: { ...book, rules }, added: true, changed: false };
  }
  const old = rules[at];
  if (old.reviewed && !rule.reviewed) {
    rules[at] = { ...old, n: (old.n || 0) + (rule.n || 0) };
    return { book: { ...book, rules }, added: false, changed: false };
  }
  const changed = norm(old.to) !== norm(rule.to);
  rules[at] = { ...old, ...rule, n: (old.n || 0) + (rule.n || 0) };
  return { book: { ...book, rules }, added: false, changed };
}

/** 좁은 규칙이 먼저다 — 세부모델까지 맞춘 규칙이 제조사만 맞춘 규칙을 이긴다. */
function score(r: AliasRule): number {
  return (r.sub_model ? 4 : 0) + (r.model ? 2 : 0) + (r.maker ? 1 : 0);
}

export type AliasScope = { maker?: unknown; model?: unknown; sub_model?: unknown };

/** 그 자리에서 그 말을 마스터 말로 옮긴다. 규칙이 없으면 **그대로 돌려준다**(지어내지 않는다). */
export function applyAlias(book: AliasBook, kind: AliasKind, scope: AliasScope, value: unknown): string {
  const v = S(value);
  if (!v || !book?.rules?.length) return v;
  const hit = book.rules
    .filter((r) => r.kind === kind && norm(r.from) === norm(v))
    .filter((r) => (!r.maker || norm(r.maker) === norm(scope.maker))
      && (!r.model || norm(r.model) === norm(scope.model))
      && (!r.sub_model || norm(r.sub_model) === norm(scope.sub_model)))
    .sort((a, b) => score(b) - score(a));
  return hit.length ? S(hit[0].to) : v;
}

/** 사람이 아직 안 본 규칙 — 검수 목록에 띄운다. */
export function unreviewed(book: AliasBook): AliasRule[] {
  return (book.rules || []).filter((r) => !r.reviewed);
}
