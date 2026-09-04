'use client';
import { C } from '@/components/ui';
import { SHOP, ShopTextBtn } from '@/components/shop/shop-ui';
import { useIsMobile } from '@/lib/use-mobile';
import { AXIS_LABEL, SHOP_AXES, type ShopAxis, type ShopFacets, type ShopSel } from '@/lib/shop/query';

/**
 * 가게 조건칸 — 왼쪽 기둥.
 *
 * ★업무동 `FilterGroup`(접이식 ∨ 제목)을 쓰지 않는다. 그건 콕핏에서 축을 접었다 폈다 하려고
 *   만든 것이고, 손님은 **한눈에 다 보이는 편**이 낫다. 접혀 있으면 무슨 조건이 있는지 모른 채
 *   목록만 훑다 나간다. 그렇다고 `FilterGroup` 을 고치면 프리패스 상품찾기가 같이 바뀐다.
 *
 * ★축마다 «고르는 모양»이 다른 데는 이유가 있다.
 *   ㉠ 원형 표식 + 건수  — 「무엇인가」를 고르는 축(차종·제조사·연식·연료·심사·혜택).
 *      건수가 붙어야 손님이 «큰 갈래부터» 좁힌다. 마켓의 기본형이다.
 *   ㉡ 사각 두 열       — 「어느 구간인가」를 고르는 축(월 대여료·보증금·주행거리).
 *      금액 구간은 라벨이 짧고 서로 나란해야 비교가 되므로 격자로 세운다.
 *
 * ★★건수는 «그 축을 뺀 나머지 조건»으로 세어 들어온다(`runShopQuery` 교차 집계).
 *   여기서 다시 세지 않는다 — 화면이 또 세면 그 순간 숫자가 두 군데서 나온다.
 */

/** 원형 표식 축을 몇 열로 세울까 — 라벨이 길거나 건수가 붙으면 한 열이 낫다. */
const COLUMNS: Partial<Record<ShopAxis, 1 | 2>> = { vc: 2, maker: 1, year: 2, fuel: 2, credit: 2, perk: 1 };
/** 구간 축 = 사각 두 열. 나머지는 원형 표식. */
const BAND_AXES: ShopAxis[] = ['rent', 'dep', 'mile'];

export function ShopFilters({ facets, sel, onToggle, onClearAxis, mobile: forceMobile }: {
  facets: ShopFacets;
  sel: ShopSel;
  onToggle: (axis: ShopAxis, key: string) => void;
  onClearAxis: (axis: ShopAxis) => void;
  mobile?: boolean;
}) {
  const isMobile = useIsMobile();
  const mobile = forceMobile ?? isMobile;

  return (
    <div>
      {SHOP_AXES.filter((a) => facets[a].length).map((axis, i) => {
        const options = facets[axis];
        const on = sel[axis];
        return (
          <section key={axis} style={{
            padding: i === 0 ? '0 0 18px' : '18px 0',
            borderBottom: `1px solid ${C.line2}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: SHOP.fs.body, fontWeight: 700, color: C.ink }}>{AXIS_LABEL[axis]}</span>
              {on.length ? <ShopTextBtn tone="faint" onClick={() => onClearAxis(axis)}>해제</ShopTextBtn> : null}
            </div>

            {BAND_AXES.includes(axis) ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {options.map((o) => (
                  <BandBox key={o.key} label={o.label} count={o.count}
                    on={on.includes(o.key)} onClick={() => onToggle(axis, o.key)} />
                ))}
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${COLUMNS[axis] ?? 2}, minmax(0, 1fr))`,
                gap: mobile ? '14px 10px' : '12px 10px',
              }}>
                {options.map((o) => (
                  <CheckRow key={o.key} label={o.label} count={o.count}
                    on={on.includes(o.key)} onClick={() => onToggle(axis, o.key)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** 원형 표식 한 줄 — 켜지면 브랜드색 고리 안에 점이 든다. 체크박스보다 「하나의 갈래」로 읽힌다. */
function CheckRow({ label, count, on, onClick }: {
  label: string; count: number; on: boolean; onClick: () => void;
}) {
  const mobile = useIsMobile();
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: 0,
        border: 'none', background: 'transparent', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'left', minWidth: 0,
        fontSize: mobile ? SHOP.fs.body : 14,
        color: on ? C.ink : C.sub, fontWeight: on ? 700 : 400,
      }}>
      <span aria-hidden style={{
        width: 17, aspectRatio: '1 / 1', borderRadius: 999, flex: '0 0 auto',
        border: `1.5px solid ${on ? C.brand : C.line}`,
        background: on ? C.brand : 'transparent',
        boxShadow: on ? `inset 0 0 0 3.5px ${C.bg}` : undefined,
      }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ fontSize: SHOP.fs.cap, color: C.faint, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }}>
        {count}
      </span>
    </button>
  );
}

/**
 * 구간 상자 — 두 열 격자. 금액을 나란히 놓아 비교가 되게 한다.
 * 건수는 «작게 아래»에 둔다. 라벨과 같은 줄에 놓으면 「50~60만 128」이 한 금액처럼 읽힌다.
 */
function BandBox({ label, count, on, onClick }: {
  label: string; count: number; on: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        padding: '9px 4px', borderRadius: SHOP.r.box, cursor: 'pointer', fontFamily: 'inherit',
        border: `1px solid ${on ? C.brand : C.line}`,
        background: on ? C.brand : 'transparent',
        color: on ? C.inverse : C.sub,
      }}>
      <span style={{ fontSize: SHOP.fs.sub, fontWeight: on ? 700 : 500 }}>{label}</span>
      <span style={{ fontSize: SHOP.fs.cap, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </button>
  );
}
