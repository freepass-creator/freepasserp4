/**
 * **접수 날짜 — 한 칸 한 원자.**
 *
 * ★사장님 2026-08-26
 *   「접수일 접수년 접수월 이렇게 돼있잖아 이거 순서를 접수년 접수월 접수일 그냥 숫자만 입력하게 할까」
 *   「한칸에 하나씩 하면 필터 잡기도 편하고 / 년 월 일 만 쓰면 될거 같은데」
 *   「청구는 청구년 청구월 만 잇으면 되고」
 *   「청구에 가져갈때는 조합해서 접수일자로 한칸 따로 만들어주면 되고 — 26 08 26-07-23 이렇게」
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★**두 모양이 같이 산다.** 원장을 한 번에 다 못 바꾸므로 읽는 쪽이 둘 다 알아야 한다.
 * ```
 * 옛 모양   접수일 = 46092            (구글 시리얼 날짜 한 칸)
 * 새 모양   접수년 26 · 접수월 8 · 접수일 23   (숫자 셋, 한 칸 한 원자)
 * ```
 *   ★가르는 기준은 **접수일 칸의 크기**다. 20000 을 넘으면 시리얼이고, 1~31 이면 「일」이다.
 *     날짜 시리얼은 2024년이 45000대라 「일」과 겹칠 수가 없다.
 *
 * ★★★**줄 열쇠가 여기 걸려 있다.** 줄은 «차량번호 + 접수일»로 찾는다.
 *   「일」만 보면 같은 달 같은 차의 다른 줄을 구별 못 한다 — 실측 431줄에서 이미 1건 겹친다.
 *   그래서 열쇠는 언제나 **년·월·일 셋을 다 합쳐** 만든다. 이 파일이 그것을 책임진다.
 *
 * ⚠ **두 자리 연도 함정.** 구글 시트는 `26-07-23` 을 날짜로 해석하면서 26 을 **1926**으로 읽는다.
 *   조합 칸(`접수일자`)은 반드시 **문자로(RAW)** 써야 한다. `USER_ENTERED` 로 쓰면 1926년이 된다.
 *   ⚠ 반대로 년·월·일 칸은 «숫자»다. 거기에 따옴표를 붙이면 필터·정렬이 문자로 돌아 못 쓴다.
 */

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown): number => {
  const n = Number(S(v).replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/** 구글 시트 날짜 0일. `Date.UTC(1899,11,30)` */
const SERIAL0 = Date.UTC(1899, 11, 30);

/** 시리얼로 볼 수 있는 최소값 — 이보다 크면 날짜, 작으면 「일」. */
const SERIAL_MIN = 20_000;

/**
 * 두 자리 연도를 네 자리로. `26` → `2026`.
 * ★우리 자료는 2024년부터다. 두 자리면 2000년대로 읽는다 — 1926년일 리가 없다.
 */
export const fullYear = (v: unknown): number => {
  const y = N(v);
  if (!Number.isFinite(y) || y <= 0) return NaN;
  if (y >= 1000) return y;
  return y < 100 ? 2000 + y : NaN;
};

/**
 * **원장 한 줄의 접수 날짜.** 새 모양(년·월·일)이 먼저고, 없으면 옛 모양(시리얼)으로 떨어진다.
 *
 * @param y  접수년 칸 (26 또는 2026)
 * @param m  접수월 칸 (1~12)
 * @param d  접수일 칸 (1~31 이면 「일」, 20000 넘으면 옛 시리얼)
 */
export function receivedDate(y: unknown, m: unknown, d: unknown): Date | null {
  const day = N(d);

  // 옛 모양 — 접수일 한 칸에 날짜가 통째로 들어 있다
  if (Number.isFinite(day) && day >= SERIAL_MIN) {
    const u = new Date(SERIAL0 + Math.round(day) * 86_400_000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  // 옛 모양 — 문자로 적힌 날짜(`2026-07-23`)
  if (!Number.isFinite(day)) {
    const t = S(d);
    if (!t) return null;
    const x = new Date(t);
    return Number.isNaN(+x) ? null : new Date(x.getFullYear(), x.getMonth(), x.getDate());
  }

  // 새 모양 — 셋을 합친다
  const yy = fullYear(y);
  const mm = N(m);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || mm < 1 || mm > 12) return null;
  if (day < 1 || day > 31) return null;
  const made = new Date(yy, mm - 1, day);
  // ★2월 30일 같은 걸 조용히 3월 2일로 넘기지 않는다. 틀린 값은 «모른다»여야 한다.
  return made.getFullYear() === yy && made.getMonth() === mm - 1 && made.getDate() === day ? made : null;
}

/** 한 줄이 새 모양으로 적혀 있나 — 이관이 끝났는지 재는 데 쓴다. */
export const isSplitShape = (d: unknown): boolean => {
  const n = N(d);
  return Number.isFinite(n) && n >= 1 && n <= 31;
};

/**
 * **조합 칸 「접수일자」** — 청구로 가져갈 때 한 칸으로 쓴다. `26-07-23`
 *
 * ⚠ 이 값을 시트에 쓸 때는 **RAW** 로 쓴다. `USER_ENTERED` 면 구글이 날짜로 해석해
 *   **1926년 7월 23일**이 된다(두 자리 연도 함정).
 */
export const ymdText = (d: Date | null): string => (d
  ? `${String(d.getFullYear() % 100).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : '');

/** `2026-07-23` — 줄 열쇠·저장에 쓰는 완전한 모양. 사람이 보는 자리엔 `ymdText` 를 쓴다. */
export const isoText = (d: Date | null): string => (d
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : '');

/** 년·월·일 세 칸에 넣을 «숫자» 셋. 연도는 두 자리로 적는다(사장님 표기: `26 08 23`). */
export const splitCells = (d: Date | null): { y: number | ''; m: number | ''; d: number | '' } => (d
  ? { y: d.getFullYear() % 100, m: d.getMonth() + 1, d: d.getDate() }
  : { y: '', m: '', d: '' });

/**
 * **청구 년·월** — 청구는 「일」이 없다(사장님: 「청구는 청구년 청구월 만 잇으면 되고」).
 * `2026-08` ↔ 년 26 · 월 8.
 */
export const billMonthOf = (y: unknown, m: unknown): string => {
  const yy = fullYear(y);
  const mm = N(m);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || mm < 1 || mm > 12) return '';
  return `${yy}-${String(mm).padStart(2, '0')}`;
};

/** `2026-08` → 년 26 · 월 8. 시트에 되돌려 쓸 때. */
export const billCells = (month: string): { y: number | ''; m: number | '' } => {
  const x = /^(\d{4})-(\d{2})$/.exec(S(month));
  return x ? { y: Number(x[1]) % 100, m: Number(x[2]) } : { y: '', m: '' };
};
