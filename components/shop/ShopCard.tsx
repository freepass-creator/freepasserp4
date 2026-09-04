'use client';
import { memo } from 'react';
import Link from 'next/link';
import { Heart, ImageOff } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { Badge, C, FW, FS, ICON, PERK_TONE, CREDIT_TONE, type BadgeTone } from '@/components/ui';
import { SHOP } from '@/components/shop/shop-ui';
import { useIsMobile } from '@/lib/use-mobile';
import { useInView } from '@/lib/use-in-view';
import { useFirstPhoto } from '@/components/use-product-photos';
import { haptic } from '@/lib/haptics';
import { cheapest, creditDisplay, CREDIT_UNSET } from '@/lib/domain/product';
import { PERKS, hasPerk } from '@/lib/domain/product-filters';
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
 * ★★글줄은 **넷**이다(사장님 2026-09-04 「세부 모델 세부 트림을 한 줄로 넣고, 그다음 줄에
 *   차량번호 연식 주행거리 배기량 연료, 그다음 줄에 기간 대여료 보증금, 그다음 줄에는 우대 조건
 *   같은 거… 심사 조건 분납 가능한 거 그런 거 뱃지로 들어가거나 우리 그 ERP에서 쓰는 거」).
 *
 *   ① 사진 — 크게. **위에 아무것도 안 얹는다.**
 *   ② 세부모델 · 세부트림          — 무슨 차인가
 *   ③ 차번 · 연식 · 주행 · 배기량 · 연료 — 어떤 차인가
 *   ④ 기간 · 대여료 · 보증금        — 얼마인가 (한 줄에 셋 · 가로 공간을 쓴다)
 *   ⑤ 뱃지 — 심사 · 분납가능 · 무보증 · 만21세 · 경력무관 · 무사고 · 당일출고
 *
 *   ⚠ 옵션 줄은 뺐다. 사장님이 위 넷을 짚으시며 「그 정도면 심플할 것 같은데?」 하셨고,
 *     옵션은 «고르는 값»이 아니라 상세에서 볼 값이다. 되살릴 일이 있으면 ⑤ 아래에 한 줄로 붙인다.
 *
 * ★업무동 `ProductCard`(확정 규격)를 쓰지 않는다. 그 카드는 영업자용이라 손님 화면에 안 맞는
 *   것이 셋이다: 차번을 감추고(손님에겐 「이 차다」의 증거다), 월 대여료가 차명보다 작고,
 *   값이 없으면 「미입력」이 그대로 뜬다(영업자에겐 «채워라»는 신호지만 손님에겐 흠집이다).
 * ★우대조건은 **ERP `Badge` 원자**를 그대로 쓴다(사장님 2026-09-04 「뱃지로 들어가거나 우리
 *   그 ERP에서 쓰는 거 있잖아」). 08-28·08-30 의 「박스 뱃지 쓰지 마라」는 **썸네일 우하의
 *   신호 뱃지**를 두고 하신 말이고(그건 아이콘+글자로 바뀌었다), 우대조건처럼 «여럿을 나란히
 *   구분해 보여야 하는» 값은 뱃지가 제 일을 한다. 톤도 ERP 와 같은 맵(CREDIT_TONE·PERK_TONE)이라
 *   영업자 화면에서 초록이던 「무심사」가 손님 화면에서도 초록이다.
 */
export const ShopCard = memo(function ShopCard({ p, href, faved, onFav }: {
  p: EntityRecord;
  href: string;
  faved?: boolean;
  onFav?: (code: string) => void;
}) {
  const mobile = useIsMobile();
  const price = cheapest(p);
  /*
   * ② 줄 — 세부모델 · 세부트림. **연식을 앞에 붙이지 않는다**(사장님 2026-09-04 — 연식은 아래
   * ③ 줄로 갔다). 「2026 현대 베뉴 QX1 프리미엄」처럼 앞에 숫자가 서면 그게 트림 숫자와 섞여
   * 차 이름이 한 번에 안 읽힌다. 이름 줄은 이름만 든다.
   * ★이름은 `vehicleNameOf`(제조사+세부모델+세부트림) 정본을 그대로 쓴다 — 손으로 조립하면
   *   업무동과 손님 화면의 차명이 갈린다(차명 정본은 docs/차종명명-정제-매뉴얼).
   */
  const title = vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', fallback: 'none' }) || '차량';
  const code = String(p.product_code || '');

  /*
   * ③ 줄 — 차번 · 연식 · 주행 · 배기량 · 연료. 없는 조각은 빼고 그린다(빈 칸을 안 보여준다).
   *
   * ★★주행거리 `0` 은 「0km」가 아니라 «모른다»다 — 찍지 않는다(2026-09-04 실측).
   *   손님에게 나가는 716대 중 **692대가 문자 「0」**이었다. 빈칸이 아니라 원천·정제가 0 을 채운
   *   것이라 2015년식 스파크도 0km 였다. 모르는 것을 0 이라고 말하지 않는다(전역 규칙 2).
   * ★차번이 이 줄의 맨 앞이다 — 사진 위도 아니고 옵션 옆도 아니다(사장님 2026-09-04).
   *   실물 재고를 파는 판에서 「이 차다」의 증거라 차를 «설명하는» 줄에 함께 서는 것이 맞다.
   */
  const km = Number(String(p.mileage ?? '').replace(/[^0-9.]/g, '')) || 0;
  const cc = Number(p.engine_cc) || 0;
  const facts = [
    String(p.car_number || '').trim(),
    yearFullDisplay(p.year),
    km > 0 ? kmDisplay(p.mileage) : '',
    cc > 0 ? `${cc.toLocaleString('ko-KR')}cc` : '',
    fuelDisplay(p.fuel_type) || String(p.fuel_type || '').trim(),
  ].filter(Boolean).join(' · ');

  /*
   * ⑤ 줄 — 우대조건 뱃지. 저신용·무심사 손님이 «되나 안 되나»를 재는 값이라 옵션보다 먼저 본다.
   * 심사(무심사·소득확인) + 혜택(분납가능·무보증·만21세·경력무관·무사고) + 당일출고.
   * ★`PERKS` 를 쓴다 — 카탈로그용 `CATALOG_PERKS` 에는 **분납가능이 빠져 있다.**
   *   사장님이 콕 집어 말씀하신 값이라 그게 들어가는 목록으로 바꿨다.
   * 「미입력」은 영업자에게 «채워라»는 신호일 뿐 손님에겐 흠집이라 내보내지 않는다.
   */
  const creditRaw = creditDisplay(p);
  const credit = creditRaw && creditRaw !== CREDIT_UNSET ? creditRaw : '';
  const sameDay = /즉시출고|당일/.test(String(p.vehicle_status || ''));
  const badges: { text: string; tone: BadgeTone; perk?: boolean }[] = [
    ...(credit ? [{ text: credit, tone: CREDIT_TONE(credit) }] : []),
    ...PERKS.filter((k) => hasPerk(p, k)).map((k) => ({
      text: k as string,
      tone: (PERK_TONE as Record<string, BadgeTone>)[k] || ('blue' as BadgeTone),
      perk: true,
    })),
    ...(sameDay ? [{ text: '당일출고', tone: 'green' as BadgeTone }] : []),
  ];

  return (
    <div style={{ position: 'relative' }}>
      {/*
        ★테두리 상자를 걷었다(2026-09-04 마감 손질). 흰 바탕에 흰 카드를 1px 선으로 가두면
          선이 격자마다 두 겹으로 겹쳐 화면이 그물처럼 보인다. 요즘 커머스(무신사·29CM·당근)는
          **사진만 둥글게 하고 글자는 그냥 밑에** 둔다 — 카드를 «나누는» 것은 선이 아니라 여백이다.
          사진 없는 차도 둥근 회색 판이라 네모난 빈 상자보다 낫다.
      */}
      <Link href={href} onClick={() => haptic.nav()} className="fp-shop-card"
        style={{
          display: 'flex', flexDirection: 'column', height: '100%',
          textDecoration: 'none', color: 'inherit',
        }}>
        <ShopThumb p={p} />

        <div style={{
          padding: mobile ? '12px 2px 2px' : '13px 2px 2px',
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

          {facts ? (
            <div style={{
              fontSize: SHOP.fs.sub, color: C.mute, fontVariantNumeric: 'tabular-nums',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{facts}</div>
          ) : null}

          {/*
            ④ 기간 · 대여료 · 보증금 — **한 줄에 셋**(사장님 2026-09-04 「대여료 같은 데 공간
            많이 남잖아, 그런 것들 활용해 가지고」). 셋을 각각 한 줄씩 쓰면 카드가 세로로만 길어지고
            가로는 텅 빈다. 한 줄에 세우면 손님이 «얼마에 얼마 걸고 몇 달» 을 한눈에 읽는다.
            ★위계는 크기로 낸다 — 대여료만 크고, 기간·보증금은 그 옆에 붙은 조건이다.
            ⚠ 「35만」으로 «반올림»하지 않는다 — 손님이 보는 금액은 낼 금액이다.
              글자를 줄이는 것은 되고, 값을 줄이는 것은 안 된다.
          */}
          {price && price.rent > 0 ? (
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 5,
              minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap',
            }}>
              <span style={{ fontSize: SHOP.fs.sub, color: C.mute, flex: '0 0 auto' }}>
                {price.m}개월
              </span>
              <span style={{
                fontSize: mobile ? 25 : 24, fontWeight: FW.head, color: C.ink, flex: '0 0 auto',
                letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums',
              }}>{manWon(price.rent)}</span>
              <span style={{
                fontSize: SHOP.fs.sub, color: C.mute, flex: '0 1 auto',
                minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {price.deposit > 0 ? `보증금 ${manWon(price.deposit)}` : '보증금 없음'}
              </span>
            </div>
          ) : null}

          {/*
            ⑤ 우대조건 — ERP `Badge` 원자. 톤도 ERP 와 같은 맵이라 영업자 화면에서 초록이던
            「무심사」가 손님 화면에서도 초록이다(두 화면을 오가는 사람이 다시 배우지 않는다).
            ★글자는 sub(12) — 기본 micro(10)는 콕핏 표에서 쓰는 크기라 손님 화면에서 안 읽힌다.
          */}
          {badges.length ? (
            <div style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5,
              marginTop: 'auto', paddingTop: 10,
            }}>
              {badges.map((b) => (
                <Badge key={b.text} tone={b.tone} variant={b.perk ? 'perk' : 'line'} size={FS.sub}>
                  {b.text}
                </Badge>
              ))}
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
          className="fp-shop-press"
          style={{
            position: 'absolute', top: 10, right: 10,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: 999, cursor: 'pointer', border: 'none',
            /*
             * 유리 느낌 — 사진 위에서는 반투명이라 사진이 비치고, 사진 없는 회색 판 위에서도
             * 아이콘이 보인다. 흰 동그라미를 꽉 채우면 사진 위에 스티커를 붙인 것처럼 튄다.
             * `backdrop-filter` 를 못 쓰는 브라우저는 아래 반투명 흰색만 남아 그대로 읽힌다.
             */
            background: 'rgba(255,255,255,0.62)',
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            color: faved ? C.danger : C.sub,
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
 * ★사진 위에는 **아무것도 얹지 않는다**(사장님 2026-09-04 「차량 번호가 사진에 들어가, 공간이
 *   있는데도 불구하고 사진에 들어갈 필요는 없을 것 같고」). 사진 위 글자는 어떤 사진이 오느냐에
 *   따라 읽히기도 하고 안 읽히기도 한다 — 밑에 자리가 남는데 굳이 그럴 이유가 없다.
 */
function ShopThumb({ p }: { p: EntityRecord }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const photo = useFirstPhoto(p, 640, inView);
  return (
    <div ref={ref} className="fp-shop-thumb" style={{
      position: 'relative', aspectRatio: '4 / 3', overflow: 'hidden',
      background: C.placeholder, borderRadius: SHOP.r.card,
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
    </div>
  );
}
