'use client';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Phone } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { Badge, C, FS, ICON, PERK_TONE, CREDIT_TONE, type BadgeTone } from '@/components/ui';
import { SHOP, ShopPill } from '@/components/shop/shop-ui';
import { useIsMobile } from '@/lib/use-mobile';
import { useProductPhotos } from '@/components/use-product-photos';
import { haptic } from '@/lib/haptics';
import { creditDisplay, CREDIT_UNSET, parseProductOptions, priceList } from '@/lib/domain/product';
import { PERKS, hasPerk } from '@/lib/domain/product-filters';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import { yearFullDisplay, fuelDisplay, makerDisplay } from '@/lib/domain/vehicle-master-format';
import { kmDisplay, manWon } from '@/lib/format';

/**
 * 가게 상세 — 손님이 «이 차로 할까»를 정하는 화면.
 *
 * 사장님 2026-09-04 「상세페이지는 어떻게 할 거야, 이것도 다 베껴 와 그냥 트렌드대로 해」.
 *
 * ★업무동 `ProductDetail`(audience=customer)을 쓰지 않는다. 그건 영업자 콕핏 부품이라
 *   화이트라벨 띠만 둘러 놓으면 「우리 사이트처럼 보이다가 안을 열면 남의 ERP」가 된다 —
 *   목록에서 겪은 것과 같은 문제다(2026-09-04 동 분리).
 *
 * 짜임 — 차 파는 사이트가 공통으로 쓰는 순서 그대로다.
 *   ① 사진 — 큰 것 하나 + 좌우로 넘기기 + 「n / N」
 *   ② 차명 · 사실 한 줄 · 우대조건 뱃지
 *   ③ **기간을 고르면 값이 바뀐다** — 우리가 진짜 가진 것(12~60개월 사다리)
 *   ④ 차량 정보(제원)
 *   ⑤ 이용 조건(정책) — 보험·연령·주행·면책
 *   ⑥ 하단 고정 — 전화 상담
 * 웹은 ①②③을 «왼쪽 사진 · 오른쪽 값»으로 나누고 오른쪽이 따라온다(엔카·헤이딜러가 다 그렇다).
 *
 * ★★값을 지어내지 않는다. 없는 항목은 **줄째로 빠진다** — 손님 화면에 뜬 조건은 곧 약속이라
 *   「협의」나 빈칸을 그럴듯하게 채우면 그게 분쟁이 된다(public-catalog 의 같은 판단).
 */
export function ShopDetail({ p, agentName, agentPhone }: {
  p: EntityRecord;
  agentName?: string;
  agentPhone?: string;
}) {
  const mobile = useIsMobile();
  const title = vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', fallback: 'none' }) || '차량';

  const km = Number(String(p.mileage ?? '').replace(/[^0-9.]/g, '')) || 0;
  const cc = Number(p.engine_cc) || 0;
  const seats = Number(p.seats) || 0;
  const facts = [
    String(p.car_number || '').trim(),
    yearFullDisplay(p.year),
    km > 0 ? kmDisplay(p.mileage) : '',
    cc > 0 ? `${cc.toLocaleString('ko-KR')}cc` : '',
    fuelDisplay(p.fuel_type) || String(p.fuel_type || '').trim(),
  ].filter(Boolean).join(' · ');

  const creditRaw = creditDisplay(p);
  const credit = creditRaw && creditRaw !== CREDIT_UNSET ? creditRaw : '';
  const badges: { text: string; tone: BadgeTone; perk?: boolean }[] = [
    ...(credit ? [{ text: credit, tone: CREDIT_TONE(credit) }] : []),
    ...PERKS.filter((k) => hasPerk(p, k)).map((k) => ({
      text: k as string,
      tone: (PERK_TONE as Record<string, BadgeTone>)[k] || ('blue' as BadgeTone),
      perk: true,
    })),
  ];

  /*
   * ③ 기간 사다리 — **우리가 진짜 가진 것**. 참고한 시안들이 「보증금 10%면 월요금 ×0.94」 같은
   * 지어낸 셈을 쓰는데, 우리는 공급사가 준 개월별 실제 표가 있다(한 차에 최대 열 단).
   * 싼 기간부터 세운다 — 손님이 카드에서 본 값이 최저가라 그게 먼저 눈에 와야 이어진다.
   */
  const plans = useMemo(
    () => priceList(p).filter((x) => x.rent > 0).sort((a, b) => a.rent - b.rent),
    [p],
  );
  const [planIdx, setPlanIdx] = useState(0);
  const plan = plans[planIdx];

  const specs: [string, string][] = ([
    ['제조사', makerDisplay(p.maker) || String(p.maker || '')],
    ['모델', [String(p.sub_model || p.model || ''), String(p.trim_name || '')].filter(Boolean).join(' ')],
    ['연식', yearFullDisplay(p.year)],
    ['최초등록', String(p.first_registration_date || '')],
    ['연료', fuelDisplay(p.fuel_type) || String(p.fuel_type || '')],
    ['배기량', cc > 0 ? `${cc.toLocaleString('ko-KR')}cc` : ''],
    ['구동방식', String(p.drive_type || '')],
    ['승차정원', seats > 0 ? `${seats}인승` : ''],
    ['색상', String(p.ext_color || '')],
    // 주행거리 0 은 「0km」가 아니라 «모른다»다 — 줄째로 뺀다(전역 규칙 2).
    ['주행거리', km > 0 ? kmDisplay(p.mileage) : ''],
    ['차량번호', String(p.car_number || '')],
  ] as [string, string][]).filter(([, v]) => v.trim());

  const pol = (p._policy || {}) as Record<string, unknown>;
  const S = (k: string) => String(pol[k] ?? '').trim();
  const join = (...xs: string[]) => xs.filter(Boolean).join(' · ');
  const terms: [string, string][] = ([
    ['운전자 연령', join(S('basic_driver_age'),
      S('driver_age_lowering') ? `${S('driver_age_lowering')}까지 낮춤${S('age_lowering_cost') ? ` (${S('age_lowering_cost')})` : ''}` : '',
      S('driver_age_upper_limit'))],
    ['면허 경력', S('license_period')],
    ['운전 가능', join(S('personal_driver_scope'), S('business_driver_scope'))],
    ['추가 운전자', join(S('additional_driver_allowance_count'), S('additional_driver_cost'))],
    ['약정 주행', join(S('annual_mileage'),
      S('mileage_upcharge_per_10000km') ? `초과 시 1만km당 ${S('mileage_upcharge_per_10000km')}` : '')],
    ['보험', join(S('insurance_included'),
      S('injury_compensation_limit') ? `대인 ${S('injury_compensation_limit')}` : '',
      S('property_compensation_limit') ? `대물 ${S('property_compensation_limit')}` : '')],
    ['자기차량손해', join(S('own_damage_compensation'),
      S('own_damage_min_deductible') && S('own_damage_max_deductible')
        ? `면책 ${S('own_damage_min_deductible')}~${S('own_damage_max_deductible')}`
        : S('own_damage_min_deductible') || '')],
    ['자기신체사고', join(S('self_body_accident'), S('self_body_deductible') ? `면책 ${S('self_body_deductible')}` : '')],
    ['긴급출동', S('annual_roadside_assistance') || S('roadside_assistance')],
    ['납부', join(S('payment_method'), S('rental_card_payment') ? `카드 ${S('rental_card_payment')}` : '')],
    ['중도 해지', S('penalty_condition')],
    ['이용 지역', S('rental_region')],
  ] as [string, string][]).filter(([, v]) => v.trim());

  const options = parseProductOptions(p.options);
  const phone = String(agentPhone || '').trim();
  const telHref = phone ? `tel:${phone.replace(/[^0-9+]/g, '')}` : '';

  const gallery = <Gallery p={p} />;

  const priceCard = (
    <section aria-label="대여 조건">
      <SecTitle>대여 조건</SecTitle>
      {plans.length > 1 ? (
        /*
         * 기간 칩은 **접힌다**(가로 스크롤이 아니다). 목록의 조건 알약은 축이 열 개가 넘어 한 줄로
         * 미는 게 이득이지만, 여기는 많아야 열이고 무엇보다 «다 보고 비교하는» 값이다 —
         * 밀어서 감추면 12개월이 있는 줄도 모르고 60개월만 보고 나간다.
         */
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingBottom: 14 }}>
          {plans.map((x, i) => (
            <ShopPill key={`${x.m}-${x.rent}`} on={i === planIdx} onClick={() => setPlanIdx(i)}>
              {x.m}개월
            </ShopPill>
          ))}
        </div>
      ) : null}
      {plan ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: SHOP.fs.sub, color: C.mute }}>월</span>
            <span style={{
              fontSize: mobile ? 34 : 38, fontWeight: 800, color: C.ink,
              letterSpacing: '-0.045em', fontVariantNumeric: 'tabular-nums',
            }}>{manWon(plan.rent)}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: SHOP.fs.body, color: C.sub, fontVariantNumeric: 'tabular-nums' }}>
            {plan.deposit > 0 ? `보증금 ${manWon(plan.deposit)}` : '보증금 없음'} · {plan.m}개월 약정
          </div>
        </>
      ) : (
        <div style={{ fontSize: SHOP.fs.body, color: C.mute }}>요금은 담당자에게 문의해 주세요.</div>
      )}
      {badges.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 14 }}>
          {badges.map((b) => (
            <Badge key={b.text} tone={b.tone} variant={b.perk ? 'perk' : 'line'} size={FS.sub}>{b.text}</Badge>
          ))}
        </div>
      ) : null}
      <p style={{ margin: '14px 0 0', fontSize: SHOP.fs.cap, color: C.faint, lineHeight: 1.7 }}>
        표시 금액은 참고용이며 심사·재고에 따라 달라질 수 있습니다.
      </p>
    </section>
  );

  return (
    <main style={{
      maxWidth: 1120, margin: '0 auto',
      // 하단 고정독이 마지막 줄을 덮지 않게 그만큼 비운다.
      padding: mobile ? '16px 16px 108px' : '26px 24px 40px',
    }}>
      {mobile ? (
        <>
          {gallery}
          <Head title={title} facts={facts} />
          <Rule />
          {priceCard}
        </>
      ) : (
        <div style={{ display: 'flex', gap: 36, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 0', minWidth: 0 }}>
            {gallery}
            <Head title={title} facts={facts} />
          </div>
          {/* 오른쪽 값 칸이 «따라온다» — 아래 제원·조건을 읽는 동안에도 얼마인지가 늘 보인다. */}
          <aside style={{ width: 340, flex: '0 0 340px', position: 'sticky', top: 20 }}>
            {priceCard}
            {telHref ? (
              <a href={telHref} onClick={() => haptic.nav()} className="fp-shop-press"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  height: 54, marginTop: 18, borderRadius: SHOP.r.chip,
                  background: C.brand, color: C.inverse, textDecoration: 'none',
                  fontSize: SHOP.fs.body, fontWeight: 700,
                }}>
                <Phone size={ICON.md} aria-hidden />
                {agentName ? `${agentName} 담당자에게 전화` : '전화 상담'}
              </a>
            ) : null}
          </aside>
        </div>
      )}

      {specs.length ? (
        <>
          <Rule />
          <section aria-label="차량 정보">
            <SecTitle>차량 정보</SecTitle>
            <Table rows={specs} mobile={mobile} />
          </section>
        </>
      ) : null}

      {options.length ? (
        <>
          <Rule />
          <section aria-label="옵션">
            <SecTitle>옵션</SecTitle>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {options.map((o) => (
                <span key={o} style={{
                  padding: '7px 12px', borderRadius: SHOP.r.chip, background: C.zebra,
                  fontSize: SHOP.fs.sub, color: C.sub,
                }}>{o}</span>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {terms.length ? (
        <>
          <Rule />
          <section aria-label="이용 조건">
            <SecTitle>이용 조건</SecTitle>
            <Table rows={terms} mobile={mobile} />
            <p style={{ margin: '14px 0 0', fontSize: SHOP.fs.cap, color: C.faint, lineHeight: 1.7 }}>
              조건은 계약 시 최종 확정됩니다. 자세한 내용은 담당자에게 확인해 주세요.
            </p>
          </section>
        </>
      ) : null}

      {/*
        폰 하단 고정독 — **꽉 채운 한 칸**. 이 화면에서 손님이 할 일은 하나(전화)라
        비주요 칸을 만들지 않는다(전자계약처럼 「이전/확정」 두 갈래가 있는 화면이 아니다).
      */}
      {mobile && telHref ? (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
          background: C.bg, borderTop: `1px solid ${C.line}`,
          padding: '10px 16px 14px',
          paddingBottom: 'calc(14px + var(--fp-dock-safe, env(safe-area-inset-bottom)))',
        }}>
          <a href={telHref} onClick={() => haptic.nav()} className="fp-shop-press"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              height: 54, borderRadius: SHOP.r.chip,
              background: C.brand, color: C.inverse, textDecoration: 'none',
              fontSize: SHOP.fs.body, fontWeight: 700,
            }}>
            <Phone size={ICON.md} aria-hidden />
            {agentName ? `${agentName} 담당자에게 전화` : '전화 상담'}
          </a>
        </div>
      ) : null}
    </main>
  );
}

/** 구역 사이 — 선 하나. 상자로 감싸면 화면이 서랍장이 된다. */
function Rule() {
  return <hr style={{ border: 0, borderTop: `1px solid ${C.line2}`, margin: '26px 0 22px' }} />;
}

function SecTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      margin: '0 0 14px', fontSize: SHOP.fs.h2, fontWeight: 700,
      color: C.ink, letterSpacing: '-0.02em',
    }}>{children}</h2>
  );
}

function Head({ title, facts }: { title: string; facts: string }) {
  return (
    <header style={{ paddingTop: 18 }}>
      <h1 style={{
        margin: 0, fontSize: 22, fontWeight: 800, color: C.ink,
        lineHeight: 1.3, letterSpacing: '-0.03em',
      }}>{title}</h1>
      {facts ? (
        <div style={{ marginTop: 8, fontSize: SHOP.fs.body, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>
          {facts}
        </div>
      ) : null}
    </header>
  );
}

/**
 * 이름-값 표 — 두 줄짜리 격자. 항목이 서른 개 가까이 될 수 있어 «읽는 리듬»이 있어야 한다.
 * 웹은 두 칸(왼쪽 이름 고정폭), 폰은 한 칸씩 쌓되 이름은 흐리게 — 값이 먼저 눈에 오게.
 */
function Table({ rows, mobile }: { rows: [string, string][]; mobile: boolean }) {
  return (
    <dl style={{
      margin: 0, display: 'grid',
      gridTemplateColumns: mobile ? '96px minmax(0, 1fr)' : 'repeat(2, 120px minmax(0, 1fr))',
      columnGap: 14, rowGap: 0,
    }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{
            padding: '11px 0', fontSize: SHOP.fs.sub, color: C.faint,
            borderTop: `1px solid ${C.line2}`,
          }}>{k}</dt>
          <dd style={{
            margin: 0, padding: '11px 0', fontSize: SHOP.fs.body, color: C.ink,
            borderTop: `1px solid ${C.line2}`, wordBreak: 'keep-all',
          }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 사진 — 큰 것 하나 + 좌우로 넘기기 + 「n / N」.
 *
 * ★사진이 한 장뿐이면 화살표도 세는 표시도 안 그린다 — 누를 데가 없는 단추를 두지 않는다.
 * ★사진이 없으면 «없다»고 조용히 말한다. 실측 28%가 그렇다 — 회색 판만 두면 고장으로 보인다.
 */
function Gallery({ p }: { p: EntityRecord }) {
  const photos = useProductPhotos(p, 1280);
  const [i, setI] = useState(0);
  const n = photos.length;
  const at = n ? photos[Math.min(i, n - 1)] : '';
  const go = (d: number) => setI((v) => (v + d + n) % n);

  return (
    <div style={{
      position: 'relative', aspectRatio: '4 / 3', overflow: 'hidden',
      borderRadius: SHOP.r.card, background: C.placeholder,
    }}>
      {at ? (
        // eslint-disable-next-line @next/next/no-img-element -- 원본은 외부 도메인(프록시 경유)이라 next/image 최적화 대상이 아니다.
        <img src={at} alt="" decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8, color: C.faint,
        }}>
          <ImageOff size={28} aria-hidden />
          <span style={{ fontSize: SHOP.fs.sub }}>사진 준비 중</span>
        </div>
      )}

      {n > 1 ? (
        <>
          <GalleryArrow side="left" onClick={() => go(-1)} />
          <GalleryArrow side="right" onClick={() => go(1)} />
          <span style={{
            position: 'absolute', right: 12, bottom: 12,
            padding: '4px 10px', borderRadius: 999,
            background: 'rgba(0,0,0,0.55)', color: '#fff',
            fontSize: SHOP.fs.cap, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          }}>{Math.min(i, n - 1) + 1} / {n}</span>
        </>
      ) : null}
    </div>
  );
}

function GalleryArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button type="button" onClick={onClick} className="fp-shop-press"
      aria-label={side === 'left' ? '이전 사진' : '다음 사진'}
      style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        [side]: 12, width: 38, height: 38, borderRadius: 999,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', cursor: 'pointer', color: C.ink,
        // 유리 — 밝은 사진에서도 어두운 사진에서도 화살표가 보인다.
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      }}>
      <Icon size={ICON.lg} aria-hidden />
    </button>
  );
}
