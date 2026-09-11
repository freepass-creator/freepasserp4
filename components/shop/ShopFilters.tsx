'use client';
import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown } from 'lucide-react';
import { C } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { SHOP, ShopTextBtn, axisIconFor } from '@/components/shop/shop-ui';
import { makerLogoSrc } from '@/lib/domain/maker-logo';
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

/**
 * **모든 축이 «같은 모양»이다 — 체크 한 줄**(사장님 2026-09-05 「**통일**을 했으면 좋겠어.
 * 체크할 거면 체크박스로 하든지, 아니면 사각형 박스로 할 거면 박스로 하든지,
 * 뭔가 **규격 통일**을 좀 해야지」).
 *
 * ⚠ 구간 축(월 대여료·보증금·주행거리)만 **사각 박스 버튼**이었다. 「금액은 나란해야 견준다」는
 *   내 판단이었는데, 그 바람에 한 기둥 안에 고르는 모양이 둘이 되어 **어느 것이 여러 개 고를 수
 *   있는 것인지**가 축마다 달라 보였다. 케이카도 차종만 박스라 섞여 있지만, 엔카는 **전부 체크**다.
 * ⇒ 체크로 통일한다 — ㉠ 여러 개 고를 수 있다는 표시가 한 가지 ㉡ 건수가 늘 같은 자리(우측)
 *   ㉢ 라벨 길이가 제각각인 축(제조사)과 짧은 축(금액)이 같은 줄 높이로 선다.
 *   금액을 나란히 견주는 일은 **두 열**이 대신한다.
 *
 * 열 수 — 라벨이 길거나 건수가 붙으면 한 열이 낫다.
 */
const COLUMNS: Partial<Record<ShopAxis, 1 | 2>> = {
  vc: 2, maker: 1, year: 2, fuel: 2, credit: 2, perk: 1,
  /*
   * ⚠ 금액·주행 구간은 **한 열**이다. 두 열로 뒀더니 「100~200만」이 「100~200…」으로 잘렸다
   *   (2026-09-05 실측 · 기둥 260px). 한 칸 130px 에서 체크(17)·사이(9)·건수(26)를 빼면
   *   라벨에 남는 폭이 70px 밖에 안 된다 — 금액 라벨은 여덟 자다.
   * ★잘린 조건은 조건이 아니다. 「100~200만」과 「100~150만」이 둘 다 「100~1…」이면 못 고른다.
   */
  rent: 1, dep: 1, mile: 1,
};

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
/*
 * ★**계약기간도 펼쳐 둔다**(2026-09-08). 위 「가격」 논리의 연장이다 —
 *   월 대여료가 **기간마다 다른 금액**이라, 기간은 「가격」 축의 앞머리다.
 *   접어 두면 손님이 그 축이 있다는 걸 모른 채 60개월 값만 보고 판단한다.
 * ★특히 **단기(1·6개월)**를 찾는 손님은 접힌 축 뒤에서 그 차를 영영 못 찾는다
 *   (실측 1개월 98대 · 6개월 43대).
 * ⚠ 차급(`vclass`)은 «접어» 둔다 — 차종(승용·SUV·승합·화물)이 이미 굵은 갈래를 잡아 주고,
 *   차급은 그 안에서 더 좁히는 축이라 처음부터 열어 두면 왼쪽 기둥이 길어지기만 한다.
 */
/* ★상품구분은 «차종 바로 밑»이라 접어 두면 위아래가 열린 사이에 낀 한 줄이 된다.
   갈래가 예닐곱뿐이라 펴 두어도 기둥이 길어지지 않는다(제조사·연식과 다르다). */
const OPEN_BY_DEFAULT: ShopAxis[] = ['vc', 'ptype', 'maker', 'term', 'rent', 'dep'];
/**
 * 긴 목록을 «한 번에 몇 개씩» 여는가 — **다섯**(사장님 2026-09-07 「웹 필터는 **5개씩 보고
 * 더보기 5개씩** 하는 거로, **5개 이하면 남은 거만큼만** 보게 하고」).
 *
 * ⚠ 여덟을 보여 주고 「더보기」를 누르면 **나머지를 통째로** 폈다. 제조사는 12개라 한 번에 넷이
 *   더 나오는 정도지만, 그 뒤 축(연식·모델)은 한 번에 스무 줄이 튀어나와 기둥이 통째로 길어졌다.
 *   조건 하나 더 보려던 손이 화면을 잃는다.
 * ⇒ **다섯씩 연다.** 남은 것이 다섯보다 적으면 그만큼만 — 「더보기 3」이면 정말 셋만 나온다.
 *   그래야 단추의 숫자가 «앞으로 나올 수»가 되어 거짓말을 안 한다.
 * ★웹·폰이 같은 원자를 쓰므로 양쪽에 한 번에 적용된다(집 규칙: 한쪽만 고치지 않는다).
 */
/**
 * 제조사 마크의 «자리» 크기 — 그림과 빈자리가 **같은 값**이어야 왼선이 안 갈린다.
 * 한 곳에서 정한다(둘을 따로 적으면 한쪽만 고쳐져 그 어긋남이 조용히 돌아온다).
 *
 * ★★**칸은 정사각이 아니라 «가로로 넓다»**(2026-09-08).
 *   ⚠ 18×18 짜리 정사각이었다. 그래서 **가로로 긴 마크가 실처럼 눌렸다** — 제네시스 엠블럼은
 *     날개 달린 방패라 원본 판이 126×26(4.8:1)이다. 정사각 칸에 `contain` 으로 넣으면 높이가
 *     3.7px 이 되어, 앞 사람이 날개를 잘라내고 «방패만» 남겼다. 사장님 2026-09-08
 *     「필터에 제네시스 로고 저거 아닌데」 — 날개 없는 방패는 그 회사 마크가 아니다.
 *   ⇒ 칸을 **44×18** 로 넓힌다. 정사각 마크(기아·현대·BMW…)는 높이 18 그대로 왼쪽에 서고,
 *     가로로 긴 마크만 제 비율대로 펴진다. **왼선은 칸 폭이 고정이라 그대로다.**
 *   ★그림을 칸에 맞추지 않는다 — 칸을 그림에 맞춘다. 남의 상표를 우리가 자르지 않는다.
 */
const MARK_W = 44;
const MARK_H = 18;

const HEAD_COUNT = 5;
/**
 * **「더보기」로 안 접는 축** — 값을 «눈금처럼» 훑는 축이다.
 *
 * ★「다섯 개씩 + 더보기 다섯」은 **긴 목록**(제조사 열둘)을 접는 장치다. 거기서는 아래쪽 값이
 *   대수 몇 대짜리라 늘 보일 값이 아니다.
 * ⚠ 계약기간은 다르다. 값이 여덟(1·6·12·18·24·36·48·60)인데 다섯에서 자르면
 *   **제일 흔한 36·48·60이 「더보기」 뒤로 숨는다**(실측 48개월 757대). 손님이 제일 많이
 *   고를 값을 접어 두는 셈이고, 기간은 눈금이라 중간이 끊기면 축으로 안 읽힌다.
 * ⇒ 기간만 전부 편다. 두 칸 격자라 여덟 개가 네 줄이다 — 기둥이 길어지지도 않는다.
 */
const ALL_SHOWN: ShopAxis[] = ['term'];
/** 「더보기」 한 번에 더 여는 수 — 처음 보여 주는 수와 같다(리듬이 갈리면 단추가 딴 물건이 된다). */
const MORE_STEP = 5;
/** 맨 아래 구역의 자리 이름 — 축 이름과 안 겹치는 글자면 된다(접힘 상태 표의 열쇠로만 쓴다). */
const TAIL_ID = '__tail';

/**
 * **조건칸 «맨 아래» 구역 하나** — 축이 아니지만 축과 «같은 모양»으로 접혀 선다.
 *
 * ★사장님 2026-09-11 「퀵필터 조정하는 거 **설정페이지 맨 하단 섹션 하나** 주고 거기서 **펼쳐서** 넣게」.
 * ★머리 짜임(그림·제목·화살표·누름 영역)을 축과 **같은 줄**로 그린다 — 따로 짜면 이 구역만
 *   높이·간격이 갈려 «딴 물건»으로 보인다. 그래서 축 목록 끝에 한 칸 «더 얹는» 식이다.
 * ★처음엔 접혀 있다 — 손님이 조건을 고르러 온 기둥이라, 고치는 칸이 펼쳐져 있으면 그게 먼저 읽힌다.
 */
export type ShopFilterTail = { label: string; icon: LucideIcon; body: ReactNode };

export function ShopFilters({ facets, sel, onToggle, onClearAxis, mobile: forceMobile, axes: only, tail }: {
  facets: ShopFacets;
  sel: ShopSel;
  onToggle: (axis: ShopAxis, key: string) => void;
  onClearAxis: (axis: ShopAxis) => void;
  mobile?: boolean;
  /**
   * **이 채널이 쓰는 축**(순서까지) — 안 주면 집 기본(`SHOP_AXES` 전부).
   * 사장님 2026-09-08 「회사별로 필터값이나 빠른필터나 원하는 게 달라서」.
   * ⚠ 값이 하나도 없는 축은 원래도 안 뜬다 — 이건 «값이 있어도 안 세우는» 칸이다.
   */
  axes?: readonly ShopAxis[];
  /** 맨 아래 구역(위 `ShopFilterTail`) — 안 주면 축만 선다. */
  tail?: ShopFilterTail;
}) {
  const isMobile = useIsMobile();
  const mobile = forceMobile ?? isMobile;
  const axes = (only ?? SHOP_AXES).filter((a) => facets[a].length);
  const [open, setOpen] = useState<Record<string, boolean>>(
    () => Object.fromEntries(axes.map((a) => [a, OPEN_BY_DEFAULT.includes(a)])),
  );

  return (
    <div>
      {/*
        ⚠⚠ **여기 「고른 조건 N · 선택 초기화」가 있었다. 뺐다**(사장님 2026-09-06 「한 페이지에
          **같은 버튼이 굳이 두 개**가 있을 필요가 없잖아」).
          웹에서는 이 기둥 «바로 옆»에 걸린 조건 줄이 서고 거기 「조건 모두 지우기」가 이미 있다 —
          같은 일을 하는 문이 한 화면에 둘이었다.
        ★남길 쪽은 **조건 줄**이다. 지우는 대상(칩)과 붙어 있어 손이 거기로 간다.
          기둥 꼭대기의 것은 «무엇을» 지우는지가 화면에서 멀었다.
      */}

      {/* 축 + (있으면) 맨 아래 구역 — 한 줄로 이어 그린다(위 `ShopFilterTail` 머리말). */}
      {[...axes, ...(tail ? [TAIL_ID] : [])].map((id, ai, all) => {
        const axis = id === TAIL_ID ? null : (id as ShopAxis);
        const last = ai === all.length - 1;
        const on = axis ? sel[axis] : [];
        const isOpen = open[id] ?? (axis ? OPEN_BY_DEFAULT.includes(axis) : false);
        const AxisIcon = axis ? axisIconFor(axis) : tail!.icon;
        const title = axis ? AXIS_LABEL[axis] : tail!.label;
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
          <section key={id} style={{
            /*
             * ★★**축 사이에 옅은 선**(시안 A — 엔카·KB·케이카가 다 쓴다).
             * ⚠ 2026-09-05 에 「구분선 최소화」로 선을 다 걷었는데, 그때 그은 자리는 **제목 «아래»**라
             *   기둥 하나에 가로선이 아홉 개 그어져 «표»처럼 보였다. 이번엔 **축과 축 «사이»**다 —
             *   덩어리를 가르는 선이지 제목을 밑줄 치는 선이 아니다.
             * ★마지막 축에는 안 긋는다 — 판 테두리가 이미 거기서 끝을 말한다.
             */
            paddingBottom: isOpen ? SHOP.sp.edge : 0,
            borderBottom: last ? 'none' : `1px solid ${C.line2}`,
            marginBottom: last ? 0 : SHOP.sp.tight,
          }}>
            {/*
              제목 줄 전체가 «접었다 폈다» 하는 단추다 — 화살표만 누르게 하면 손님이 그걸 못 찾는다.
              오른쪽에는 ㉠ 고른 수(접혀 있어도 몇 개 걸렸는지 보인다) ㉡ 화살표.

              ★★**「해제」는 «제목 옆»이다**(사장님 2026-09-10 「해제 버튼이 **아래에 나오면 안 되고
                그 필터 제목 옆에** 나와야지」). 값 목록 «밑»에 두면 축마다 목록 길이가 달라
                해제가 매번 다른 높이에 서고, 열두 값짜리 축에서는 **스크롤을 내려야 보인다.**
                제목 줄은 늘 같은 자리라 「이 축을 되돌린다」가 한 곳에서 끝난다.
              ⚠ 그래서 머리를 «두 조각»으로 나눴다 — 단추 안에 단추를 넣을 수 없기 때문이다
                (`<button>` 안의 `<button>` 은 HTML 이 금지한다. 눌러도 어느 쪽이 먹을지 안 정해진다).
                왼쪽 조각(그림+제목)과 오른쪽 조각(개수+화살표)이 **둘 다 같은 접기**를 하고,
                그 사이에 해제가 낀다 — 손님에게는 여전히 «줄 전체가 눌리는» 한 줄이다.
            */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: SHOP.sp.snug, width: '100%',
              marginBottom: isOpen ? SHOP.sp.tight : 0,
            }}>
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [id]: !isOpen }))}
              aria-expanded={isOpen} className="fp-shop-press"
              style={{
                display: 'flex', alignItems: 'center', gap: SHOP.sp.snug,
                /* 제목은 «제 폭»만 먹는다 — 그래야 해제가 글자 바로 옆에 붙는다. */
                flex: '0 1 auto', minWidth: 0,
                padding: mobile ? '12px 0' : '11px 0', minHeight: mobile ? SHOP.tap.mobile : undefined,
                border: 'none', background: 'transparent', cursor: 'pointer',
                fontFamily: 'inherit', textAlign: 'left',
              }}>
              {/*
                ★**축 제목 앞의 그림**(`axisIconFor`) — 아홉 축이 글자만이면 기둥이 목차처럼 읽힌다
                  (사장님 2026-09-06 「분류의 어떤 아이콘을 좀 달면 덜 밋밋하고 확실히 될 것 같다」).
                  값을 고르러 내려가는 눈이 **글자를 읽기 전에** 어느 축인지 안다.
                ★★**축 제목은 값보다 «한 단 위»다**(`fs.h2` 16 · 값은 `fs.body` 웹 14.5).
                ⚠ 실측 2026-09-06 — 웹에서 **둘 다 14.5** 였다. 굵기(700 vs 400)만 달라
                  접힌 축 제목이 값 목록의 한 줄처럼 읽혔다.
                ★폰 시트는 이미 16/15 로 층이 있었다 — **웹만 무너져 있던 것**이라 같은 이름으로 맞췄다.
              */}
              {AxisIcon ? (
                <AxisIcon size={16} aria-hidden style={{ flex: '0 0 auto', color: C.mute }} />
              ) : null}
              <span style={{
                fontSize: SHOP.fs.h2, fontWeight: 700, color: C.ink, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {title}
              </span>
            </button>

            {/* 걸린 것이 있을 때만 — 없는 축에 「해제」가 서 있으면 그건 안내가 아니라 소음이다. */}
            {axis && on.length ? (
              <ShopTextBtn tone="faint" onClick={() => onClearAxis(axis)}>해제</ShopTextBtn>
            ) : null}

            <button type="button" onClick={() => setOpen((o) => ({ ...o, [id]: !isOpen }))}
              aria-expanded={isOpen} aria-label={`${title} ${isOpen ? '접기' : '펼치기'}`}
              className="fp-shop-press"
              style={{
                /* 남는 폭을 다 먹는다 — 오른쪽 빈 자리를 눌러도 접힌다(줄 전체가 단추라는 느낌 유지). */
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: SHOP.sp.snug,
                flex: 1, minWidth: 0,
                padding: mobile ? '12px 0' : '11px 0', minHeight: mobile ? SHOP.tap.mobile : undefined,
                border: 'none', background: 'transparent', cursor: 'pointer',
                fontFamily: 'inherit',
              }}>
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
            </div>

            {isOpen ? (axis ? (
              <ShopAxisOptions axis={axis} options={facets[axis]} selected={on}
                onToggle={onToggle} mobile={mobile} />
            ) : tail!.body) : null}
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
  /*
   * ★고른 값이 접힌 자리에 있으면 **거기까지 펼친 채로 시작한다** — 걸어 둔 조건이 안 보이면
   *   그게 «숨은 필터»다. 통째로 펴지 않고 그 값이 드러나는 만큼만 연다(다섯 단위로 올림).
   */
  const deepestPick = options.reduce((acc, o, i) => (selected.includes(o.key) ? i : acc), -1);
  const floor = deepestPick < HEAD_COUNT ? HEAD_COUNT
    : HEAD_COUNT + Math.ceil((deepestPick + 1 - HEAD_COUNT) / MORE_STEP) * MORE_STEP;
  const [opened, setOpened] = useState(0);
  const limit = ALL_SHOWN.includes(axis) ? options.length : Math.max(HEAD_COUNT + opened, floor);
  const shown = options.slice(0, limit);
  const rest = options.length - shown.length;
  /** 단추에 적는 수 = «이번에 정말 나올 수». 남은 게 셋이면 「더보기 3」이고 셋만 나온다. */
  const nextStep = Math.min(MORE_STEP, rest);
  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        /* 줄 높이(폰 48)가 이미 자리를 만든다 — 사이까지 벌리면 손가락 한 번에 한 줄만 보인다. */
        gap: mobile ? `${SHOP.sp.tight}px ${SHOP.sp.cozy}px` : `${SHOP.sp.cozy}px ${SHOP.sp.snug}px`,
      }}>
        {shown.map((o) => (
          <CheckRow key={o.key} label={o.label} count={o.count} tight={columns > 1}
            logo={axis === 'maker' ? makerLogoSrc(o.label) : undefined}
            on={selected.includes(o.key)} onClick={() => onToggle(axis, o.key)} />
        ))}
      </div>
      {rest > 0 ? (
        <div style={{ marginTop: SHOP.sp.snug }}>
          <ShopTextBtn tone="faint" onClick={() => setOpened((n) => n + MORE_STEP)}>{`더보기 ${nextStep}`}</ShopTextBtn>
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
function CheckRow({ label, count, on, onClick, tight, logo }: {
  label: string; count: number; on: boolean; onClick: () => void;
  /**
   * 제조사 마크(CI) — 글자 앞에 선다(사장님 2026-09-06 「제조사는 그 CI 를 달아주면 되고」).
   *
   * ★★**세 가지 값이 세 가지 뜻이다.**
   *   · `undefined` = 마크를 쓰지 않는 축(차종·연료…) — **자리를 안 만든다.**
   *   · `null`      = 마크를 쓰는 축인데 **이 브랜드만 파일이 없다** — 자리는 «비워서» 남긴다.
   *   · 주소        = 그린다.
   * ⚠⚠ 전에는 없는 것을 `null` 하나로 뭉뚱그려 **자리째 사라졌다.** 그래서 제조사 목록에서
   *   마크가 있는 줄(기아·현대)은 글자가 148 에서 시작하고 없는 줄(제네시스·KGM)은 122 에서
   *   시작해 **왼선이 26px 씩 들쭉날쭉했다**(2026-09-07 실측). 목록에서 제일 먼저 보이는 것이
   *   글자의 왼선인데 그게 갈리면 훑는 눈이 매 줄 다시 자리를 잡는다.
   * ★마크 없는 브랜드는 앞으로도 «있다» — 규격이 「없는 마크를 지어내지 않는다」이기 때문이다
   *   (제네시스·KGM·BYD). 그러니 빈자리는 예외가 아니라 **정상 상태**고, 자리는 늘 있어야 한다.
   *   (자리·파일명은 `lib/domain/maker-logo` 가 정한다.)
   */
  logo?: string | null;
  /**
   * **두 열로 설 때** — 건수를 칸 오른쪽 끝이 아니라 **제 라벨 바로 뒤**에 붙인다.
   *
   * 사장님 2026-09-06 「필터 **연식이 두 줄로 돼 있어가지고 좀 짤리는 게** 있고」.
   * ⚠ 실측 — 잘린 글자는 없었다(`scrollWidth == clientWidth`). 진짜 문제는 **묶임**이었다:
   *   `2026 … 128 │ 2025 … 75` 에서 `128` 이 제 라벨(2026)과는 40px, **옆 칸 라벨(2025)과는 12px**.
   *   숫자가 엉뚱한 라벨에 붙어 읽히니 「깨졌다·짤렸다」로 보인다.
   * ★한 열일 때는 반대다 — 오른쪽 끝에 세워야 숫자 열이 세로로 맞아 훑기 좋다(엔카·케이카가 그렇다).
   */
  tight?: boolean;
}) {
  const mobile = useIsMobile();
  return (
    <button type="button" onClick={() => { haptic.select(); onClick(); }} aria-pressed={on} className="fp-shop-press fp-shop-check"
      style={{
        display: 'flex', alignItems: 'center', gap: mobile ? SHOP.sp.cozy : SHOP.sp.snug,
        /*
         * ★★**행이 곧 누르는 자리다** — 좌우로 조금 넘겨 «면»이 글자 밖까지 깔리게 한다.
         *   음수 여백으로 도로 당겨 두므로 **줄 맞춤은 그대로**고, 마우스를 올리면 행 전체가 물든다.
         *   요즘 필터(에어비앤비·무신사·리니어)가 다 이 짜임이다 — 체크 «네모»가 아니라
         *   «행»이 반응하니까 손이 어디를 눌러야 할지 안 헷갈린다.
         */
        padding: `0 ${SHOP.sp.snug}px`, margin: `0 -${SHOP.sp.snug}px`, borderRadius: SHOP.r.chip,
        /* 목록 «행»은 영역이 곧 크기라 `SHOP.tap`(폰 44) — 칩(38)보다 크되 48 은 과하다. */
        minHeight: mobile ? SHOP.tap.mobile : SHOP.tap.web,
        border: 'none', background: 'transparent', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'left', minWidth: 0,
        /* 글자는 «사다리»에 맡긴다 — 여기서 숫자를 박으면 폰 사다리를 낮춰도 이 줄만 커진 채 남는다. */
        fontSize: mobile ? SHOP.fs.body : SHOP.fs.body,
        /*
         * ⚠ 켜졌다고 **700 으로 확 굵히지 않는다**(사장님 2026-09-06 「체크박스가 좀 촌스러워 보인다」).
         *   400 → 700 은 두 단을 뛰는 것이라 글자가 «퉁퉁해» 보이고, 그 줄만 화면에서 튄다.
         *   600 이면 「켜졌다」는 확실히 읽히면서 줄의 폭도 거의 안 흔들린다.
         */
        color: on ? C.ink : count ? C.sub : C.faint, fontWeight: on ? 600 : 400,
      }}>
      {/*
        ★네모는 폰 20 · 웹 18. 촌스러움을 만드는 건 «크기»가 아니라 셋이었다 —
          ㉠ 체크 획이 3 으로 두꺼웠다(굵은 매직으로 그은 꼴) → **2.25**
          ㉡ 20 짜리 네모에 둥글기 6 은 어중간했다(각지지도 둥글지도 않다) → **7**(거의 스퀘어클)
          ㉢ 꺼짐 테두리가 진한 선(`C.line`)이라 «빈 칸»이 먼저 눈에 들어왔다 → **`C.lineStrong` 1.5**
             …이 아니라 반대로, 켜짐이 또렷해야 하므로 꺼짐은 한 단 **옅게**(`C.line`) 두고
             켜짐에서 테두리를 지운다(면만 남긴다 — 가게 규칙 「면으로 말한다」).
      */}
      <span aria-hidden className="fp-shop-checkbox" style={{
        width: mobile ? 20 : 18, aspectRatio: '1 / 1', borderRadius: SHOP.r.chip, flex: '0 0 auto',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        /* 켜지면 테두리를 지우고 면만 남긴다 — 선과 면이 겹치면 가장자리가 두 겹으로 두꺼워 보인다. */
        border: on ? '1.5px solid transparent' : `1.5px solid ${C.line}`,
        background: on ? C.brand : 'transparent',
      }}>
        {on ? <Check size={mobile ? 13 : 12} strokeWidth={2.25} style={{ color: C.inverse }} /> : null}
      </span>
      {logo !== undefined ? (
        /*
         * ★**자리는 늘 있고, 그림만 없을 수 있다.** 그래야 마크가 없는 브랜드의 글자도
         *   있는 브랜드와 «같은 왼선»에서 시작한다(위 `logo` 머리말의 26px 어긋남).
         * ⚠⚠ 파일이 없으면 그림은 «조용히» 사라져야 한다. 주소만 있고 파일이 없으면 브라우저가
         *   **깨진 그림 아이콘**을 그린다 — 열일곱 줄에 깨진 아이콘이 서면 안 다는 것만 못하다
         *   (2026-09-06 실측으로 잡았다. 표에는 이름을 다 적었는데 파일은 한 장도 없었다).
         * ⇒ `onError` 는 **그림만** 숨긴다(`visibility`) — `display:none` 이면 자리째 접혀
         *   방금 고친 어긋남이 그대로 돌아온다. 파일을 넣는 순간 그 브랜드만 바로 뜬다.
         */
        <span aria-hidden style={{
          flex: '0 0 auto', width: MARK_W, height: MARK_H,
          /* ★왼쪽 정렬 — 가운데로 모으면 정사각 마크와 가로로 긴 마크의 «시작점»이 갈린다. */
          display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start',
        }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- 브랜드 마크는 정적 최적화 대상이 아니다(작은 SVG).
            <img src={logo} alt="" aria-hidden
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
              /* ★`contain` + 최대치 둘 — 정사각은 높이에, 가로로 긴 것은 폭에 걸린다(제 비율 유지). */
              style={{ maxWidth: MARK_W, maxHeight: MARK_H, objectFit: 'contain' }} />
          ) : null}
        </span>
      ) : null}
      <span style={{ display: 'flex', alignItems: 'baseline', gap: SHOP.sp.snug, flex: 1, minWidth: 0 }}>
        <span style={{
          /* 두 열이면 라벨이 «제 폭»만 먹는다 → 건수가 바로 뒤에 붙는다(위 `tight` 머리말). */
          flex: tight ? '0 1 auto' : 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{label}</span>
        {/*
          ★★**0 은 «없어지지» 않고 0 이라고 선다**(사장님 2026-09-10 「그냥 기존 필터에서
            **숫자가 0으로 바뀌면** 되잖아 **이게 쭈구러 든다**고」).
          ★그래서 «옅게»만 한다 — 줄을 지우지도, 못 누르게 막지도 않는다. 지금 조건에서 0 일 뿐
            조건을 풀면 있는 값이라, 눌러서 «갈아타는» 길을 막으면 손님이 되돌아 나가야 한다.
        */}
        <span style={{
          fontSize: mobile ? SHOP.fs.sub : SHOP.fs.cap,
          color: count ? C.faint : C.line2,
          fontVariantNumeric: 'tabular-nums', flex: '0 0 auto',
        }}>
          {count}
        </span>
      </span>
    </button>
  );
}
