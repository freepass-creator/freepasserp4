'use client';
import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { C } from '@/components/ui';
import { SHOP, ShopTextBtn } from '@/components/shop/shop-ui';
import { useIsMobile } from '@/lib/use-mobile';
import { AXIS_LABEL, SHOP_AXES, type ShopAxis, type ShopFacets, type ShopSel } from '@/lib/shop/query';

/**
 * 가게 조건칸 — 왼쪽 기둥.
 *
 * ★★★**중고차 사이트의 «무난한» 짜임을 따른다**(사장님 2026-09-05 「진짜 해야 될 거는 이제
 *   **좌측에 필터** … 중고차 사이트를 많이 학습해서 그냥 **무난하게 필터를 좀 잡아** 주면 될 것 같아」).
 *   2026-09-05 에 엔카(142,123대)·케이카(7,458대) 목록 화면을 열어 실제로 재 봤다. 둘의 공통점:
 *     ㉠ 축은 **접이식**이다. 다 펼쳐 두지 않는다 — 엔카는 「차종 ▾ 제조사 ▾ 연식 ▾ 주행거리 ▾ 가격 ▾ …」
 *        이름만 세로로 서 있고 지금 쓰는 축 하나만 열려 있다.
 *     ㉡ 항목은 **이름 + 건수(우측 정렬, 흐린 글씨)**. 케이카는 「현대 … 2,618대」.
 *     ㉢ **여러 개 고를 수 있다**고 알려 준다(케이카 「중복선택가능」). 그래서 표식이 **네모**다.
 *     ㉣ 맨 위에 **총 대수 + 선택 초기화**가 붙는다.
 *     ㉤ 제조사처럼 긴 목록은 **상위 몇 개만** 보이고 나머지는 「더보기」로 접는다.
 *
 * ⚠ 여기 원래 주석은 「접이식을 쓰지 않는다 — 손님은 한눈에 다 보이는 편이 낫다」였다. 내 판단이었고,
 *   그 결과 축 아홉이 다 펼쳐져 **기둥 안에 스크롤바가 따로 생겼다**(2026-09-05 실측 · 웹 1440).
 *   무슨 조건이 있는지 세로로 훑어야 알 수 있어, 오히려 「한눈에」가 안 됐다.
 *   ⇒ 사장님 지시로 위 관행을 따른다. 접이식이되 **제일 많이 쓰는 셋(차종·제조사·월 대여료)은 펼쳐 둔다** —
 *     처음 온 손님이 무엇으로 좁히는지 바로 보여야 하고, 그 셋이 이 장사에서 실제로 먼저 걸리는 값이다.
 *
 * ★축마다 «고르는 모양»이 다른 데는 이유가 있다.
 *   ㉠ 네모 체크 + 건수 — 「무엇인가」를 고르는 축(차종·제조사·연식·연료·심사·혜택).
 *      건수가 붙어야 손님이 «큰 갈래부터» 좁힌다. 마켓의 기본형이다.
 *   ㉡ 사각 두 열      — 「어느 구간인가」를 고르는 축(월 대여료·보증금·주행거리).
 *      금액 구간은 라벨이 짧고 서로 나란해야 비교가 되므로 격자로 세운다(케이카 차종 칸과 같은 꼴).
 *
 * ★★건수는 «그 축을 뺀 나머지 조건»으로 세어 들어온다(`runShopQuery` 교차 집계).
 *   여기서 다시 세지 않는다 — 화면이 또 세면 그 순간 숫자가 두 군데서 나온다.
 */

/** 원형 표식 축을 몇 열로 세울까 — 라벨이 길거나 건수가 붙으면 한 열이 낫다. */
const COLUMNS: Partial<Record<ShopAxis, 1 | 2>> = { vc: 2, maker: 1, year: 2, fuel: 2, credit: 2, perk: 1 };
/** 구간 축 = 사각 두 열. 나머지는 원형 표식. */
const BAND_AXES: ShopAxis[] = ['rent', 'dep', 'mile'];

/**
 * 처음부터 펼쳐 두는 축 — **차종 · 제조사 · 월 대여료 · 보증금** 넷.
 *
 * ★★중고차 사이트의 「가격」에 해당하는 것이 우리에게는 **월 대여료 + 보증금 둘**이다
 *   (사장님 2026-09-05 「우리는 다른 거는 차량 가격이 아니고 **대여료·보증금**이잖아.
 *   **그거를 차량 가격이라고 생각을 하고**」). 그래서 둘을 나란히 두고 **둘 다 펼쳐 둔다** —
 *   엔카·케이카에서 「가격」 한 축이 늘 열려 있는 것과 같은 자리다.
 * ★특히 보증금은 저신용 손님의 **1번 장벽**이다(지금 당장 있어야 하는 목돈).
 *   접어 두면 「얼마 있어야 되나」를 묻는 손님이 그 축을 못 찾는다.
 */
const OPEN_BY_DEFAULT: ShopAxis[] = ['vc', 'maker', 'rent', 'dep'];
/** 긴 목록을 몇 개까지 보여 주고 「더보기」로 접을까 — 제조사 12개 중 아래 넷은 5대 미만이다. */
const HEAD_COUNT = 8;

export function ShopFilters({ facets, sel, onToggle, onClearAxis, onClearAll, mobile: forceMobile }: {
  facets: ShopFacets;
  sel: ShopSel;
  onToggle: (axis: ShopAxis, key: string) => void;
  onClearAxis: (axis: ShopAxis) => void;
  /** 맨 위 「선택 초기화」 — 엔카·케이카가 둘 다 조건칸 머리에 둔다. */
  onClearAll?: () => void;
  mobile?: boolean;
}) {
  const isMobile = useIsMobile();
  const mobile = forceMobile ?? isMobile;
  const axes = SHOP_AXES.filter((a) => facets[a].length);
  const picked = axes.reduce((n, a) => n + sel[a].length, 0);
  const [open, setOpen] = useState<Record<string, boolean>>(
    () => Object.fromEntries(axes.map((a) => [a, OPEN_BY_DEFAULT.includes(a)])),
  );

  return (
    <div>
      {/*
        머리 — 고른 조건 수 + 초기화. 엔카는 「142,123대 ↺선택 초기화」, 케이카도 같은 자리다.
        ★고른 게 없으면 초기화를 «안 보여 준다» — 누를 일이 없는 단추가 서 있으면 그만큼 소음이다.
      */}
      {onClearAll && picked ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, marginBottom: 18,
        }}>
          <span style={{ fontSize: SHOP.fs.sub, color: C.mute }}>
            고른 조건 <b style={{ color: C.brand, fontVariantNumeric: 'tabular-nums' }}>{picked}</b>
          </span>
          <ShopTextBtn tone="faint" onClick={onClearAll}>선택 초기화</ShopTextBtn>
        </div>
      ) : null}

      {axes.map((axis) => {
        const on = sel[axis];
        const isOpen = open[axis] ?? OPEN_BY_DEFAULT.includes(axis);
        return (
          /*
           * 축과 축 사이는 **여백만**으로 가른다(사장님 2026-09-05 구분선 최소화).
           * 전에는 축마다 밑줄이 있어 기둥 하나에 가로선이 아홉 개였다 — 조건을 고르는 곳이
           * 표처럼 보였다. 축 이름이 굵고 값이 흐리므로 선이 없어도 덩어리가 갈린다.
           */
          /*
           * 간격 — **접힌 축은 «줄»이고 펼친 축은 «덩어리»다**(사장님 2026-09-05 「필터 간격하고
           * 보여지는 것까지 다 신경 쓰고」). 접힌 것들끼리는 촘촘히 붙어 목록처럼 읽히고,
           * 펼친 축은 아래로 넉넉히 떼어 값 무리와 다음 축이 안 섞인다.
           * ★제목 줄에 상하 여백을 줘서 **누를 자리를 키운다**(엔카 축 제목 줄이 48px 쯤 된다).
           *   글자만 있으면 어디를 눌러야 열리는지 손이 못 찾는다.
           */
          <section key={axis} style={{ paddingBottom: isOpen ? 24 : 0 }}>
            {/*
              제목 줄 전체가 «접었다 폈다» 하는 단추다 — 화살표만 누르게 하면 손님이 그걸 못 찾는다.
              오른쪽에는 ㉠ 고른 수(접혀 있어도 몇 개 걸렸는지 보인다) ㉡ 화살표.
            */}
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [axis]: !isOpen }))}
              aria-expanded={isOpen} className="fp-shop-press"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '11px 0', border: 'none', background: 'transparent', cursor: 'pointer',
                fontFamily: 'inherit', textAlign: 'left',
                marginBottom: isOpen ? 4 : 0,
              }}>
              <span style={{ fontSize: SHOP.fs.body, fontWeight: 700, color: C.ink, flex: 1, minWidth: 0 }}>
                {AXIS_LABEL[axis]}
              </span>
              {on.length ? (
                <span style={{
                  fontSize: SHOP.fs.cap, fontWeight: 700, color: C.brand,
                  fontVariantNumeric: 'tabular-nums',
                }}>{on.length}</span>
              ) : null}
              <ChevronDown size={16} aria-hidden style={{
                flex: '0 0 auto', color: C.faint,
                transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .12s ease',
              }} />
            </button>

            {isOpen ? (
              <>
                <ShopAxisOptions axis={axis} options={facets[axis]} selected={on}
                  onToggle={onToggle} mobile={mobile} />
                {on.length ? (
                  <div style={{ marginTop: 10 }}>
                    <ShopTextBtn tone="faint" onClick={() => onClearAxis(axis)}>해제</ShopTextBtn>
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/**
 * 축 하나의 «값 부분»만 — 웹 기둥과 폰 시트가 **같은 것을 쓴다.**
 * 두 벌로 갈라 두면 웹에서 고른 값이 폰에서 다른 모양으로 뜨는 순간부터 아무도 안 믿는다.
 */
export function ShopAxisOptions({ axis, options, selected, onToggle, mobile, columns }: {
  axis: ShopAxis;
  options: ShopFacets[ShopAxis];
  selected: string[];
  onToggle: (axis: ShopAxis, key: string) => void;
  mobile?: boolean;
  /**
   * 열 수를 부르는 쪽이 정한다 — 같은 축이라도 **칸이 얼마나 넓으냐**에 따라 달라야 한다.
   * 웹 기둥은 260, 폰 시트의 오른쪽은 227 이라 두 열이면 한 칸이 95 밖에 안 되고
   * 「하이브리드」가 「하이브…」로 잘렸다(2026-09-04 실측). 원자 안에 박아 두면 못 고친다.
   */
  columns?: 1 | 2;
}) {
  if (BAND_AXES.includes(axis)) {
    /*
     * ★구간은 **웹 세 열 · 폰 두 열**이다. 「가격」에 해당하는 축이 둘(월 대여료·보증금)이라
     *   둘 다 펼쳐 두는데, 두 열이면 기둥이 1,180px 까지 길어져 **조건칸에만 스크롤바가 또 생긴다**
     *   (2026-09-05 실측). 라벨이 짧아(「50~60만」) 세 열에서도 안 잘린다.
     * ⚠ 폰 시트는 칸이 좁아 두 열 그대로다 — 세 열이면 「100~150만」이 잘린다(2026-09-04 실측 교훈).
     */
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${mobile ? 2 : 3}, minmax(0, 1fr))`,
        gap: mobile ? 8 : 7,
      }}>
        {options.map((o) => (
          <BandBox key={o.key} label={o.label} count={o.count}
            on={selected.includes(o.key)} onClick={() => onToggle(axis, o.key)} />
        ))}
      </div>
    );
  }
  return <CheckList axis={axis} options={options} selected={selected} onToggle={onToggle}
    mobile={mobile} columns={columns ?? COLUMNS[axis] ?? 2} />;
}

/**
 * 체크 목록 — **긴 목록은 상위 몇 개만** 보여 주고 나머지는 「더보기」로 접는다
 * (엔카·케이카가 둘 다 그렇게 한다. 제조사 12개 중 아래 넷은 5대 미만이라 늘 보일 값이 아니다).
 * ★고른 값이 접힌 자리에 있으면 **처음부터 펼친다** — 걸어 둔 조건이 안 보이면 그게 «숨은 필터»다.
 */
function CheckList({ axis, options, selected, onToggle, mobile, columns }: {
  axis: ShopAxis;
  options: ShopFacets[ShopAxis];
  selected: string[];
  onToggle: (axis: ShopAxis, key: string) => void;
  mobile?: boolean;
  columns: 1 | 2;
}) {
  const hiddenHasPick = options.slice(HEAD_COUNT).some((o) => selected.includes(o.key));
  const [all, setAll] = useState(false);
  const shown = all || hiddenHasPick ? options : options.slice(0, HEAD_COUNT);
  const rest = options.length - shown.length;
  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: mobile ? '15px 10px' : '12px 10px',
      }}>
        {shown.map((o) => (
          <CheckRow key={o.key} label={o.label} count={o.count}
            on={selected.includes(o.key)} onClick={() => onToggle(axis, o.key)} />
        ))}
      </div>
      {rest > 0 ? (
        <div style={{ marginTop: 10 }}>
          <ShopTextBtn tone="faint" onClick={() => setAll(true)}>{`더보기 ${rest}`}</ShopTextBtn>
        </div>
      ) : null}
    </>
  );
}

/**
 * 체크 한 줄 — 이름 + 건수(우측, 흐리게). 엔카·케이카의 목록 항목과 같은 짜임이다.
 *
 * ★★**네모다.** 원형(라디오)으로 두었더니 «하나만 고르는 축»으로 읽혔는데, 우리 축은 전부
 *   여러 개를 고를 수 있다(케이카는 축 제목 옆에 「중복선택가능」이라고 아예 써 둔다).
 *   모양이 말해 주면 글자로 설명할 필요가 없다.
 */
function CheckRow({ label, count, on, onClick }: {
  label: string; count: number; on: boolean; onClick: () => void;
}) {
  const mobile = useIsMobile();
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="fp-shop-press"
      style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: 0,
        border: 'none', background: 'transparent', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'left', minWidth: 0,
        fontSize: mobile ? SHOP.fs.body : 14,
        color: on ? C.ink : C.sub, fontWeight: on ? 700 : 400,
      }}>
      <span aria-hidden style={{
        width: 17, aspectRatio: '1 / 1', borderRadius: 5, flex: '0 0 auto',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: `1.5px solid ${on ? C.brand : C.line}`,
        background: on ? C.brand : 'transparent',
      }}>
        {on ? <Check size={12} strokeWidth={3} style={{ color: C.inverse }} /> : null}
      </span>
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
    <button type="button" onClick={onClick} aria-pressed={on} className="fp-shop-press"
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
