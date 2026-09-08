'use client';
/**
 * 고르는 칸의 **버튼 줄** — 견적기 왼쪽이 쓰는 유일한 「고르기」 원자.
 *
 * ★★사장님 2026-09-08 「야 근데 **드랍다운보다는 버튼으로 할 수 있으면 버튼으로 해**」
 *   원본 웰릭스는 왼쪽을 전부 드롭다운(`CustomDropdown`)으로 세웠지만, 드롭다운은 «두 번» 누른다 —
 *   열고, 고른다. 통화하면서 여는 화면이라 그 한 걸음이 그대로 느려짐이 된다.
 *   ⇒ 눈에 다 보이면 **한 번**에 끝난다. 그래서 버튼이다.
 *
 * ★그래도 «얇아야» 한다(사장님 2026-09-08 「저렇게 굵을 필요 없고」) —
 *   칩은 26px 한 단이고, 줄이 길어지는 칸(제조사·모델)은 `scroll` 로 키를 묶는다.
 *   묶지 않으면 제조사 열일곱·세부모델 수십이 왼쪽을 통째로 밀어낸다.
 *
 * ⚠ 이건 업무동 원자(`components/ui`)가 아니다 — 견적기는 제 규격(웰릭스 토큰)을 쓰는 층이라
 *   `Btn`/`FilterChips` 를 끼우면 치수·색이 어긋난다. 대신 **견적기 안에서는 이것 하나만** 쓴다.
 */
export type ChipOpt<T> = {
  v: T;
  label: string;
  /** 라벨 옆 작은 글씨 — 「97%」처럼 고를 때 알아야 하는 값. */
  sub?: string;
  /** 색 칩 — 색상마스터가 준 값만 넣는다(화면이 색을 지어내지 않는다). */
  swatch?: string;
  disabled?: boolean;
};

export default function Chips<T extends string | number>({ opts, cur, onPick, scroll, empty }: {
  opts: ChipOpt<T>[];
  cur: T | '' | null;
  onPick: (v: T) => void;
  /** 줄이 길어지는 칸(제조사·모델) — 키를 묶고 제 안에서 굴린다. */
  scroll?: boolean;
  /** 고를 것이 아직 없을 때 할 말. 「없다」와 「아직 못 받았다」는 다르다. */
  empty?: string;
}) {
  if (!opts.length) return <div className="empty-state">{empty ?? '고를 것이 없습니다'}</div>;
  return (
    <div className={`wxchips${scroll ? ' scroll' : ''}`}>
      {opts.map((o) => (
        <button key={String(o.v)} type="button" disabled={o.disabled}
          className={`wxchip${String(o.v) === String(cur) ? ' on' : ''}`}
          onClick={() => onPick(o.v)}>
          {o.swatch ? <span className="sw" style={{ background: o.swatch }} /> : null}
          {o.label}
          {o.sub ? <em>{o.sub}</em> : null}
        </button>
      ))}
    </div>
  );
}
