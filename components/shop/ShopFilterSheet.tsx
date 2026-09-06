'use client';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { C, FW, ICON, SCRIM } from '@/components/ui';
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
 * ★★**바닥은 «꽉 채운 두 칸»** — 비주요(닫기) 고정폭 92 · 주요(적용) 나머지 전부
 *   (사장님 2026-09-06 「모바일 페이지는 **하단 바 버튼을 잘 활용**해야 돼. 필터 같은 경우에도
 *   **닫기 버튼이 좌측에 있고 적용 버튼이 있어야지**」). 집 규격의 하단 실행독과 같은 짜임이고,
 *   상세 하단독(`이전` + `전화 상담`)이 이미 그 꼴이다 — 시트만 한 칸이었다.
 *
 * ⚠⚠ **여기 「적용/취소를 두지 않는다」가 적혀 있었다**(2026-09-04). 이유는 「취소를 두면 화면의
 *   목록과 시트 안의 선택이 갈려서, 닫기 전까지 어느 쪽이 진짜인지 알 수 없다」였다. 맞는 걱정이다.
 *   ⇒ 그 걱정은 **버튼이 결과 수를 이고** 있으면 사라진다 — 「357대 보기」라고 적힌 순간
 *     시트 안의 선택이 «앞으로 될 값»임이 화면에 쓰여 있다. 무신사·다나와·에어비앤비가 다 이 꼴이다.
 * ★그래서 고르는 것은 **초안(draft)**이다. 적용을 눌러야 목록이 바뀌고, 닫기는 되돌린다.
 *   축 목록·건수도 초안으로 센다(`preview`) — 안 그러면 버튼 숫자와 옆의 건수가 서로 다른 말을 한다.
 */
export function ShopFilterSheet({ sel, preview, onApply, onClose }: {
  /** 지금 «화면»에 걸린 조건 — 시트를 열 때 초안의 출발점이다. */
  sel: ShopSel;
  /** 초안으로 세어 본다 — 축 목록과 바닥 버튼 숫자가 **같은 값**에서 나와야 한다. */
  preview: (sel: ShopSel) => { facets: ShopFacets; count: number };
  /** 적용 — 초안을 목록에 싣고 닫는다. */
  onApply: (sel: ShopSel) => void;
  /** 닫기 — 초안을 버리고 닫는다(위 머리말). */
  onClose: () => void;
}) {
  /* 초안 — 시트는 열릴 때마다 새로 뜨므로 여기서 한 번만 복사하면 된다. */
  const [draft, setDraft] = useState<ShopSel>(sel);
  const { facets, count: resultCount } = useMemo(() => preview(draft), [preview, draft]);
  const onToggle = (axis: ShopAxis, key: string) => setDraft((d) => ({
    ...d, [axis]: d[axis].includes(key) ? d[axis].filter((x) => x !== key) : [...d[axis], key],
  }));
  const onClearAxis = (axis: ShopAxis) => setDraft((d) => ({ ...d, [axis]: [] }));
  const onClearAll = () => setDraft(
    Object.fromEntries(SHOP_AXES.map((a) => [a, [] as string[]])) as unknown as ShopSel,
  );

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

  const total = SHOP_AXES.reduce((n, a) => n + draft[a].length, 0);

  return (
    <div role="dialog" aria-label="상세 조건"
      style={{
        /* 딤은 토큰이다 — 생 rgba 를 쓰면 다크 테마에서 같이 안 뒤집힌다(check:tokens 가 잡는다). */
        position: 'fixed', inset: 0, zIndex: 40, background: SCRIM.heavy,
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
          {/*
            ⚠⚠ **여기 X(닫기)가 있었다. 뺐다**(사장님 2026-09-06 「버튼이 닫기 버튼이 있는데
              **위쪽에 또 X 표가 있을 필요 없고** … 한 페이지에 **같은 버튼이 굳이 두 개**가
              있을 필요가 없잖아」). 바닥 독에 「닫기」가 생기면서 이 X 는 같은 일을 하는 둘째 문이 됐다.
            ★남는 것은 **초기화**뿐이다 — 그건 「닫기」와 다른 일(조건을 지운다)이라 중복이 아니다.
            ★뒤 어두운 바탕을 눌러도 닫힌다 — 그건 «버튼»이 아니라 시트의 관습이라 문이 아니다.
          */}
          {total ? <ShopTextBtn onClick={onClearAll}>초기화</ShopTextBtn> : null}
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
                      fontSize: SHOP.fs.tag, fontWeight: FW.strong, fontVariantNumeric: 'tabular-nums',
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
              {draft[active].length ? (
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
            <ShopAxisOptions axis={active} options={facets[active] ?? []} selected={draft[active] ?? []}
              onToggle={onToggle} mobile columns={1} />
          </div>
        </div>

        {/*
          ★**꽉 채운 두 칸** — 비주요(닫기) 고정폭 92 · 주요(적용) 나머지 전부.
            집 규격의 하단 실행독과 같은 짜임이고, 상세 하단독(`이전`+`전화 상담`)과도 같은 꼴이다.
          ★주요 버튼이 **결과 수를 인다** — 「357대 보기」가 곧 「적용하면 이만큼 남는다」다.
            그래서 초안과 화면이 갈려도 어느 쪽이 «앞으로 될 값»인지 화면에 쓰여 있다(머리말).
          ⚠ 비주요를 «감싸지» 않는다 — 폭 규칙이 직계 자식에 걸린다(집 규격 하단독과 같은 함정).
        */}
        <div style={{
          padding: `${SHOP.sp.cozy}px ${SHOP.sp.edge}px ${SHOP.sp.edge}px`,
          borderTop: `1px solid ${C.line2}`, flex: '0 0 auto',
          display: 'flex', alignItems: 'center', gap: SHOP.sp.snug,
        }}>
          <button type="button" onClick={onClose} className="fp-shop-press fp-shop-fill"
            style={{
              flex: '0 0 92px', height: 52, borderRadius: SHOP.r.ctrl, border: 'none', cursor: 'pointer',
              /* 비주요 = 회색 면(가게 공통 — `ShopPill` 머리말). 테두리로 가두지 않는다. */
              background: C.head, color: C.ink, fontFamily: 'inherit',
              fontSize: SHOP.fs.body, fontWeight: 600,
            }}>
            닫기
          </button>
          <button type="button" onClick={() => onApply(draft)} className="fp-shop-press"
            style={{
              flex: 1, minWidth: 0, height: 52, borderRadius: SHOP.r.ctrl, border: 'none', cursor: 'pointer',
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
