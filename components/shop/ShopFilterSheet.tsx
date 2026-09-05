'use client';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { C, FW, ICON } from '@/components/ui';
import { SHOP, ShopIconBtn, ShopTextBtn } from '@/components/shop/shop-ui';
import { ShopAxisOptions } from '@/components/shop/ShopFilters';
import { AXIS_LABEL, SHOP_AXES, type ShopAxis, type ShopFacets, type ShopSel } from '@/lib/shop/query';

/**
 * 폰 상세 조건 시트 — **왼쪽 축 목록 · 오른쪽 값** 두 칸.
 *
 * 사장님 2026-09-04 「상세 필터 올라왔을 때 저렇게 상하로만 쭉 나열되는 건 아닌 거 같은데,
 * 다른 것들 저렇게 안 하는 걸로 알고 있는데」 — 맞다.
 *
 * 처음엔 축 아홉을 한 줄로 쭉 쌓았는데, 그러면
 *   ㉠ 밑에 무슨 축이 더 있는지 **보이지 않는다.** 제조사 열둘·연식 열다섯을 지나야 연료가 나온다.
 *   ㉡ 하나 고르고 다른 축으로 가려면 매번 길게 긁어야 한다.
 *   ㉢ 「지금 무엇을 고르는 중인지」가 화면에 안 남는다.
 * 한국 커머스 앱(다나와·에누리·11번가·무신사)이 공통으로 쓰는 짜임이 **두 칸**인 이유가 그거다.
 * 왼쪽은 축 이름만 세로로 세워 «전체 지도»를 늘 보여 주고, 오른쪽만 갈아 끼운다.
 *
 * ★두 칸은 **따로 구른다.** 오른쪽에서 제조사를 열둘 내려도 왼쪽 지도는 제자리에 있어야 한다.
 * ★값 부분은 웹 기둥과 «같은 원자»(`ShopAxisOptions`)다 — 두 벌로 갈라 두면 웹에서 고른 값이
 *   폰에서 다른 모양으로 떠서 그때부터 아무도 안 믿는다.
 * ★적용/취소를 두지 않는다. 고르는 즉시 반영되고 바닥 버튼은 「N대 보기」로 **결과 수만 말한다** —
 *   손님이 몇 대가 될지 보고 닫는다. 취소 단추를 두면 「지금 화면의 목록」과 「시트 안의 선택」이
 *   갈려서, 닫기 전까지 어느 쪽이 진짜인지 알 수 없다.
 */
export function ShopFilterSheet({ facets, sel, onToggle, onClearAxis, onClearAll, resultCount, onClose }: {
  facets: ShopFacets;
  sel: ShopSel;
  onToggle: (axis: ShopAxis, key: string) => void;
  onClearAxis: (axis: ShopAxis) => void;
  onClearAll: () => void;
  /** 지금 조건으로 남는 대수 — 바닥 버튼이 이 숫자를 든다. */
  resultCount: number;
  onClose: () => void;
}) {
  /** 값이 하나도 없는 축은 아예 안 세운다 — 눌러도 빈 칸이 나오는 이름을 지도에 두지 않는다. */
  const axes = useMemo(() => SHOP_AXES.filter((a) => facets[a].length), [facets]);
  const [active, setActive] = useState<ShopAxis>(axes[0] ?? 'vc');

  /*
   * 조건을 좁히다 보면 «지금 보고 있던 축»이 통째로 사라질 수 있다(값이 다 0대가 되어서).
   * 그때 오른쪽이 빈 채로 남으면 고장 난 것처럼 보이므로 첫 축으로 되돌린다.
   */
  useEffect(() => {
    if (axes.length && !axes.includes(active)) setActive(axes[0]);
  }, [axes, active]);

  const total = SHOP_AXES.reduce((n, a) => n + sel[a].length, 0);

  return (
    <div role="dialog" aria-label="상세 조건"
      style={{
        position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.42)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18,
          // 시트가 화면을 다 덮으면 뒤 목록이 안 보여 «어디로 돌아가는지»를 잃는다. 위를 조금 남긴다.
          height: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: SHOP.sp.cozy,
          padding: `${SHOP.sp.cozy}px ${SHOP.sp.edge}px`, borderBottom: `1px solid ${C.line2}`, flex: '0 0 auto',
        }}>
          <span style={{ fontSize: SHOP.fs.h2, fontWeight: 700 }}>상세 조건</span>
          <div style={{ flex: 1 }} />
          {total ? <ShopTextBtn onClick={onClearAll}>초기화</ShopTextBtn> : null}
          <ShopIconBtn onClick={onClose} label="닫기"><X size={ICON.lg} aria-hidden /></ShopIconBtn>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* 왼쪽 — 축 지도. 고른 축은 흰 면으로 «떠올라» 오른쪽과 이어져 보인다. */}
          <nav aria-label="조건 항목" style={{
            width: 116, flex: '0 0 116px', overflowY: 'auto',
            background: C.zebra, borderRight: `1px solid ${C.line2}`,
          }}>
            {axes.map((axis) => {
              const on = axis === active;
              const n = sel[axis].length;
              return (
                <button key={axis} type="button" onClick={() => setActive(axis)} className="fp-shop-press"
                  aria-current={on ? 'true' : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: SHOP.sp.snug, width: '100%',
                    padding: `0 ${SHOP.sp.snug}px 0 ${SHOP.sp.cozy}px`, height: 50, textAlign: 'left', cursor: 'pointer',
                    border: 'none', borderLeft: `3px solid ${on ? C.brand : 'transparent'}`,
                    background: on ? C.bg : 'transparent', fontFamily: 'inherit',
                    fontSize: SHOP.fs.sub, fontWeight: on ? 700 : 500,
                    color: on ? C.ink : C.sub,
                  }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {AXIS_LABEL[axis]}
                  </span>
                  {n ? (
                    // 고른 개수 — 다른 축으로 넘어가도 «어디에 뭘 걸어 뒀는지»가 지도에 남는다.
                    <span style={{
                      /* 건수 동그라미 — 원이 제 모양이다(사다리의 pill 칸). */
                      flex: '0 0 auto', minWidth: 16, height: 16, padding: '0 4px', borderRadius: SHOP.r.pill,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: C.brand, color: C.inverse,
                      fontSize: 10, fontWeight: FW.strong, fontVariantNumeric: 'tabular-nums',
                    }}>{n}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          {/* 오른쪽 — 고른 축의 값. 왼쪽과 «따로» 구른다. */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: `${SHOP.sp.edge}px ${SHOP.sp.edge}px ${SHOP.sp.part}px` }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: SHOP.sp.edge,
            }}>
              <span style={{ fontSize: SHOP.fs.body, fontWeight: 700, color: C.ink }}>{AXIS_LABEL[active]}</span>
              {sel[active].length ? (
                <ShopTextBtn tone="faint" onClick={() => onClearAxis(active)}>해제</ShopTextBtn>
              ) : null}
            </div>
            {/*
              시트의 오른쪽 칸은 227px 라 두 열이면 한 칸이 95 밖에 안 된다 — 「하이브리드」가
              「하이브…」로 잘렸다(2026-09-04 실측). 그래서 **한 열**이다.
              ⚠⚠ 연식만 두 열로 뒀다가 걷었다(사장님 2026-09-06 「필터 연식이 두 줄로 돼 있어가지고
                좀 짤리는 게 있고」). 글자가 잘린 건 아니었고 **건수가 옆 칸 라벨에 붙어** 읽혔다 —
                `2026 … 128 │ 2025 … 75` 에서 128 이 제 라벨과 40px, 옆 라벨과 12px 였다.
              ★스크롤이 길어지는 건 「더보기」가 이미 막고 있다(머리 여덟 줄만 세운다).
                한 열이 길다고 두 열로 접으면 **읽는 사람이 숫자를 잘못 묶는다** — 길이보다 그게 비싸다.
            */}
            <ShopAxisOptions axis={active} options={facets[active] ?? []} selected={sel[active] ?? []}
              onToggle={onToggle} mobile columns={1} />
          </div>
        </div>

        <div style={{ padding: `${SHOP.sp.cozy}px ${SHOP.sp.edge}px ${SHOP.sp.edge}px`, borderTop: `1px solid ${C.line2}`, flex: '0 0 auto' }}>
          <button type="button" onClick={onClose} className="fp-shop-press"
            style={{
              width: '100%', height: 52, borderRadius: SHOP.r.ctrl, border: 'none', cursor: 'pointer',
              background: C.brand, color: C.inverse, fontFamily: 'inherit',
              fontSize: SHOP.fs.body, fontWeight: 700,
            }}>
            {resultCount.toLocaleString('ko-KR')}대 보기
          </button>
        </div>
      </div>
    </div>
  );
}
