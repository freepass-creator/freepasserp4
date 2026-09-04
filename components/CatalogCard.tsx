'use client';
import { memo } from 'react';
import Link from 'next/link';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, FS, FW, R_CARD, SH } from '@/components/ui';
import { CardThumb, OptionChips, productOptions } from '@/components/product-card-atoms';
import { cheapest, creditDisplay, CREDIT_UNSET } from '@/lib/domain/product';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import { yearFullDisplay, fuelDisplay } from '@/lib/domain/vehicle-master-format';
import { kmDisplay, manWon } from '@/lib/format';

/**
 * 손님 카탈로그 카드 — **시안 그대로**(사장님 2026-09-04 「니가 설계한 화면 그대로 해야지,
 * 기존 거는 원자·데이터만 쓴다」).
 *
 *   1 사진
 *   2 연식 + 차명
 *   3 연월 · 주행 · **차번**
 *   4 **월 대여료 — 카드에서 제일 큰 글자**
 *   5 보증금 · 기준 개월
 *   6 뱃지(무심사 · 당일출고)
 *
 * ★업무동 `ProductCard`(확정 규격 · docs/DESIGN_CONFIRMED_LIST_CARD.md)를 손대지 않는다.
 *   그 카드는 영업자용이라 **손님 화면에 안 맞는 것**이 셋 있다:
 *   ㉠ 차번이 없다(`CardSpecs` 는 audience='customer' 면 차번을 감춘다) — 실물 재고를
 *      파는 판에서 차번은 「이 차다」의 증거라 손님에게 보여도 되는 값이다(공개 화이트리스트에도 있다).
 *   ㉡ 월 대여료가 작다 — 손님이 카드에서 제일 먼저 보는 값인데 차명보다 작았다.
 *   ㉢ 값이 없으면 「미입력」이 그대로 뜬다 — 영업자에겐 «채워라»는 신호지만 손님에겐 흠집이다.
 *      여기서는 **빈 줄을 그냥 그리지 않는다.**
 *
 * ★색·치수는 토큰만 쓴다. `.fp-wl` 이 브랜드색으로 토큰을 뒤집으므로 채널이 바뀌어도 따라온다.
 */
export const CatalogCard = memo(function CatalogCard({ p, href }: {
  p: EntityRecord; href: string;
}) {
  const mobile = useIsMobile();
  const price = cheapest(p);
  const name = vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', fallback: 'none' });
  const title = [yearFullDisplay(p.year), name].filter(Boolean).join(' ') || '차량';
  /*
   * 메타 = 주행 · 연료 · 차번. 값이 없는 조각은 «빼고» 그린다(빈 칸·「미입력」을 손님에게 보이지 않는다).
   *
   * ★★주행거리 `0` 은 「0km」가 아니라 «모른다»다 — 찍지 않는다(2026-09-04 실측).
   *   손님에게 나가는 716대 중 **692대가 문자 「0」**이었다. 빈칸이 아니라 원천·정제가 0 을 채운 것이다.
   *   2015년식 스파크가 0km 일 수 없으니 그 0 은 값이 아니라 «빈칸의 다른 표기»다.
   *   「모르는 것을 0 이라고 말하지 않는다」(전역 규칙 2) — 24대만 진짜 값을 가졌고 그 24대는 그대로 찍힌다.
   *   ⚠ 공용 `kmDisplay` 는 안 고친다. 갓 출고된 신차의 0km 는 업무동에서 «진짜 0»일 수 있어,
   *     여기서 손님 화면의 판단만 얹는다(원자의 뜻을 바꾸면 콕핏이 같이 흔들린다).
   */
  const km = Number(String(p.mileage ?? '').replace(/[^0-9.]/g, '')) || 0;
  const meta = [km > 0 ? kmDisplay(p.mileage) : '', fuelDisplay(p.fuel_type), String(p.car_number || '').trim()]
    .filter(Boolean).join(' · ');
  // 「미입력」은 영업자에게 «채워라»는 신호일 뿐 손님에겐 흠집이다 — 뱃지로 내보내지 않는다.
  const creditRaw = creditDisplay(p);
  const credit = creditRaw && creditRaw !== CREDIT_UNSET ? creditRaw : '';
  const sameDay = /즉시출고|당일/.test(String(p.vehicle_status || ''));

  return (
    <Link href={href} onClick={() => haptic.nav()} className="fp-card"
      style={{
        display: 'flex', flexDirection: 'column', borderRadius: R_CARD, overflow: 'hidden',
        textDecoration: 'none', color: 'inherit',
        border: `1px solid ${C.line}`, boxShadow: SH.cardRest,
      }}>
      <CardThumb p={p} audience="customer" fill marks={false} />

      <div style={{ padding: mobile ? '13px 13px 15px' : '14px 14px 16px', display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
        <div style={{
          fontSize: mobile ? FS.title : 16.5, fontWeight: FW.title, color: C.ink,
          lineHeight: 1.4, letterSpacing: '-0.015em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={title}>{title}</div>

        {meta ? (
          <div style={{
            fontSize: FS.sub, color: C.mute, fontVariantNumeric: 'tabular-nums',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{meta}</div>
        ) : null}

        {/* 월 대여료 — 카드에서 제일 큰 글자. 손님이 제일 먼저 보는 값이다. */}
        {price && price.rent > 0 ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
              <span style={{ fontSize: FS.sub, color: C.mute }}>월</span>
              <span style={{
                fontSize: mobile ? 22 : 26, fontWeight: FW.head, color: C.ink,
                letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums',
              }}>{manWon(price.rent)}</span>
            </div>
            <div style={{ fontSize: FS.sub, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>
              {price.deposit > 0 ? `보증금 ${manWon(price.deposit)}` : '보증금 없음'} · {price.m}개월 기준
            </div>
          </>
        ) : null}

        {/*
          * 탑재 옵션 한 줄 — 참고 시안이 카드 바닥에 옵션 칩을 깔아 둔 것을 가져왔다.
          * 값이 실제로 있다(716대 중 472대). 손님은 같은 차명·같은 요금 사이에서
          * **무엇이 달렸나**로 고르는데, 지금 카드는 그 줄이 없어 차들이 서로 구분되지 않았다.
          * ★개수로 자르지 않는다 — `OptionChips` 가 카드 폭을 재서 들어가는 만큼 채우고
          *   못 들어간 게 있을 때만 … 를 붙인다(원자가 이미 그렇게 짜여 있다).
          */}
        {productOptions(p).length ? (
          <div style={{ marginTop: 1 }}><OptionChips p={p} clamp /></div>
        ) : null}

        {(credit || sameDay) ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
            {credit ? (
              <span style={{
                padding: '4px 9px', borderRadius: 6, border: `1px solid ${C.line}`,
                fontSize: FS.cap, fontWeight: FW.strong, color: C.sub,
              }}>{credit}</span>
            ) : null}
            {sameDay ? (
              <span style={{
                padding: '4px 9px', borderRadius: 6, background: C.warnBg,
                fontSize: FS.cap, fontWeight: FW.strong, color: C.warn,
              }}>당일출고</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Link>
  );
});
