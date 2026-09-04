'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Heart, ImageOff, Phone, Share2 } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { Badge, C, FW, FS, ICON, PERK_TONE, CREDIT_TONE, type BadgeTone } from '@/components/ui';
import { SHOP } from '@/components/shop/shop-ui';
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
export function ShopDetail({ p, agentName, agentPhone, listHref = '/shop' }: {
  p: EntityRecord;
  agentName?: string;
  agentPhone?: string;
  /** 「목록으로」가 가는 곳. 담당 귀속(`?a=`)을 물고 가야 손님이 돌아가도 담당자가 안 바뀐다. */
  listHref?: string;
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
  /** 표에 세울 순서 — 기간 오름차순. 위 큰 숫자는 최저가로 시작하지만 표의 축은 «기간»이다. */
  const byMonth = useMemo(() => [...plans].sort((a, b) => a.m - b.m), [plans]);

  /*
   * 차량 정보 — **위 두 줄과 안 겹치는 것만** 남긴다(2026-09-05 검토).
   *
   * 열한 줄이었는데 일곱 줄이 «글자까지» 위와 같았다:
   *   제조사·모델   → 차명 h1 이 `vehicleNameOf(full)` = 제조사+세부모델+세부트림을 이미 들고 있다
   *   연식·연료·배기량·주행거리·차번 → 바로 위 사실줄과 같은 값이다
   * 손님은 같은 것을 두 번 읽고, 「아래 표에 뭔가 더 있나」 하고 훑다가 아무것도 못 얻는다.
   *
   * 남긴 넷의 이유
   *   최초등록 — 연식과 «갈리는» 차가 실재한다(2020년식 / 2021.03 등록). 감가·검사 시기를 재는 값.
   *   구동방식 — 눈길·지방 손님이 따진다.
   *   승차정원 — 가족 수. 5인승이냐 7인승이냐로 계약이 갈린다.
   *   ★색상   — **사진 없는 28%에게는 유일한 외관 정보**다. 이것까지 빼면 그 차는 글자뿐이다.
   */
  const specs: [string, string][] = ([
    ['최초등록', regDate(p.first_registration_date)],
    ['구동방식', String(p.drive_type || '')],
    ['승차정원', seats > 0 ? `${seats}인승` : ''],
    ['색상', String(p.ext_color || '')],
  ] as [string, string][]).filter(([, v]) => v.trim());

  const pol = (p._policy || {}) as Record<string, unknown>;
  const S = (k: string) => String(pol[k] ?? '').trim();
  const join = (...xs: string[]) => xs.filter(Boolean).join(' · ');
  const rows = (list: [string, string][]) => list.filter(([, v]) => v.trim());

  /** 보험 — 손님이 사고 났을 때 «얼마까지 되나»를 재는 값. */
  const insurance = rows([
    ['보험 포함', S('insurance_included')],
    ['대인 배상', join(S('injury_compensation_limit'), S('injury_deductible') ? `면책 ${S('injury_deductible')}` : '')],
    ['대물 배상', join(S('property_compensation_limit'), S('property_deductible') ? `면책 ${S('property_deductible')}` : '')],
    ['자기신체사고', join(S('self_body_accident'), S('self_body_deductible') ? `면책 ${S('self_body_deductible')}` : '')],
    ['무보험차 상해', join(S('uninsured_damage') || S('uninsured_compensation_limit'),
      S('uninsured_deductible') && S('uninsured_deductible') !== '없음' ? `면책 ${S('uninsured_deductible')}` : '')],
    ['자기차량손해', join(S('own_damage_compensation'), S('own_damage_repair_ratio') ? `수리비 ${S('own_damage_repair_ratio')}` : '',
      S('own_damage_min_deductible') && S('own_damage_max_deductible')
        ? `면책 ${S('own_damage_min_deductible')}~${S('own_damage_max_deductible')}`
        : S('own_damage_min_deductible') || '')],
  ]);

  /** 계약 — 얼마를 어떻게 내고, 그만두면 어떻게 되나. */
  const contract = rows([
    ['약정 주행', join(S('annual_mileage'),
      S('mileage_upcharge_per_10000km') ? `초과 시 1만km당 ${S('mileage_upcharge_per_10000km')}` : '')],
    ['납부 방법', join(S('payment_method'), S('payment_timing') && S('payment_timing') !== S('payment_method') ? S('payment_timing') : '')],
    ['대여료 카드 납부', S('rental_card_payment')],
    ['보증금 분납', S('deposit_installment')],
    ['보증금 카드 납부', S('deposit_card_payment')],
    ['중도 해지', S('penalty_condition')],
  ]);

  /** 운전 — «내가 탈 수 있나». 저신용·젊은 손님에게는 요금 다음으로 중요한 값이다. */
  const driving = rows([
    ['기본 연령', S('basic_driver_age')],
    ['연령 낮추기', S('driver_age_lowering')
      ? `${S('driver_age_lowering')}까지${S('age_lowering_cost') ? ` (${S('age_lowering_cost')})` : ''}` : ''],
    ['연령 상한', S('driver_age_upper_limit')],
    ['면허 경력', S('license_period')],
    ['운전 가능 범위', join(S('personal_driver_scope'), S('business_driver_scope'))],
    ['추가 운전자', join(S('additional_driver_allowance_count'), S('additional_driver_cost'))],
  ]);

  /** 기타 — 있으면 좋고 없으면 마는 것들. 위 셋을 읽고 나서 보는 값이라 맨 뒤다. */
  const etc = rows([
    ['긴급출동', S('annual_roadside_assistance') || S('roadside_assistance')],
    ['이용 지역', S('rental_region')],
    ['차량 인도', S('delivery_fee')],
    ['정비', S('maintenance_service')],
    ['대차 서비스', S('replacement_car_policy')],
  ]);

  const options = parseProductOptions(p.options);
  const phone = String(agentPhone || '').trim();
  const code = String(p.product_code || '');
  const telHref = phone ? `tel:${phone.replace(/[^0-9+]/g, '')}` : '';

  const gallery = <Gallery p={p} />;

  const bar = (
    <TopBar code={code} title={title} listHref={listHref} />
  );

  const priceCard = (
    <section aria-label="대여료">
      <SecTitle>대여료</SecTitle>
      {plan ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: SHOP.fs.sub, color: C.mute }}>월</span>
            <span style={{
              fontSize: mobile ? 34 : 36, fontWeight: FW.head, color: C.ink,
              letterSpacing: '-0.045em', fontVariantNumeric: 'tabular-nums',
            }}>{manWon(plan.rent)}</span>
          </div>
          {/*
            ★이 줄은 **큰 숫자의 닻**이다. 표의 선택된 행과 값이 겹치는 건 맞지만, 없애 보니
              「월 15만원」이 **어느 기간인지 모르는 숫자**가 됐다 — 바로 밑 표는 1개월 33만원부터 시작해서,
              손님이 큰 숫자와 첫 줄을 붙여 읽으면 서로 안 맞는다(2026-09-05 화면에서 확인하고 되돌림).
              중복을 없애는 것보다 «큰 숫자가 무슨 조건인지»가 먼저다.
          */}
          <div style={{ marginTop: 6, fontSize: SHOP.fs.body, color: C.sub, fontVariantNumeric: 'tabular-nums' }}>
            {plan.deposit > 0 ? `보증금 ${manWon(plan.deposit)}` : '보증금 없음'} · {plan.m}개월 약정
          </div>
        </>
      ) : (
        <div style={{ fontSize: SHOP.fs.body, color: C.mute }}>요금은 담당자에게 문의해 주세요.</div>
      )}

      {/*
        ★★기간별 «표»다. 칩만 두면 다른 기간이 얼마인지 하나씩 눌러 봐야 알고, 그러다 보면
          「지금 보는 게 제일 싼 건가」를 못 정한다. 렌터카 상세(롯데·SK)가 다 표를 쓰는 이유다.
          누르면 위 큰 숫자가 그 기간으로 바뀐다 — 표가 곧 고르개다.
        ★기간 «순서»로 세운다(12→60). 위 큰 숫자는 최저가로 시작하지만, 표는 값이 아니라
          기간이 축이라 오름차순이어야 손님이 「길게 하면 싸지는구나」를 읽는다.
      */}
      {plans.length > 1 ? (
        <table style={{
          width: '100%', marginTop: 18, borderCollapse: 'collapse',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <thead>
            <tr>
              {['기간', '월 대여료', '보증금'].map((h, i) => (
                <th key={h} scope="col" style={{
                  padding: '0 0 9px', textAlign: i === 0 ? 'left' : 'right',
                  fontSize: SHOP.fs.cap, fontWeight: 500, color: C.faint,
                  borderBottom: `1px solid ${C.line2}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byMonth.map((x) => {
              const on = plan && x.m === plan.m;
              return (
                <tr key={x.m} onClick={() => setPlanIdx(plans.findIndex((y) => y.m === x.m))}
                  style={{ cursor: 'pointer', background: on ? C.brandSoft : 'transparent' }}>
                  {/*
                    ★줄마다 긋던 가로선을 걷었다(2026-09-05 구분선 최소화). 머리(기간·월 대여료·보증금)
                      밑줄 하나만 남긴다 — 그건 «제목과 값»을 가르는 선이라 뜻이 있다.
                      고른 줄은 면(brandSoft)이 이미 표시하므로 줄금이 없어도 어디를 골랐는지 보인다.
                  */}
                  <td style={{
                    padding: '13px 8px 13px 10px',
                    fontSize: SHOP.fs.body, fontWeight: on ? 700 : 500, color: on ? C.brand : C.ink,
                  }}>{x.m}개월</td>
                  <td style={{
                    padding: '13px 8px', textAlign: 'right',
                    fontSize: SHOP.fs.body, fontWeight: on ? 800 : 600, color: C.ink,
                  }}>{manWon(x.rent)}</td>
                  <td style={{
                    padding: '13px 10px 13px 8px', textAlign: 'right',
                    fontSize: SHOP.fs.body, color: C.mute,
                  }}>{x.deposit > 0 ? manWon(x.deposit) : '없음'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {badges.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 16 }}>
          {badges.map((b) => (
            <Badge key={b.text} tone={b.tone} variant={b.perk ? 'perk' : 'line'} size={FS.sub}>{b.text}</Badge>
          ))}
        </div>
      ) : null}
      {/*
        ⚠ 여기 있던 「표시 금액은 참고용이며 **심사**·재고에 따라 달라질 수 있습니다」를 뺐다(2026-09-05).
          둘 다 자해였다 — ㉠ 방금 크게 보여 준 금액을 바로 밑에서 스스로 부정하고,
          ㉡ 이 장사의 셀링포인트가 「무심사」인데(바로 위 뱃지에 초록으로 떠 있다)
             그 아래 줄이 **「심사」라는 낱말을 요금 옆에 도로 꺼낸다.** 저신용 손님이 평생 들어 온 그 말이다.
          법적 방어는 맨 아래 마감 안내문(「계약 시 최종 확정됩니다」)이 이미 한 번 한다. 한 번이면 충분하다.
      */}
    </section>
  );

  return (
    <main style={{
      maxWidth: 1120, margin: '0 auto',
      // 하단 고정독이 마지막 줄을 덮지 않게 그만큼 비운다.
      padding: mobile ? '16px 16px 108px' : '26px 24px 40px',
    }}>
      {bar}
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

      <Sec title="보험 조건" rows={insurance} mobile={mobile} />
      <Sec title="계약 조건" rows={contract} mobile={mobile} />
      <Sec title="운전 조건" rows={driving} mobile={mobile} />
      <Sec title="기타 사항" rows={etc} mobile={mobile} />

      {(insurance.length || contract.length || driving.length || etc.length) ? (
        <p style={{ margin: '20px 0 0', fontSize: SHOP.fs.cap, color: C.faint, lineHeight: 1.7 }}>
          위 조건은 공급사가 제공한 운영정책이며 계약 시 최종 확정됩니다. 자세한 내용은 담당자에게 확인해 주세요.
        </p>
      ) : (
        /* 정책이 안 붙은 차가 실제로 있다 — 「없다」가 아니라 «모른다»라고 말한다(지어내지 않는다). */
        <p style={{ margin: '20px 0 0', fontSize: SHOP.fs.cap, color: C.faint, lineHeight: 1.7 }}>
          보험·계약 조건은 담당자에게 문의해 주세요.
        </p>
      )}

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

const FAV_KEY = 'fp4_shop_fav';

/**
 * 상세 맨 위 실행줄 — **목록으로 · 관심 · 공유**.
 *
 * 왜 있어야 하나(2026-09-04 실측). 이 화면에서 손님이 할 수 있는 일이 «전화» 하나뿐이었다.
 *   ㉠ 목록으로 돌아갈 길이 없다 — 브라우저 뒤로가기를 아는 사람만 나간다.
 *   ㉡ **이 차를 누구에게도 못 보낸다.** 저신용 렌트는 본인 혼자 정하는 일이 드물다(배우자·부모와
 *      상의한다). 공유가 막히면 손님이 화면을 찍어 보내고, 그러면 담당자 귀속이 끊긴다 —
 *      우리 장사에서 이건 기능 하나가 아니라 **퍼널이 끊기는 것**이다.
 *   ㉢ 담아 둘 수 없다 — 목록에는 하트가 있는데 상세에 없어서, 들어와서 마음에 들면 뒤로 나가
 *      다시 하트를 눌러야 했다.
 *
 * ★사진 «위»에 얹지 않는다(사장님 2026-09-04 「사진에 들어갈 필요는 없을 것 같고」).
 *   사진 위 단추는 어떤 사진이 오느냐에 따라 보이기도 하고 안 보이기도 한다. 위에 자리를 만든다.
 * ★공유는 **기기가 아는 방법**을 먼저 쓴다(`navigator.share`) — 카톡·문자가 바로 뜨는 그 창이다.
 *   없는 기기(대부분 데스크톱)에서는 주소를 복사하고 「복사했습니다」로 알린다.
 *   ⚠ 주소를 «지금 주소 그대로» 넘긴다 — `?a=` 담당 귀속이 물려 있어야 받은 사람이 눌러도
 *     같은 담당자에게 간다. 손으로 조립하면 그 파라미터를 흘린다.
 */
function TopBar({ code, title, listHref }: { code: string; title: string; listHref: string }) {
  const [faved, setFaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try { setFaved(new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]') as string[]).has(code)); }
    catch { /* 저장을 못 읽어도 화면은 돈다 */ }
  }, [code]);

  const toggleFav = () => {
    haptic.tap();
    setFaved((was) => {
      const next = !was;
      try {
        const set = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]') as string[]);
        if (next) set.add(code); else set.delete(code);
        localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
      } catch { /* 저장 실패는 화면을 막지 않는다 */ }
      return next;
    });
  };

  const share = async () => {
    haptic.tap();
    const url = window.location.href;
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* 손님이 취소한 것도 여기로 온다 — 아무 말도 하지 않는다 */ }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0 12px' }}>
      <Link href={listHref} onClick={() => haptic.nav()} className="fp-shop-press"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 40, padding: '0 12px 0 8px', borderRadius: SHOP.r.chip,
          textDecoration: 'none', color: C.sub, fontSize: SHOP.fs.sub, fontWeight: 600,
        }}>
        <ArrowLeft size={ICON.lg} aria-hidden />목록으로
      </Link>
      <div style={{ flex: 1 }} />
      <button type="button" onClick={toggleFav} className="fp-shop-press"
        aria-pressed={faved} aria-label={faved ? '관심 차량에서 빼기' : '관심 차량으로 담기'}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 40, height: 40, borderRadius: 999, border: 'none', background: 'transparent',
          cursor: 'pointer', color: faved ? C.danger : C.sub,
        }}>
        <Heart size={ICON.lg} aria-hidden fill={faved ? 'currentColor' : 'none'} />
      </button>
      <button type="button" onClick={share} className="fp-shop-press" aria-label="이 차량 공유하기"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 40, padding: '0 12px', borderRadius: 999, border: 'none', background: 'transparent',
          cursor: 'pointer', color: copied ? C.ok : C.sub, fontSize: SHOP.fs.sub, fontWeight: 600,
        }}>
        {copied ? <Check size={ICON.lg} aria-hidden /> : <Share2 size={ICON.lg} aria-hidden />}
        {copied ? '복사했습니다' : '공유'}
      </button>
    </div>
  );
}

/**
 * 조건 구역 하나 — **속이 비면 통째로 안 그린다.** 제목만 있고 아래가 빈 칸은
 * 「우리가 안 채웠다」로 보이고, 손님은 그걸 「이 회사가 대충 한다」로 읽는다.
 */
function Sec({ title, rows, mobile }: { title: string; rows: [string, string][]; mobile: boolean }) {
  if (!rows.length) return null;
  return (
    <>
      <Rule />
      <section aria-label={title}>
        <SecTitle>{title}</SecTitle>
        <Table rows={rows} mobile={mobile} />
      </section>
    </>
  );
}

/**
 * 최초등록일 — **날짜꼴이 아니면 안 찍는다.**
 *
 * ⚠⚠ 원천이 이 칸에 «트림명»을 넣어 둔 차가 실측 26대다 — 「프레스티지」·「노블레스」·「45 TFSI」·
 *   「120i Sport」. 그대로 내보내면 손님이 **「최초등록 프레스티지」**를 읽는다. 칸이 밀린 것이라
 *   화면이 고칠 수 있는 게 아니고, 고쳐서도 안 된다(지어내는 것이다) — **안 보여준다.**
 * ⚠ 두 자리 연도(「24-10」)가 91대다. 그대로 두면 24년인지 2024년인지 손님이 한 번 생각한다.
 *   ★2000년대로 편다 — 우리 재고는 렌터카라 1900년대 차가 없다(실측 최저 2009년).
 * ★날은 안 쓴다. 손님이 재는 것은 「언제쯤 나온 차인가」지 며칠인지가 아니다.
 * ⇒ 원천을 고치는 것은 별건이다. 이 함수는 «손님 화면이 헛소리를 안 하게» 막는 마지막 문이다.
 */
function regDate(raw: unknown): string {
  const v = String(raw ?? '').trim().replace(/[.]/g, '-');
  const m = /^(\d{2}|\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(v);
  if (!m) return '';
  const y = m[1].length === 4 ? Number(m[1]) : 2000 + Number(m[1]);
  const mo = Number(m[2]);
  if (!(y >= 1990 && y <= 2100) || !(mo >= 1 && mo <= 12)) return '';
  return `${y}년 ${mo}월`;
}

/**
 * 구역 사이 — **여백만**(사장님 2026-09-05 「없어도 되는 구분선 이런 거는 좀 최소화해야 된다」).
 *
 * 전에는 구역마다 가로선을 그었다. 상세에 구역이 여섯이라 화면에 선이 여섯 줄 그어졌고,
 * 그 안의 표가 또 줄마다 선을 그어 **한 화면이 온통 가로줄**이었다.
 * 구역 제목이 굵고 크므로 선이 없어도 어디서 갈리는지 보인다 — 나누는 일은 여백이 한다.
 */
function Rule() {
  return <div aria-hidden style={{ height: 34 }} />;
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
        margin: 0, fontSize: 22, fontWeight: FW.head, color: C.ink,
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
      columnGap: 14, rowGap: 12,
    }}>
      {/*
        ★줄마다 긋던 가로선을 걷었다(2026-09-05). 이름이 흐리고 값이 진해서 **글자 세기만으로**
          짝이 읽힌다 — 선은 그 위에 얹은 군더더기였다. 네 줄짜리 표에 선 넷은 표가 아니라 창살이다.
      */}
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ fontSize: SHOP.fs.sub, color: C.faint }}>{k}</dt>
          <dd style={{ margin: 0, fontSize: SHOP.fs.body, color: C.ink, wordBreak: 'keep-all' }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 사진 — **손가락으로 미는** 갤러리.
 *
 * ★브라우저의 가로 스크롤 + `scroll-snap` 을 그대로 쓴다. 관성·고무줄이 공짜로 따라오고
 *   한 장씩 딱 멈춘다. JS 로 드래그를 흉내 내면 그 둘이 없어 «싸구려 같은» 움직임이 된다.
 * ★화살표는 마우스 쓰는 사람 몫이다 — 폰에서는 아무도 안 누른다(사진은 미는 것이라고 손이 안다).
 * ★사진이 한 장뿐이면 화살표도 점도 세는 표시도 안 그린다 — 누를 데가 없는 단추를 두지 않는다.
 * ★사진이 없으면 «없다»고 조용히 말한다. 실측 28%가 그렇다 — 회색 판만 두면 고장으로 보인다.
 */
function Gallery({ p }: { p: EntityRecord }) {
  const photos = useProductPhotos(p, 1280);
  const railRef = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const n = photos.length;

  /** 어느 장을 보고 있나 — 스크롤 위치를 폭으로 나눈다. 스크롤이 정본이라 손·화살표가 안 갈린다. */
  const onScroll = () => {
    const el = railRef.current;
    if (!el || !el.clientWidth) return;
    setI(Math.round(el.scrollLeft / el.clientWidth));
  };
  const go = (d: number) => {
    const el = railRef.current;
    if (!el) return;
    const next = Math.min(Math.max(i + d, 0), n - 1);
    // 세는 표시를 «먼저» 바꾼다 — 부드럽게 미끄러지는 동안 숫자가 옛 장에 머물면 눌린 것 같지 않다.
    // (스크롤이 끝나면 onScroll 이 같은 값으로 다시 맞추므로 손으로 민 것과도 안 갈린다.)
    setI(next);
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div style={{
      position: 'relative', aspectRatio: '4 / 3', overflow: 'hidden',
      borderRadius: SHOP.r.card, background: C.placeholder,
    }}>
      {n ? (
        <div ref={railRef} onScroll={onScroll} className="fp-shop-gallery"
          style={{ width: '100%', height: '100%' }}>
          {photos.map((src, k) => (
            // eslint-disable-next-line @next/next/no-img-element -- 원본은 외부 도메인(프록시 경유)이라 next/image 최적화 대상이 아니다.
            <img key={src} src={src} alt="" decoding="async" loading={k === 0 ? 'eager' : 'lazy'}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ))}
        </div>
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
          {i > 0 ? <GalleryArrow side="left" onClick={() => go(-1)} /> : null}
          {i < n - 1 ? <GalleryArrow side="right" onClick={() => go(1)} /> : null}
          <span style={{
            position: 'absolute', right: 12, bottom: 12,
            padding: '4px 10px', borderRadius: 999,
            background: 'rgba(0,0,0,0.55)', color: '#fff',
            fontSize: SHOP.fs.cap, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          }}>{Math.min(i + 1, n)} / {n}</span>
          {/*
            ⚠ 여기 점(dots)을 뒀다가 뺐다(2026-09-05 검토). 바로 옆 「n / N」이 **같은 말을 더 정확히** 한다
              (점은 8장까지만 그려 아홉 장부터는 뜻이 달라지기까지 했다).
              누를 수도 없고(aria-hidden·핸들러 없음) 읽히지도 않는 장식인데, 사진 아래 같은 자리를
              「n / N」과 나눠 쓰며 밝은 사진 위에서 둘 다 덜 읽히게 만들었다.
          */}
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
