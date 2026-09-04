'use client';
import { C, FS, FW, R_CARD } from '@/components/ui';

/**
 * 손님 카탈로그 조건칸 — **시안 그대로**(사장님 2026-09-04 「그 필터 방식이나 이런 거 네가 설계한 거대로」).
 *
 * ★업무동 `FilterGroup`(접이식 ∨ 제목)을 쓰지 않는다. 그건 하루 종일 콕핏을 보는 사람이
 *   축을 접었다 폈다 하려고 만든 것이고, 손님은 **한눈에 다 보이는 편**이 낫다.
 *   그렇다고 `FilterGroup` 을 고치면 프리패스 상품찾기가 같이 바뀐다 — 그래서 여기 따로 둔다.
 *   (건물도면 「손님 동 = ERP 얼굴을 쓰지 않는 게 규격」)
 *
 * ★페이지가 손롤하지 않게 **여기가 원자**다. 화면은 축 목록만 넘긴다.
 * ★색은 토큰만 쓴다 — `.fp-wl` 이 브랜드색으로 뒤집으므로 채널이 바뀌면 알아서 따라온다.
 *
 * 짜임(시안):
 *   전체차량 716 대
 *   ─────────────── 검정 1px
 *   필터                     초기화
 *   차종        ○ 승용  ○ SUV        ← 2열 체크
 *   제조사      ○ 현대 148 …          ← 세로 목록 + 건수
 *   월 대여료   [50만↓][50~60만]      ← 2열 사각 버튼
 *   심사·혜택   (칩 줄)
 */

export type FilterOption = { key: string; label: string; count?: number };

export type FilterAxis = {
  /** 축 이름 — 굵은 고정 제목. 접히지 않는다. */
  title: string;
  /**
   * 어떻게 고르나.
   *   check — 동그란 표식 + 라벨(2열). 「무엇인가」를 고르는 축(차종·제조사).
   *   grid  — 2열 사각 버튼. 「어느 구간인가」를 고르는 축(금액·거리).
   *   chip  — 흐르는 칩 줄. 짧은 낱말이 여럿인 축(심사·혜택).
   */
  kind: 'check' | 'grid' | 'chip';
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
  /** check 축의 열 수. 라벨이 길면 1열이 낫다(제조사는 건수가 붙어 1열). */
  columns?: 1 | 2;
};

/** 고른 것 = 브랜드색 채움. 안 고른 것 = 테두리만. 모양은 하나, 위계는 색으로 낸다. */
const picked = (on: boolean) => ({
  border: `1px solid ${on ? C.brand : C.line}`,
  background: on ? C.brand : 'transparent',
  color: on ? C.inverse : C.sub,
  fontWeight: on ? FW.title : FW.body,
});

export function CatalogFilters({ axes, count, onClearAll, mobile }: {
  axes: FilterAxis[];
  /** 「전체차량 N대」 — 조건칸의 머리다. 목록이 오기 전엔 `—`. */
  count: string;
  onClearAll?: () => void;
  mobile?: boolean;
}) {
  const anyOn = axes.some((a) => a.selected.size > 0);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, paddingBottom: mobile ? 12 : 18 }}>
        <span style={{ fontSize: mobile ? FS.sub : FS.body, fontWeight: FW.meta, color: C.mute }}>전체차량</span>
        <span style={{
          fontSize: mobile ? 22 : 26, fontWeight: FW.head, color: C.brand,
          letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
        }}>{count}</span>
        <span style={{ fontSize: mobile ? FS.sub : FS.body, fontWeight: FW.title }}>대</span>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingBottom: 12, borderBottom: `1px solid ${C.ink}`,
      }}>
        <span style={{ fontSize: 17, fontWeight: FW.title, color: C.ink }}>필터</span>
        {anyOn && onClearAll ? (
          <button type="button" onClick={onClearAll}
            style={{
              padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: FS.sub, color: C.mute, fontFamily: 'inherit',
            }}>초기화</button>
        ) : null}
      </div>

      {axes.filter((a) => a.options.length).map((a) => (
        <section key={a.title} style={{ padding: '18px 0', borderBottom: `1px solid ${C.line2}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 14.5, fontWeight: FW.title, color: C.ink }}>{a.title}</span>
            {a.selected.size ? (
              <button type="button" onClick={a.onClear}
                style={{
                  padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                  fontSize: FS.cap, color: C.faint, fontFamily: 'inherit',
                }}>해제</button>
            ) : null}
          </div>

          {a.kind === 'check' ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${a.columns ?? 2}, minmax(0, 1fr))`,
              gap: '12px 10px',
            }}>
              {a.options.map((o) => {
                const on = a.selected.has(o.key);
                return (
                  <button key={o.key} type="button" onClick={() => a.onToggle(o.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: 0,
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 14, textAlign: 'left',
                      color: on ? C.ink : C.sub, fontWeight: on ? FW.title : FW.body,
                    }}>
                    <span aria-hidden style={{
                      width: 16, aspectRatio: '1 / 1', borderRadius: 999, flex: '0 0 auto',
                      border: `1.5px solid ${on ? C.brand : C.line}`,
                      background: on ? C.brand : 'transparent',
                      boxShadow: on ? `inset 0 0 0 3px ${C.bg}` : undefined,
                    }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                    {o.count != null ? (
                      <span style={{ fontSize: FS.sub, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>{o.count}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {a.kind === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {a.options.map((o) => {
                const on = a.selected.has(o.key);
                return (
                  <button key={o.key} type="button" onClick={() => a.onToggle(o.key)}
                    style={{
                      padding: '9px 4px', borderRadius: R_CARD, cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 13, ...picked(on),
                    }}>{o.label}</button>
                );
              })}
            </div>
          ) : null}

          {a.kind === 'chip' ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {a.options.map((o) => {
                const on = a.selected.has(o.key);
                return (
                  <button key={o.key} type="button" onClick={() => a.onToggle(o.key)}
                    style={{
                      padding: '8px 13px', borderRadius: R_CARD, cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 13, ...picked(on),
                    }}>{o.label}</button>
                );
              })}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
