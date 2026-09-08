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
 * ★★★**차가 없는 줄은 「(차번없음)」이 열쇠가 아니다 — 임차인까지 붙여야 열쇠다.**
 *
 * ⚠ **무슨 일이 있었나.** 지원금·수수료처럼 차가 없는 줄은 발행기가 차량번호 칸에
 *   똑같이 「(차번없음)」을 찍는다. 하허호 8월 탭에 그런 줄이 «둘»(사무실비 지원금 300,000 ·
 *   최사랑 업무지원비 100,000) 있었는데, 맞대는 쪽이 뒤엣것으로 앞엣것을 덮어 버려
 *   **한 줄의 값이 다른 줄의 「그쪽이 고침」으로 올라왔다** — 실측 2026-09-07,
 *   사무실비 300,000 이 「최사랑 100,000 으로 고침」 아홉 칸으로 잡혔다.
 *
 * ⇒ 차번이 있으면 차번이 열쇠다. 없으면 **임차인**을 붙여 가른다.
 *   임차인마저 없으면 **열쇠가 없는 것**이고, 열쇠 없는 줄은 아예 맞대지 않는다(빈 문자열).
 *   ★그래서 우리한테 없는 «그쪽만의» 무차번 줄은 짝을 못 찾아 그대로 남는다 —
 *     그게 「그쪽 시트에만 있는 줄」이라는 참말이고, 조용히 남의 줄에 얹히지 않는다.
 */
export const NO_PLATE = /^\(?차번없음\)?$|^\(미기재\)$|^-$/;
export function rowKeyOf(head: readonly string[], row: readonly unknown[], keyCol = '차량번호', nameCol = '임차인'): string {
  const ki = head.indexOf(keyCol);
  const k = ki >= 0 ? S((row || [])[ki]) : '';
  if (k && !NO_PLATE.test(k)) return k;
  const ni = head.indexOf(nameCol);
  const nm = ni >= 0 ? S((row || [])[ni]) : '';
  return nm ? `${k || '(차번없음)'}·${nm}` : '';
}

/**
 * ★★★**우리가 «지난번에 찍은 것»을 적어 두는 자리.**
 *
 * ⚠⚠ **이게 없으면 우리 옛 출력이 「그쪽이 고친 칸」으로 잡힌다.** 실측 2026-09-07 —
 *   원장에서 116하2308 지급을 270,000 → 540,000 으로 고치고 다시 찍었더니,
 *   시트에 남아 있던 «우리가 지난번에 찍은» 270,000 이 「하허호가 270,000 으로 고쳤다」로 올라와
 *   그대로 다시 덮였다. 부가세·합계도 같은 길로 27,000 · 297,000 에 묶였다.
 *   ⇒ **맞대는 상대는 「우리 새 값」이 아니라 「우리가 지난번에 찍은 값」이다.**
 *     시트가 그것과 같으면 아무도 안 건드린 것이고, 다르면 그때가 «그쪽이 고친» 것이다.
 */
export const publishedId = (channel: string, month: string) =>
  `${channel}_${month}`.replace(/[.#$/[\]\s]/g, '_');
export type Published = { head: string[]; rows: (string | number | boolean)[][]; at: string };

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
  /**
   * ★★**줄 번호(No.)는 «고침»이 아니다.** 줄 차례가 바뀌면 무조건 달라진다 —
   *   오플이 아래로 내려가고, 줄이 하나 늘면 그 아래가 통째로 밀린다.
   *   실측 2026-09-07 — 검토 대기 68건 가운데 «절반이 No.»였다. 진짜 정정이 그 속에 묻힌다.
   */
  const skip = new Set(['No.']);
  const own = new Set(opts.theirOwn || ['확인', '메모']);
  const keyCol = opts.keyCol || '차량번호';
  const ki = head.indexOf(keyCol);
  if (ki < 0) return [];
  /** ★열쇠는 `rowKeyOf` 한 곳에서만 만든다 — 맞대는 쪽과 얹는 쪽이 갈리면 또 남의 줄에 얹힌다. */
  const K = (r: readonly unknown[]) => rowKeyOf(head, r, keyCol);

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
  for (const r of theirs) { const k = K(r || []); if (k) byKey.set(k, r); }

  const orphans: number[] = [];
  ours.forEach((o, i) => {
    const k = K(o);
    /** ★열쇠가 없는 줄(차번도 임차인도 없음)은 맞대지 않는다 — 어느 줄인지 알 수 없다. */
    const t = k ? byKey.get(k) : undefined;
    if (!t) { orphans.push(i); return; }
    head.forEach((h, c) => {
      if (own.has(h) || skip.has(h) || same(o[c], (t || [])[c])) return;
      out.push({ key: k, column: h, ours: S(o[c]), theirs: S((t || [])[c]) });
    });
  });

  /**
   * ★**차번을 고친 줄** — 짝을 못 찾은 우리 줄과, 우리한테 없는 시트 줄을 «자리»로 맞댄다.
   *   양쪽 다 하나씩 남았을 때만 짝으로 본다. 둘 이상이면 어느 것이 어느 것인지 알 수 없어 손대지 않는다.
   */
  const ourKeys = new Set(ours.map((o) => K(o)).filter(Boolean));
  const extra = theirs.filter((r) => { const k = K(r || []); return k && !ourKeys.has(k); });
  if (orphans.length === 1 && extra.length === 1) {
    const o = ours[orphans[0]]; const t = extra[0];
    /**
     * ⚠ **차번이 «둘 다» 있을 때만 자리로 맞댄다.** 한쪽이 무차번 줄이면 차번을 고친 것이 아니라
     *   «그쪽에만 있는 줄»일 가능성이 높다 — 그걸 짝으로 보면 남의 줄 값을 통째로 옮겨 오게 된다.
     */
    const real = (r: readonly unknown[]) => { const v = S((r || [])[ki]); return !!v && !NO_PLATE.test(v); };
    if (real(o) && real(t)) head.forEach((h, c) => {
      if (own.has(h) || skip.has(h) || same(o[c], (t || [])[c])) return;
      out.push({ key: K(o), column: h, ours: S(o[c]), theirs: S((t || [])[c]) });
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
  /**
   * ★★★**열쇠가 «(차번없음)» 하나면 그건 열쇠가 아니다** — `rowKeyOf` 가 임차인을 붙여 가른다.
   *   지원금·수수료 같은 «차가 없는» 줄은 차량번호가 다 「(차번없음)」이라, 그것만으로 맞대면
   *   한 줄에 적힌 고침이 다른 줄에까지 얹힌다 —
   *   실측 2026-09-07 사무실비 300,000 줄이 최사랑 100,000 으로 바뀌었다.
   */
  for (const r of rows) {
    /** ★열쇠는 `rowKeyOf` 가 만든다 — 차번이 없으면 임차인까지 붙어야 열쇠다. 그래도 없으면 넘어간다. */
    const k = rowKeyOf(head, r, opts.keyCol || '차량번호');
    if (!k) continue;
    for (const e of byKey.get(k) || []) {
      const c = head.indexOf(e.column);
      /** ★우리 값이 그새 바뀌었으면(원장을 고쳤으면) 얹지 않는다 — 그 고침은 이미 «끝난» 것이다. */
      if (c < 0 || S(r[c]) !== e.ours) continue;
      /**
       * ★★★**숫자 칸에 숫자가 아닌 것을 얹지 않는다.**
       *   2026-09-07 하허호 8월 탭 161허1334 의 「공급가액」 칸에 숫자 대신
       *   «(금액 안 적음 · 「정정」만 켜짐)» 이라는 **우리가 쓴 안내문**이 들어가 나갔다.
       *   ⇒ 상대에게 나가는 종이의 돈 칸이 글자가 되고, 옆의 부가세·합계(102,000 · 1,122,000)만
       *     남아 **그 줄 하나가 스스로 어긋난** 꼴이 됐다. 빈 값으로 지우는 것도 마찬가지다.
       *   ⇒ 얹을 값이 «수»가 아니면 우리 값을 그대로 둔다. 그쪽 뜻은 「정정」 체크와 메모가 이미 나른다.
       */
      if (!Number.isNaN(N(e.ours)) && Number.isNaN(N(e.theirs))) continue;
      /**
       * ★★★**「수수료 산정 기준」은 돈 칸의 «짝»이다 — 돈을 안 받으면 기준도 안 얹는다.**
       *
       * ⚠ 실측 2026-09-08 — 하허호가 161호1543 을 「차량가 8.5%」라 적었는데 금액은 아직 정해지지
       *   않아 우리 요율표 값(1,621,257 = 3.00%)이 서 있었다. 그 상태로 기준만 얹으니
       *   종이에 **「차량가 8.5%」 옆에 1,621,257** 이 나란히 찍혔다 — 8.5% 로 검산하면
       *   4,593,562 이라 우리 청구서가 스스로 틀린 말을 하는 꼴이다.
       *
       * ⇒ 기준은 «금액을 같이 받을 때»만 얹는다. 아직 사람이 안 정한 것은
       *   시트에 painted 되는 게 아니라 `review-sheet-edits` 에서 기다려야 한다.
       */
      if (e.column === '수수료 산정 기준') continue;
      r[c] = e.theirs; n++;
      /**
       * ★★★**공급가액을 얹으면 «부가세·합계»도 같이 다시 센다 — 아니면 줄이 스스로 어긋난다.**
       *
       * ⚠ 실측 2026-09-08 — 하허호가 46소3954 를 1,074,000 으로 정정했는데 공급가액 칸만 바뀌고
       *   부가세 102,600 · 합계 1,128,600 은 «우리 값(1,026,000)» 기준 그대로 남았다.
       *   사장님이 바로 보셨다 — 「공급가는 맞는데 **부가세 잘못 계산된 듯**」.
       *   한 줄 안에서 셋이 서로 다른 말을 하면, 상대는 어느 것을 믿어야 할지 모른다.
       */
      if (e.column === '공급가액') {
        const net = N(e.theirs);
        if (!Number.isNaN(net)) {
          const iv = head.indexOf('부가세'); const it = head.indexOf('합계');
          const vat = Math.round(net * 0.1);
          if (iv >= 0) r[iv] = vat;
          if (it >= 0) r[it] = net + vat;
        }
      }
    }
  }
  return n;
}
