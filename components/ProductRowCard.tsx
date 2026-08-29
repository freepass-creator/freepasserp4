'use client';
import { memo } from 'react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, FS, FW, R_CARD, SH } from '@/components/ui';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';

/**
 * 모바일 목록 1행 이름 = **세부모델 + 세부트림**(제조사 뺌 · 사장님 2026-08-22).
 * `omitMaker` 는 «상위 UI 가 제조사를 확정한 자리»에서만 쓰는 옵션인데, 목록은 사진이 그 역할을 한다.
 * short = 세부모델 + 세부트림. full 은 파워트레인·원문 조각이 붙는다.
 */
const listName = (p: EntityRecord): string =>
  vehicleNameOf({ kind: 'product', product: p }, { tier: 'short', omitMaker: true, fallback: 'plate' });
import {
  CardTitle, CardSpecs, CardPerkLine, CardThumb, CardRailBadges,
  PricePeekRoot, PriceAmounts, PeriodChips, PeriodRange, OptionChips,
} from '@/components/product-card-atoms';

/**
 * 상세카드 SSOT
 *
 * 웹 4×2:
 *   1 차명              | 뱃지
 *   2 옵션/옵션미입력   | (빈 슬롯)
 *   3 스펙(+차번)       | 기간·대여료·보증금
 *   4 조건              | 기간칩
 *
 * 모바일 피드 4줄(세로 · 썸네일 좌) — 영업 스캔. 옵션·뱃지·연료/주행은 /m. ⋮메뉴 없음(2026-08-22):
 *   1 차량명
 *   2 차량번호 · 연식
 *   3 대여료 · 보증금 · 최저~최대 운영기간
 *   4 우대조건
 */
export const ProductRowCard = memo(function ProductRowCard({ p, focusMonth }: { p: EntityRecord; focusMonth?: number }) {
  const mobile = useIsMobile();
  return mobile
    ? <MobileRow p={p} focusMonth={focusMonth} />
    : <WebRow p={p} focusMonth={focusMonth} />;
});

/** full = 두 칸을 통째로 쓰는 줄(옵션). 우측 칸을 비워 두면 옵션이 절반 폭에서 잘린다. */
function Cell({ right, full, children }: { right?: boolean; full?: boolean; children?: ReactNode }) {
  return (
    <div style={{
      minWidth: 0,
      ...(full ? { gridColumn: '1 / -1' } : null),
      display: 'flex', alignItems: 'center',
      justifyContent: right ? 'flex-end' : 'flex-start',
      minHeight: 22,
    }}>
      {children ?? null}
    </div>
  );
}

/** 웹 — 조건 | 기간칩 */
function PerkPeriodRow({ p }: { p: EntityRecord }) {
  return (
    <div style={{
      gridColumn: '1 / -1',
      display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start',
      gap: 8, minWidth: 0, width: '100%',
    }}>
      <div style={{ flex: '1 1 96px', minWidth: 0 }}>
        <CardPerkLine p={p} dense={false} withCredit />
      </div>
      <div style={{ flex: '2 1 168px', minWidth: 0, maxWidth: '100%' }}>
        <PeriodChips align="end" clamp />
      </div>
    </div>
  );
}

function WebRow({ p, focusMonth }: { p: EntityRecord; focusMonth?: number }) {
  const href = `/m/${encodeURIComponent(String(p.product_code || p._key))}`;
  return (
    <Link href={href} onClick={() => haptic.nav()} className="fp-card" style={{
      display: 'flex', gap: 14, alignItems: 'stretch',
      // 웹 한 줄도 «카드»다 — 격자 카드와 같은 모서리를 쓴다(모바일 줄은 붙어 흐르므로 0 유지).
      borderRadius: R_CARD,
      padding: '10px 12px',
      border: `1px solid ${C.line}`,
      boxShadow: SH.cardRest,
      textDecoration: 'none', color: 'inherit',
    } satisfies CSSProperties}>
      {/* 관심(별)은 **상품 상세에서만** 단다(사장님 2026-08-20 「상세보기 화면에도 관심 버튼은 상세페이지서만」).
          모바일 목록은 이미 그렇게 돼 있었는데 웹 한 줄만 예외로 남아 있었다 —
          목록은 «훑는» 자리라 손가락·마우스가 지나가는 길에 별이 눌리고, 훑는 중엔 관심 여부를 정할 일도 없다. */}
      <CardThumb p={p} w={88} marks={false} />

      <PricePeekRoot p={p} focusMonth={focusMonth} style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gridTemplateRows: 'repeat(4, auto)',
        columnGap: 16,
        rowGap: 6,
        alignItems: 'center',
        flex: '1 1 auto',
        minWidth: 0,
        alignSelf: 'stretch',
      }}>
        {/*
          ★**뱃지는 이름 바로 뒤**(사장님 2026-08-23 「어떤 건 우측정렬 어떤 건 차종 뒤에 붙고 · 규격 통일 좀」).
          예전엔 웹만 별도 칸에 우측정렬이라, 같은 뱃지가 모바일에선 이름 옆·웹에선 줄 끝에 섰다.
          두 줄을 한 칸으로 합쳐 **어느 화면이든 이름 뒤**로 통일한다.
        */}
        <Cell full>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' }}>
            <div style={{ position: 'relative', minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
              <CardTitle p={p} />
            </div>
            <CardRailBadges p={p} />
          </div>
        </Cell>

        {/* 옵션 = 한 줄 전체. 차명 옆 뱃지 칸까지 내려와 «꽉 채운다»
            (사장님 2026-08-20 「2열은 옵션으로 꽉 채우는 거로」) — 옵션은 길이가 제각각이라
            절반 폭에 두면 대부분 …로 잘려 정작 무엇이 붙었는지 못 읽는다. */}
        <Cell full><OptionChips p={p} clamp /></Cell>

        <Cell><CardSpecs p={p} /></Cell>
        <Cell right><PriceAmounts align="end" /></Cell>

        <PerkPeriodRow p={p} />
      </PricePeekRoot>
    </Link>
  );
}

/**
 * 모바일 4줄 — 영업 스캔: 차명 / 차번·연식 / 대여·보증·기간범위 / 우대.
 * 출고·상품·심사·연료·주행·옵션 = /m.
 */
function MobileRow({ p, focusMonth }: { p: EntityRecord; focusMonth?: number }) {
  const href = `/m/${encodeURIComponent(String(p.product_code || p._key))}`;
  /**
   * ⚠ 여백은 **안쪽 Link 한 곳에만** 둔다(2026-08-22 사장님 「모바일 여백 더 준 거 같은데」).
   *   perf 개편(b507cd06)이 ⋯메뉴 배치용 겉 div 를 씌우며 안팎 둘 다 padding 10×12 를 걸어
   *   행 여백이 두 배(상하 20·좌우 24)가 됐었다 — 겉은 하단선·position 만 갖는다.
   */
  const linkedContentStyle = {
    display: 'flex', gap: 12, alignItems: 'stretch',
    borderRadius: 0,
    /* 행 상하 8px — 모바일 밀도(사장님 2026-08-22). 글자 크기는 그대로, 여백만 조인다. */
    padding: '8px 12px',
    textDecoration: 'none', color: 'inherit',
    width: '100%', minWidth: 0, boxSizing: 'border-box',
  } satisfies CSSProperties;

  return (
    /* 가로라인 구분(사장님 2026-08-22 「가로라인 구분이 무난, 제일 넓게 쓰는 방법」 — 박스형은 하루 써 보고 회귀).
       테두리·모서리·그림자 없이 하단 hairline 하나가 경계다 — 한 화면에 한두 줄 더 들어온다. */
    /* ⚠ 배경을 인라인으로 칠하지 않는다 — 인라인은 클래스를 이기므로 목록 얼룩무늬(지브라)가
         통째로 안 보인다(2026-08-28 실측: 08-21 에 지브라를 주석 처리하고 08-23 에 이 인라인
         흰 배경이 들어와, 두 겹으로 줄 구분이 사라져 있었다).
         기본 흰 바탕은 `.fp-card` 가, 짝수 줄 얼룩은 `.fp-card-row:nth-child(even)` 이 든다. */
    <div className="fp-card fp-card-row" style={{ position: 'relative', borderBottom: `1px solid ${C.line}` }}>
      <Link href={href} onClick={() => haptic.nav()} style={linkedContentStyle}>
        {/* 목록(웹·모바일) = 찜 없음. 관심 등록은 상품 상세에서만. */}
        <CardThumb p={p} w={56} marks={false} />

        <PricePeekRoot p={p} focusMonth={focusMonth} style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          flex: '1 1 auto',
          minWidth: 0,
          alignSelf: 'stretch',
          justifyContent: 'center',
        }}>
          {/* 1 **세부모델 + 세부트림**(제조사 없음) + 뱃지 — 사장님 2026-08-22
             「모바일 목록에서 제조사는 빼고 그냥 세부모델만… 목록에 나오는 거는 세부모델 세부트림, 짤리는 건 어쩔 수 없고」.
             제조사는 사진과 모델 이름으로 이미 알아본다. 조립은 vehicle-name SSOT(omitMaker) — 손으로 붙이지 않는다. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div title={listName(p)} style={{
              fontSize: FS.title, fontWeight: FW.title, color: C.ink, lineHeight: 1.2,
              minWidth: 0, flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{listName(p)}</div>
            {/* ★모바일 목록에는 출고상태·상품구분을 세우지 않는다(사장님 2026-08-28 「모바일에서
                출고가능 중고구독은 목록에서는 빼자고 했어 · 상세에만 넣고」).
                좁은 줄에 신호가 붙으면 차명이 밀려 잘린다. 상세에서 확인한다.
                ⚠ 웹 목록 행(위쪽 분기)은 폭이 있어 그대로 세운다 — 같은 컴포넌트라도 자리가 다르다. */}
          </div>

          {/* 2 차량번호 · 연식 */}
          <CardSpecs p={p} plateYear />

          {/* 3 대여료 · 보증금 · 최저~최대 운영기간
              PeriodRange 칩(h20) + 큰 금액 ascent로 행2↔3이 ~1px 넓어 보임 → 행 전체 -1 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.2,
            minWidth: 0, width: '100%', overflow: 'hidden',
            marginTop: -1,
          }}>
            <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
              <PriceAmounts align="start" />
            </div>
            <PeriodRange />
          </div>

          {/* 4 우대 */}
          <CardPerkLine p={p} inline withCredit />
        </PricePeekRoot>
      </Link>
      {/* ⋮메뉴 없음(사장님 2026-08-22 「모바일 상품목록에서 우측 세로점 빼자, 필요없다」) — 숨김·넘김은 웹 목록에서. */}
    </div>
  );
}
