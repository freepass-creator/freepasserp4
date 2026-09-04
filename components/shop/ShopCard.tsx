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
import { CATALOG_PERKS, hasPerk } from '@/lib/domain/product-filters';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import { yearFullDisplay, fuelDisplay } from '@/lib/domain/vehicle-master-format';
import { kmDisplay, manWon } from '@/lib/format';

/**
 * 가게 카드 — 손님이 이 화면에서 «고르는 단위».
 *
 * ★★**세로 한 종류다**(사장님 2026-09-04 「그냥 가로 타입 말고 세로 타입으로 크게 사진 그리고
 *   차량 스펙 대여료 뭐 우대사항 이런 하자. 가로로 할 필요가 없을 것 같다. 어차피 검색해서 찾을
 *   놈은 거고 우리가 뭐 몇 만 몇 만 개 있는 것도 아니고」).
 *   가로형(당근 형태)을 잠깐 넣었다가 걷어냈다 — 가로형이 이기는 판은 «매물이 수만 개라 훑어야
 *   하는» 곳이다. 우리는 716대고 손님은 조건으로 좁혀서 온다. 좁혀 놓고 보는 화면이면
 *   한 대를 **제대로** 보여 주는 편이 낫다. 그래서 폰도 한 줄에 한 대, 사진을 크게 쓴다.
 *
 * 읽는 순서대로 쌓는다.
 *   ① 사진(크게)  ② 연식 + 차명  ③ 차량 스펙(연료·배기량·인승·구동·주행)
 *   ④ 월 대여료(제일 큰 글자)     ⑤ 보증금 · 기준 개월
 *   ⑥ **우대사항**(심사·무보증·만21세·경력무관·당일출고)  ⑦ 옵션
 *
 * ★업무동 `ProductCard`(확정 규격)를 쓰지 않는다. 그 카드는 영업자용이라 손님 화면에 안 맞는
 *   것이 셋이다: 차번을 감추고(손님에겐 「이 차다」의 증거다), 월 대여료가 차명보다 작고,
 *   값이 없으면 「미입력」이 그대로 뜬다(영업자에겐 «채워라»는 신호지만 손님에겐 흠집이다).
 * ★★박스 뱃지를 쓰지 않는다(사장님 2026-08-28·08-30 두 번 「박스 뱃지 쓰지 말고 아이콘
 *   텍스트로, 모든 곳에서」). 우대사항은 색 글자 조각으로 말한다.
 */
export const ShopCard = memo(function ShopCard({ p, href, faved, onFav }: {
  p: EntityRecord;
  href: string;
  faved?: boolean;
  onFav?: (code: string) => void;
}) {
  const mobile = useIsMobile();
  const price = cheapest(p);
  const name = vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', fallback: 'none' });
  const title = [yearFullDisplay(p.year), name].filter(Boolean).join(' ') || '차량';
  const code = String(p.product_code || '');

  /*
   * 차량 스펙 — 손님이 차를 «가늠하는» 값들. 없는 조각은 빼고 그린다(빈 칸을 안 보여준다).
   *
   * ★★주행거리 `0` 은 「0km」가 아니라 «모른다»다 — 찍지 않는다(2026-09-04 실측).
   *   손님에게 나가는 716대 중 **692대가 문자 「0」**이었다. 빈칸이 아니라 원천·정제가 0 을 채운
   *   것이라 2015년식 스파크도 0km 였다. 모르는 것을 0 이라고 말하지 않는다(전역 규칙 2).
   * ★배기량·인승·구동은 실측으로 대부분 차 있다(engine_cc 716 · seats 555 · drive_type 618).
   *   주행거리가 비어 있는 만큼 이 셋이 「차를 가늠하는」 자리를 대신한다.
   */
  const km = Number(String(p.mileage ?? '').replace(/[^0-9.]/g, '')) || 0;
  const cc = Number(p.engine_cc) || 0;
  const seats = Number(p.seats) || 0;
  const specs = [
    fuelDisplay(p.fuel_type) || String(p.fuel_type || '').trim(),
    cc > 0 ? `${cc.toLocaleString('ko-KR')}cc` : '',
    seats > 0 ? `${seats}인승` : '',
    String(p.drive_type || '').trim(),
    km > 0 ? kmDisplay(p.mileage) : '',
  ].filter(Boolean).join(' · ');

  /*
   * 우대사항 — 저신용·무심사 손님이 «되나 안 되나»를 재는 값이다. 이 판에서는 옵션보다 먼저 본다.
   * 심사(무심사·소득확인)와 혜택(무보증·만21세·경력무관·무사고)은 성격이 같아 한 줄에 세운다.
   * 「미입력」은 영업자에게 «채워라»는 신호일 뿐 손님에겐 흠집이라 내보내지 않는다.
   */
  const creditRaw = creditDisplay(p);
  const credit = creditRaw && creditRaw !== CREDIT_UNSET ? creditRaw : '';
  const sameDay = /즉시출고|당일/.test(String(p.vehicle_status || ''));
  const marks: { text: string; tone: string }[] = [
    ...(credit ? [{ text: credit, tone: C.brand }] : []),
    ...CATALOG_PERKS.filter((k) => hasPerk(p, k)).map((k) => ({ text: k, tone: C.brand })),
    ...(sameDay ? [{ text: '당일출고', tone: C.ok }] : []),
  ];

  const options = parseProductOptions(p.options);
  const plate = String(p.car_number || '').trim();

  return (
    <div style={{ position: 'relative' }}>
      <Link href={href} onClick={() => haptic.nav()}
        style={{
          display: 'flex', flexDirection: 'column', height: '100%',
          borderRadius: SHOP.r.card, overflow: 'hidden', textDecoration: 'none', color: 'inherit',
          border: `1px solid ${C.line}`, background: C.bg,
        }}>
        <ShopThumb p={p} plate={plate} />

        <div style={{
          padding: mobile ? '15px 15px 17px' : '15px 15px 17px',
          display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1,
        }}>
          {/*
            차명 — 두 줄로 접히면 카드마다 높이가 달라져 목록이 들쭉날쭉해진다. 한 줄로 못 박고
            넘치면 … 로 자른다(전문은 title 속성이 들고 있고, 상세로 들어가면 다 보인다).
          */}
          <div style={{
            fontSize: SHOP.fs.h2, fontWeight: 700, color: C.ink,
            lineHeight: 1.35, letterSpacing: '-0.02em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={title}>{title}</div>

          {specs ? (
            <div style={{
              fontSize: SHOP.fs.sub, color: C.mute, fontVariantNumeric: 'tabular-nums',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{specs}</div>
          ) : null}

          {price && price.rent > 0 ? (
            <>
              {/*
                ★한 줄로 못 박는다(`nowrap`). 접히면 카드마다 높이가 달라진다.
                ⚠ 그렇다고 「35만」으로 «반올림»하지 않는다 — 손님이 보는 금액은 낼 금액이다.
                  글자를 줄이는 것은 되고, 값을 줄이는 것은 안 된다.
              */}
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4,
                minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                <span style={{ fontSize: SHOP.fs.sub, color: C.mute, flex: '0 0 auto' }}>월</span>
                <span style={{
                  fontSize: mobile ? 27 : 26, fontWeight: 800, color: C.ink,
                  letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums',
                }}>{manWon(price.rent)}</span>
              </div>
              <div style={{ fontSize: SHOP.fs.sub, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>
                {price.deposit > 0 ? `보증금 ${manWon(price.deposit)}` : '보증금 없음'} · {price.m}개월 기준
              </div>
            </>
          ) : null}

          {/* 우대사항 — 「·」로 이어 한 줄. 박스로 감싸면 개수만큼 네모가 늘어 카드가 시끄러워진다. */}
          {marks.length ? (
            <div style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 4,
              fontSize: SHOP.fs.sub, fontWeight: 700,
            }}>
              {marks.map((m, i) => (
                <span key={m.text} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  {i > 0 ? <span aria-hidden style={{ color: C.line, fontWeight: 400 }}>·</span> : null}
                  <span style={{ color: m.tone }}>{m.text}</span>
                </span>
              ))}
            </div>
          ) : null}

          {options.length ? (
            <div style={{
              display: 'flex', gap: 5, marginTop: 'auto', paddingTop: 9,
              minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap',
            }}>
              {options.slice(0, 3).map((o) => (
                <span key={o} style={{
                  // ★칩을 «줄이지» 않는다 — 줄이게 두면 「내…」「블…」처럼 두세 글자만 남아
                  //   무슨 옵션인지 알 수 없다. 못 들어가는 칩은 통째로 잘린다(바깥 overflow hidden).
                  flex: '0 0 auto',
                  padding: '4px 9px', borderRadius: SHOP.r.chip, background: C.zebra,
                  fontSize: SHOP.fs.cap, color: C.sub,
                }}>{o}</span>
              ))}
              {options.length > 3 ? (
                <span style={{ flex: '0 0 auto', alignSelf: 'center', fontSize: SHOP.fs.cap, color: C.faint }}>
                  +{options.length - 3}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Link>

      {/*
        관심 표시 — 카드 «위»에 따로 올린다. Link 안에 두면 하트를 누를 때마다 상세로 넘어간다.
        손님이 여러 대를 두고 고민하는 것이 이 장사의 정상 흐름이라 담아 둘 곳이 있어야 한다.
        자리는 **사진 위 오른쪽** — 글자 위에 얹으면 차명을 가린다.
      */}
      {onFav ? (
        <button type="button" aria-pressed={!!faved}
          aria-label={faved ? '관심 차량에서 빼기' : '관심 차량으로 담기'}
          onClick={(e) => { e.preventDefault(); haptic.tap(); onFav(code); }}
          style={{
            position: 'absolute', top: 10, right: 10,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: 999, cursor: 'pointer',
            border: 'none', background: 'rgba(255,255,255,0.92)',
            color: faved ? C.danger : C.mute,
          }}>
          <Heart size={ICON.lg} aria-hidden fill={faved ? 'currentColor' : 'none'} />
        </button>
      ) : null}
    </div>
  );
});

/**
 * 썸네일 — **4:3, 카드 폭을 꽉 채운다.**
 *
 * ★화면에 가까워졌을 때만 사진을 부른다(`useInView`). 카드가 마운트되자마자 전부 부르면
 *   폴더 해석(`/api/extract-photos`)이 줄줄이 밀려 꼬리가 길어진다.
 * ★사진 없는 차가 실측 28% 다. 세로 큰 카드에서는 그 자리가 크게 비므로 회색 판만 두지 말고
 *   «없다»고 조용히 말한다 — 고장이 아니라 준비 중임을 알아야 손님이 그 차를 안 건너뛴다.
 * ★차번은 **사진 위 왼쪽 아래**로 내렸다. 「이 차다」의 증거라 손님에게 보여도 되는 값이지만,
 *   스펙 줄에 끼워 두면 연료·배기량 같은 «고르는 값» 사이에 섞여 줄만 길어진다.
 */
function ShopThumb({ p, plate }: { p: EntityRecord; plate?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const photo = useFirstPhoto(p, 640, inView);
  return (
    <div ref={ref} style={{
      position: 'relative', aspectRatio: '4 / 3', background: C.placeholder, overflow: 'hidden',
    }}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- 원본은 외부 도메인(프록시 경유)이라 next/image 최적화 대상이 아니다.
        <img src={photo} alt="" loading="lazy" decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 7, color: C.faint,
        }}>
          <ImageOff size={24} aria-hidden />
          <span style={{ fontSize: SHOP.fs.cap }}>사진 준비 중</span>
        </div>
      )}
      {plate ? (
        <span style={{
          position: 'absolute', left: 10, bottom: 10,
          padding: '3px 9px', borderRadius: SHOP.r.chip,
          background: 'rgba(255,255,255,0.92)',
          fontSize: SHOP.fs.cap, fontWeight: 700, color: C.sub,
          fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em',
        }}>{plate}</span>
      ) : null}
    </div>
  );
}
