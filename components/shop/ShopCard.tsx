'use client';
import { memo } from 'react';
import Link from 'next/link';
import { Heart, ImageOff } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { C, ICON } from '@/components/ui';
import { SHOP } from '@/components/shop/shop-ui';
import { useIsMobile } from '@/lib/use-mobile';
import { useInView } from '@/lib/use-in-view';
import { useFirstPhoto } from '@/components/use-product-photos';
import { haptic } from '@/lib/haptics';
import { cheapest, creditDisplay, CREDIT_UNSET, parseProductOptions } from '@/lib/domain/product';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import { yearFullDisplay, fuelDisplay } from '@/lib/domain/vehicle-master-format';
import { kmDisplay, manWon } from '@/lib/format';

/**
 * 가게 카드 — 손님이 이 화면에서 «고르는 단위».
 *
 * ★업무동 `ProductCard`(확정 규격)를 쓰지 않는다. 그 카드는 영업자용이라 손님 화면에 안 맞는
 *   것이 셋이다: 차번을 감추고(손님에겐 「이 차다」의 증거다), 월 대여료가 차명보다 작고,
 *   값이 없으면 「미입력」이 그대로 뜬다(영업자에겐 «채워라»는 신호지만 손님에겐 흠집이다).
 *
 * 읽는 순서대로 쌓는다 — 마켓 카드가 다 이 순서다.
 *   ① 사진        ② 연식 + 차명      ③ 주행 · 연료 · 차번
 *   ④ 월 대여료(제일 큰 글자)         ⑤ 보증금 · 기준 개월
 *   ⑥ 옵션 한 줄  ⑦ 심사·출고 표시
 *
 * ★★박스 뱃지를 쓰지 않는다(사장님 2026-08-28·08-30 두 번 「박스 뱃지 쓰지 말고 아이콘
 *   텍스트로, 모든 곳에서」). 심사·출고는 색 글자 한 조각으로 말한다.
 */
export const ShopCard = memo(function ShopCard({ p, href, faved, onFav, layout = 'grid' }: {
  p: EntityRecord;
  href: string;
  faved?: boolean;
  onFav?: (code: string) => void;
  /**
   * 어떻게 세울까.
   *   grid — 사진 위 · 글자 아래. 웹 3열.
   *   row  — 사진 왼쪽 · 글자 오른쪽(당근 형태). **폰의 기본**.
   *
   * ★★폰을 가로형으로 정한 근거는 «우리 데이터»다(2026-09-04 실측).
   *   ㉠ 사진이 **28% 는 아예 없다.** 세로 큰 카드는 사진이 주인공일 때 이기는 형태인데,
   *      사진 없는 차가 큰 회색 판으로 한 자리씩 차지하면 목록이 고장 난 것처럼 보인다.
   *   ㉡ 있는 사진도 죄다 비슷한 렌터카 실사라 **손님이 사진으로 고르지 않는다.**
   *      실제로 고르는 값은 월 대여료·보증금·연식인데 그건 전부 글자다.
   *   ㉢ 가로형은 한 화면에 4~5대가 들어와 **금액 비교가 된다.** 세로 2열은 4대에서 끝난다.
   *   당근·번개장터가 가로인 이유가 같다 — 사진보다 «조건»으로 고르는 판이라서다.
   */
  layout?: 'grid' | 'row';
}) {
  const mobile = useIsMobile();
  const price = cheapest(p);
  const name = vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', fallback: 'none' });
  const title = [yearFullDisplay(p.year), name].filter(Boolean).join(' ') || '차량';
  const code = String(p.product_code || '');

  /*
   * 주행거리 `0` 은 「0km」가 아니라 «모른다»다 — 찍지 않는다(2026-09-04 실측).
   * 손님에게 나가는 716대 중 **692대가 문자 「0」**이었다. 빈칸이 아니라 원천·정제가 0 을 채운
   * 것이라 2015년식 스파크도 0km 였다. 모르는 것을 0 이라고 말하지 않는다(전역 규칙 2).
   */
  const km = Number(String(p.mileage ?? '').replace(/[^0-9.]/g, '')) || 0;
  const meta = [km > 0 ? kmDisplay(p.mileage) : '', fuelDisplay(p.fuel_type), String(p.car_number || '').trim()]
    .filter(Boolean).join(' · ');

  const creditRaw = creditDisplay(p);
  const credit = creditRaw && creditRaw !== CREDIT_UNSET ? creditRaw : '';
  const sameDay = /즉시출고|당일/.test(String(p.vehicle_status || ''));
  const options = parseProductOptions(p.options);
  // 폰은 2열이라 카드가 좁다 — 칩 하나 + 「+N」이면 «옵션이 있다»는 신호로 충분하다.
  const maxChips = layout === 'row' ? 2 : 3;

  const row = layout === 'row';
  return (
    <div style={{ position: 'relative' }}>
      <Link href={href} onClick={() => haptic.nav()}
        style={{
          display: 'flex', flexDirection: row ? 'row' : 'column', height: '100%',
          gap: row ? 13 : 0, alignItems: row ? 'stretch' : undefined,
          borderRadius: SHOP.r.card, overflow: 'hidden', textDecoration: 'none', color: 'inherit',
          border: `1px solid ${C.line}`, background: C.bg,
          padding: row ? 12 : 0,
        }}>
        <ShopThumb p={p} row={row} />

        <div style={{
          padding: row ? 0 : (mobile ? '14px 14px 16px' : '15px 15px 17px'),
          // 가로카드는 하트가 오른쪽 위에 얹히므로 글자가 그 밑으로 들어가지 않게 자리를 비운다.
          paddingRight: row ? 32 : undefined,
          display: 'flex', flexDirection: 'column', gap: row ? 4 : 7, minWidth: 0, flex: 1,
          justifyContent: row ? 'center' : undefined,
        }}>
          <div style={{
            fontSize: row ? SHOP.fs.body : (mobile ? SHOP.fs.body : SHOP.fs.h2), fontWeight: 700, color: C.ink,
            lineHeight: 1.4, letterSpacing: '-0.02em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={title}>{title}</div>

          {meta ? (
            <div style={{
              fontSize: SHOP.fs.cap, color: C.mute, fontVariantNumeric: 'tabular-nums',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{meta}</div>
          ) : null}

          {price && price.rent > 0 ? (
            <>
              {/*
                ★한 줄로 못 박는다(`nowrap`). 접히면 카드마다 높이가 달라져 격자가 들쭉날쭉해진다.
                  폰 2열에서 「34만 5,000원」이 실제로 두 줄이 됐다(2026-09-04 실측).
                ⚠ 그렇다고 「35만」으로 «반올림»하지 않는다 — 손님이 보는 금액은 낼 금액이다.
                  글자를 줄이는 것은 되고, 값을 줄이는 것은 안 된다.
              */}
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 2,
                minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                <span style={{ fontSize: SHOP.fs.cap, color: C.mute, flex: '0 0 auto' }}>월</span>
                <span style={{
                  fontSize: row ? 21 : (mobile ? 19 : 26), fontWeight: 800, color: C.ink,
                  letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums',
                }}>{manWon(price.rent)}</span>
              </div>
              <div style={{ fontSize: SHOP.fs.cap, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>
                {price.deposit > 0 ? `보증금 ${manWon(price.deposit)}` : '보증금 없음'} · {price.m}개월 기준
              </div>
            </>
          ) : null}

          {/*
            옵션 한 줄 — 손님은 같은 차명·같은 요금 사이에서 «무엇이 달렸나»로 고른다.
            셋까지만 세우고 나머지는 「+N」. 줄이 접히면 카드 높이가 서로 어긋나 격자가 흔들린다.
          */}
          {options.length ? (
            <div style={{ display: 'flex', gap: 5, marginTop: 2, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {options.slice(0, maxChips).map((o) => (
                <span key={o} style={{
                  // ★칩을 «줄이지» 않는다(2026-09-04 실측). 줄이게 두면 폰 2열에서 「내…」「블…」처럼
                  //   두세 글자만 남아 옵션이 무엇인지 알 수 없다 — 자리만 먹고 뜻은 없는 꼴이다.
                  //   차라리 못 들어가는 칩은 통째로 잘린다(바깥 overflow hidden).
                  flex: '0 0 auto',
                  padding: '3px 8px', borderRadius: SHOP.r.chip, background: C.zebra,
                  fontSize: SHOP.fs.cap, color: C.sub,
                }}>{o}</span>
              ))}
              {options.length > maxChips ? (
                <span style={{ flex: '0 0 auto', alignSelf: 'center', fontSize: SHOP.fs.cap, color: C.faint }}>
                  +{options.length - maxChips}
                </span>
              ) : null}
            </div>
          ) : null}

          {(credit || sameDay) ? (
            <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 6, fontSize: SHOP.fs.cap, fontWeight: 700 }}>
              {credit ? <span style={{ color: C.brand }}>{credit}</span> : null}
              {sameDay ? <span style={{ color: C.ok }}>당일출고</span> : null}
            </div>
          ) : null}
        </div>
      </Link>

      {/*
        관심 표시 — 카드 «위»에 따로 올린다. Link 안에 두면 하트를 누를 때마다 상세로 넘어간다.
        손님이 여러 대를 두고 고민하는 것이 이 장사의 정상 흐름이라, 담아 둘 곳이 있어야 한다.
      */}
      {onFav ? (
        <button type="button" aria-pressed={!!faved}
          aria-label={faved ? '관심 차량에서 빼기' : '관심 차량으로 담기'}
          onClick={(e) => { e.preventDefault(); haptic.tap(); onFav(code); }}
          style={{
            position: 'absolute', top: row ? 6 : 10, right: row ? 6 : 10,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: 999, cursor: 'pointer',
            border: 'none', background: row ? 'transparent' : 'rgba(255,255,255,0.92)',
            color: faved ? C.danger : C.mute,
          }}>
          <Heart size={ICON.lg} aria-hidden fill={faved ? 'currentColor' : 'none'} />
        </button>
      ) : null}
    </div>
  );
});

/**
 * 썸네일 — 4:3.
 *
 * ★화면에 가까워졌을 때만 사진을 부른다(`useInView`). 카드 100장이 마운트되자마자 전부
 *   부르면 폴더 해석(`/api/extract-photos`)이 줄줄이 밀려 꼬리가 길어진다.
 * ★사진이 없는 차가 실측 28% 다. 그 자리를 «회색 빈 판»으로 두면 카드가 고장 난 것처럼 보이므로,
 *   조용한 표시 하나를 둔다 — 없는 것을 없다고 말하되 시끄럽지 않게.
 */
function ShopThumb({ p, row }: { p: EntityRecord; row?: boolean }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const photo = useFirstPhoto(p, row ? 320 : 640, inView);
  return (
    <div ref={ref} style={{
      position: 'relative', aspectRatio: '4 / 3', background: C.placeholder, overflow: 'hidden',
      // 가로형은 폭을 못 박는다 — 글자 쪽이 남는 폭을 다 가져가야 차명·금액이 한 줄에 선다.
      ...(row ? { width: 112, flex: '0 0 112px', borderRadius: SHOP.r.box } : null),
    }}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- 원본은 외부 도메인(프록시 경유)이라 next/image 최적화 대상이 아니다.
        <img src={photo} alt="" loading="lazy" decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6, color: C.faint,
        }}>
          <ImageOff size={row ? 18 : 22} aria-hidden />
          {!row ? <span style={{ fontSize: SHOP.fs.cap }}>사진 준비 중</span> : null}
        </div>
      )}
    </div>
  );
}
