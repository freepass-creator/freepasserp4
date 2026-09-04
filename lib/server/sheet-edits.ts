/**
 * **상대가 시트에서 고친 칸을 «받아온다». 덮지 않는다.**
 *
 * ★★★사장님 2026-09-04 「**덮지말고 그거를 우리가 보고 우리 원장을 변경할지 검토해야하는거야**」
 *
 * ★**무슨 일이 있었나.** 하허호 최사랑 팀장이 8월 탭에서 잘못 적힌 차량번호와 빈 고객명을 고쳐 놨는데,
 *   우리가 그 탭을 다시 찍으면서 통째로 덮었다. 팀장 말 그대로 —
 *   「차량번호 잘못 기재된거랑 고객명 공란인거 제가 수정했는데 **새로 고침 되면서 다시 원상태로 돌아가네용**」
 *   ⇒ 그쪽이 한 일이 사라졌고, 그쪽은 「원본 데이터를 수정해야 되는건지」를 물을 수밖에 없었다.
 *
 * ★★**그럼 상대 값을 그냥 정답으로 삼으면 되나 — 아니다.**
 * ```
 * 원장(v4/settlement_rows)   우리 정본. 청구서·정산서가 여기서 나간다
 * 채널 시트                  상대가 «보는» 곳이자, 상대가 «틀렸다고 알려 주는» 곳
 * ```
 *   상대가 고친 값을 원장에 자동으로 밀어 넣으면, 시트를 고치는 것만으로 이미 나간 청구서의 근거가
 *   바뀐다. 그러니 **① 덮지 않고 ② 받아 쌓고 ③ 사람이 보고 ④ 원장을 고칠지 정한다.**
 *
 * ★그래서 칸마다 상태가 셋이다 — `대기`(받아만 놓음) · `받음`(원장에 반영함) · `물림`(안 쓰기로 함).
 *   `대기` 인 칸은 **시트에 상대 값을 그대로 둔다.** 원장을 고쳐 두 값이 같아지면 어긋남이 저절로 사라진다.
 *
 * ⚠ 「확인」·「메모」는 여기 오지 않는다 — 그건 원래 «상대 칸»이고 발행기가 따로 되돌려 놓는다.
 */

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : NaN; };

export type EditStatus = '대기' | '받음' | '물림';
export type SheetEdit = {
  channel: string; month: string; key: string; column: string;
  ours: string; theirs: string; seenAt: string; status: EditStatus;
  /** 원장에 반영하거나 물릴 때 남기는 한 줄 — 왜 그렇게 정했나. */
  why?: string;
};

/** RTDB 열쇠로 쓸 수 있게 다듬는다(`.#$/[]` 는 못 쓴다). */
export const editId = (channel: string, month: string, key: string, column: string) =>
  `${channel}_${month}_${key}_${column}`.replace(/[.#$/[\]\s]/g, '_');

/**
 * **우리가 쓸 줄과 시트에 있는 줄을 맞대 «사람이 고친 칸»을 뽑는다.**
 *
 * ★열쇠는 차량번호다 — 줄 차례는 달마다 바뀌지만 차는 그대로다.
 * ⚠ **차량번호 «자체»를 고친 경우**는 열쇠가 어긋나 짝을 못 찾는다. 그때는 짝 없는 줄끼리
 *   «자리»로 맞대 본다 — 줄 수가 같고 한 줄만 어긋났다면 그게 차번을 고친 것이다.
 * ⚠ 숫자는 «값»으로 견준다 — 시트는 1,214,400 으로 보여 주고 우리는 1214400 을 쓴다.
 */
export function diffSheetRows(opts: {
  head: readonly string[];
  ours: (string | number | boolean)[][];
  theirs: unknown[][];
  /** 상대가 적는 칸 — 여기는 어긋나도 «고친 것»이 아니다. */
  theirOwn?: readonly string[];
  keyCol?: string;
}): { key: string; column: string; ours: string; theirs: string }[] {
  const { head, ours, theirs } = opts;
  const own = new Set(opts.theirOwn || ['확인', '메모']);
  const keyCol = opts.keyCol || '차량번호';
  const ki = head.indexOf(keyCol);
  if (ki < 0) return [];

  const same = (a: unknown, b: unknown) => {
    const x = S(a), y = S(b);
    if (x === y) return true;
    const nx = N(x), ny = N(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return Math.abs(nx - ny) < 0.51;
    /** 「48개월」 ↔ 48 처럼 «보이는 꼴»만 다른 것은 같은 값이다. */
    return x.replace(/[,\s개월원]/g, '') === y.replace(/[,\s개월원]/g, '');
  };

  const out: { key: string; column: string; ours: string; theirs: string }[] = [];
  const byKey = new Map<string, unknown[]>();
  for (const r of theirs) { const k = S((r || [])[ki]); if (k) byKey.set(k, r); }

  const orphans: number[] = [];
  ours.forEach((o, i) => {
    const k = S(o[ki]);
    const t = byKey.get(k);
    if (!t) { orphans.push(i); return; }
    head.forEach((h, c) => {
      if (own.has(h) || same(o[c], (t || [])[c])) return;
      out.push({ key: k, column: h, ours: S(o[c]), theirs: S((t || [])[c]) });
    });
  });

  /**
   * ★**차번을 고친 줄** — 짝을 못 찾은 우리 줄과, 우리한테 없는 시트 줄을 «자리»로 맞댄다.
   *   양쪽 다 하나씩 남았을 때만 짝으로 본다. 둘 이상이면 어느 것이 어느 것인지 알 수 없어 손대지 않는다.
   */
  const ourKeys = new Set(ours.map((o) => S(o[ki])));
  const extra = theirs.filter((r) => { const k = S((r || [])[ki]); return k && !ourKeys.has(k); });
  if (orphans.length === 1 && extra.length === 1) {
    const o = ours[orphans[0]]; const t = extra[0];
    head.forEach((h, c) => {
      if (own.has(h) || same(o[c], (t || [])[c])) return;
      out.push({ key: S(o[ki]), column: h, ours: S(o[c]), theirs: S((t || [])[c]) });
    });
  }
  return out;
}

/**
 * **아직 «대기»인 고침을 우리 줄에 얹는다** — 그래야 다시 찍어도 그쪽이 한 일이 안 사라진다.
 *
 * ★열쇠(차량번호)를 고친 것이라면 그 칸까지 상대 값으로 바꾼다 — 다음 번 맞댈 때 짝이 맞아야 한다.
 */
export function applyPending(opts: {
  head: readonly string[];
  rows: (string | number | boolean)[][];
  pending: readonly SheetEdit[];
  keyCol?: string;
}): number {
  const { head, rows, pending } = opts;
  const ki = head.indexOf(opts.keyCol || '차량번호');
  if (ki < 0) return 0;
  const byKey = new Map<string, SheetEdit[]>();
  for (const e of pending) {
    if (e.status !== '대기') continue;
    byKey.set(e.key, [...(byKey.get(e.key) || []), e]);
  }
  let n = 0;
  for (const r of rows) {
    for (const e of byKey.get(S(r[ki])) || []) {
      const c = head.indexOf(e.column);
      /** ★우리 값이 그새 바뀌었으면(원장을 고쳤으면) 얹지 않는다 — 그 고침은 이미 «끝난» 것이다. */
      if (c < 0 || S(r[c]) !== e.ours) continue;
      r[c] = e.theirs; n++;
    }
  }
  return n;
}
