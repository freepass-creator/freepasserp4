'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Car, CarFront, Check, ChevronLeft, ChevronRight, Coins, FileText, Gauge, Heart,
  IdCard, ImageOff, PackageCheck, Phone, ReceiptText, Share2, Wallet,
  type LucideIcon,
} from 'lucide-react';
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
 *   ③ **대여료** — 큰 금액 하나 + 그 밑에 «기간별 보조표»(줄을 누르면 큰 금액이 바뀐다)
 *   ④ 차량 정보(제원)
 *   ⑤ 이용 조건(정책) — 보험·연령·주행·면책
 *   ⑥ 하단 고정(폰) — 금액 + 전화
 * ★★**웹도 폰과 같은 한 줄이다.** 웹만 「사진 왼쪽 · 값 칸 오른쪽」 2단이었는데 걷었다
 *   (사장님 2026-09-05 「대여료를 꼭 사진 우측에서 보여줄 필요가 있어? 그냥 위아래로 스크롤하고
 *   저 대여료 섹션을 어딘가에 갖고 가서 보기 좋게 보여주면 되잖아」). 2단이면 «같은 화면인데
 *   웹과 폰이 다른 물건»이 되고, 한쪽만 고칠 때마다 다른 쪽이 「또 원래대로」가 된다.
 *   웹은 같은 순서를 «넓게» 그릴 뿐이고, 넓어진 대여료 칸은 안에서 가로로 편다.
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
  const [openOpts, setOpenOpts] = useState(false);
  const plan = plans[planIdx];
  /** 표에 세울 순서 — 기간 오름차순. 위 큰 숫자는 최저가로 시작하지만 표의 축은 «기간»이다. */
  const byMonth = useMemo(() => [...plans].sort((a, b) => a.m - b.m), [plans]);
  /** 제일 싼 줄의 «기간». `plans` 가 요금 오름차순이라 첫 줄이 최저가다. */
  const cheapest = plans.length ? plans[0].m : 0;
  /*
   * 보조표 글자 — **폰에서는 한 단 내린다**(2026-09-05 화면에서 잡음).
   * 세 칸(기간·월 대여료·보증금)에 「94만 7,000원」·「183만 3,000원」 같은 긴 값이 들어가는데,
   * 358px 폭에 14.5px 로 놓으니 **금액이 두 줄로 터져** 표가 계단처럼 어긋났다.
   * 값에 `nowrap` 을 걸고 글자를 13 으로 내리면 세 칸이 한 줄에 앉는다.
   * ★보조표는 원래 큰 숫자보다 작아야 한다 — 줄이는 것이 손해가 아니다.
   */
  const rateFs = mobile ? SHOP.fs.sub : SHOP.fs.body;

  /*
   * ★★차량 정보 — **차를 설명하는 순서**로 놓는다(사장님 2026-09-05).
   *
   * > 「차량 정보에 연식이, 이륜구동, 이런 걸 넣는 게 아니라 **세부모델 세부트림을 한 줄로** 하고,
   * >  그다음 **선택 옵션**, 뭐 **연식 주행거리 배기량 연료**, 다음에는 **외부 색상 내부 색상**
   * >  이런 것들이 좀 있어줘야 되는데」
   *
   * 무엇이 틀렸었나. 나는 「위 사실줄과 안 겹치는 것만」이라는 규칙으로 칸을 골랐다.
   * 그 결과가 **최초등록 · 구동방식 · 승차정원 · 색상** 넷이었는데, 이건 «차 설명»이 아니라
   * **남은 것 모음**이다. 손님이 「차량 정보」를 눌러 기대하는 것은 그 차가 무엇인가이지,
   * 우리가 위에서 안 쓴 값이 무엇인가가 아니다. 규칙이 맞아도 결과가 틀리면 규칙이 틀린 것이다.
   * (게다가 그랜저에 「2륜구동」이 떠 있었다 — 원천 값이 그런데, 하필 그 칸이 맨 앞이었다.)
   *
   * ⇒ 순서: **세부모델·세부트림 한 줄** → 연식·주행거리·배기량·연료 → 외부/내부 색상 ·
   *   승차정원·최초등록 → **선택 옵션**.
   * ★위 사실줄과 겹치는 것은 «겹쳐도 된다». 엔카도 머리에서 「연식·주행·연료·차번」을 보여주고
   *   기본정보 구역에서 그대로 다시 편다. 훑는 줄과 확인하는 표는 하는 일이 다르다.
   * ★구동방식은 뺐다 — 사장님이 이 칸을 「그런 걸 넣는 게 아니라」의 예로 드셨다.
   * ★색상은 «외부/내부»로 갈랐다 — 원천에 `int_color` 가 따로 있는데 하나로 뭉뚱그리고 있었다.
   */
  const specs: [string, string][] = ([
    ['연식', yearFullDisplay(p.year)],
    ['주행거리', km > 0 ? kmDisplay(p.mileage) : ''],
    ['배기량', cc > 0 ? `${cc.toLocaleString('ko-KR')}cc` : ''],
    ['연료', fuelDisplay(p.fuel_type) || String(p.fuel_type || '')],
    ['외부 색상', String(p.ext_color || '')],
    ['내부 색상', String(p.int_color || '')],
    ['승차정원', seats > 0 ? `${seats}인승` : ''],
    ['최초등록', regDate(p.first_registration_date)],
  ] as [string, string][]).filter(([, v]) => meaningful(v));

  /** 차량 정보 맨 윗줄 — **세부모델 · 세부트림 한 줄**. 아래 칸들과 성격이 달라 통째로 한 줄을 쓴다. */
  const modelLine = [String(p.sub_model || '').trim(), String(p.trim_name || '').trim()]
    .filter((x) => meaningful(x)).join(' · ');

  const pol = (p._policy || {}) as Record<string, unknown>;
  const S = (k: string) => String(pol[k] ?? '').trim();
  const join = (...xs: string[]) => xs.filter(Boolean).join(' · ');
  const rows = (list: [string, string][]) => list.filter(([, v]) => meaningful(v));

  /*
   * ★★구역마다 «배열»이 다르다(사장님 2026-09-05 「선을 안 쓴다면 경계와 구분을 간격과 배열로
   *   해야 된다 … 차량 설명 칸, 제원 칸, 보험 칸, 대여료 칸, 계약 칸, 기타 칸이 다 똑같을 필요는
   *   없다. **특색이 있으면서 규격을 허물지 않는** 그런 게 필요하다」).
   *
   *   선을 걷었으니 이제 «무엇이 다른 덩어리인가»를 배열이 말해야 한다. 여섯 구역이 전부 같은
   *   「이름 / 값」 표면 읽는 리듬이 없어 손님이 다 읽지 않고 지나간다.
   *
   *   ⇒ **자료의 성격**이 배열을 정한다. 꾸미려고 다르게 하는 게 아니다.
   *      · 서로 «비교»하는 값        → 표     (대여료 — 기간마다 얼마인지 견준다)
   *      · 서로 «독립»된 짧은 사실   → 타일   (제원·계약 — 견줄 것이 아니라 하나씩 확인한다)
   *      · 하나가 «결정»적인 값      → 큰 줄 + 흐린 나열 (보험의 면책 · 운전의 나이)
   *      · 참고만 하는 값            → 흐린 나열 한 줄 (기타)
   *   ★규격은 안 허문다 — 색·글자·둥글기·여백은 전부 `SHOP`·`C` 토큰 그대로다.
   *     달라지는 것은 «놓는 방식»뿐이다.
   */

  /*
   * ★★★**구역은 «손님이 묻는 순서»다**(사장님 2026-09-05 「손님 입장에서 뭐가 궁금할지를
   *   한번 생각을 해봐」).
   *
   * ⚠⚠ 여기 「대여료에 포함」 격자가 있었다. **걷었다.** 사장님 「대여료에 포함은 의미가 없어.」
   *   맞다 — 실측하면 이 차에서 그 격자가 보여 준 것은 **「보험 별도 · 정비 담당자 확인 ·
   *   대차 불가」**였다. **「포함」이라 써 놓고 아무것도 포함 안 된 칸**이라, 없느니만 못했다.
   *   남들(Autonomy·Vamos·Kinto)이 그 블록을 갖는 것은 그들이 **정말로 다 포함**하는 상품이기
   *   때문이다. 우리는 «따로 붙이는» 상품이다. **남의 구성이 아니라 우리 상품을 보고 짜야 한다.**
   *
   * ⇒ 저신용·무심사로 차를 구하는 손님이 이 화면에서 묻는 것은 넷이고, 순서까지 이 순서다.
   *     ① 얼마냐            → 대여료
   *     ② **내가 될까**      → 탈 수 있는 조건 (나이·면허·운전 범위)
   *     ③ **처음에 얼마 드나** → 보증금과 그걸 «나눠 낼 수 있나»  ← 이 손님층의 1번 장벽은 목돈이다
   *     ④ **나중에 더 드나**  → 사고 시 내 부담 · 초과주행 · 추가 운전자 · 탁송
   *   그다음에야 ⑤ 차에 딸려 오는 것 · ⑥ 이 차가 무엇인가를 본다.
   * ★★④가 특히 중요하다 — 조사에서 **남들이 전부 틀리는 자리**가 여기다.
   *   Hertz 는 큰 숫자 셋 옆에 실제 지불액을 바꾸는 넷($250·$1,000·$699·세금)을 각주로 미뤘고,
   *   Cinch 는 초과주행이 두 군데에 다른 값(4p/12p)으로 적혀 있었다.
   *   **나중에 더 내는 돈은 각주가 아니라 제 구역을 갖는다.**
   */

  /** ② 탈 수 있는 조건 — 나이 하나가 결정적이라 그것만 크게. */
  const age = (v: string) => v.replace(/\s*(이상|이하|까지|부터)\s*$/, '').replace(/^만\s*/, '만 ').trim();
  const ageRange = S('basic_driver_age') && S('driver_age_upper_limit')
    ? `${age(S('driver_age_lowering') || S('basic_driver_age'))} ~ ${age(S('driver_age_upper_limit'))}`
    : age(S('basic_driver_age'));
  const canDrive = rows([
    ['면허', S('license_period')],
    ['운전 범위', S('personal_driver_scope')],
  ]);

  /** ③ 처음에 드는 돈 — 보증금은 «고른 기간»의 값이라 화면에서 바로 읽는다. */
  const upfront = rows([
    ['보증금 분납', S('deposit_installment')],
    ['보증금 카드', S('deposit_card_payment')],
    ['대여료 카드', S('rental_card_payment')],
    ['납부 방법', join(S('payment_method'), S('payment_timing') && S('payment_timing') !== S('payment_method') ? S('payment_timing') : '')],
  ]);

  /** ④ 나중에 «더» 드는 돈 — 사고 시 내 부담이 제일 무섭다. */
  const deductible = S('own_damage_min_deductible') && S('own_damage_max_deductible')
    ? `${S('own_damage_min_deductible')} ~ ${S('own_damage_max_deductible')}`
    : S('own_damage_min_deductible');
  const later = rows([
    /* 약정주행과 초과료는 «붙여서» 쓴다 — 떼면 손님이 어느 선을 넘어야 무는지 모른다(Kinto MY 방식). */
    ['초과 주행', join(S('annual_mileage'),
      S('mileage_upcharge_per_10000km') ? `초과 1만km당 ${S('mileage_upcharge_per_10000km')}` : '')],
    ['추가 운전자', join(S('additional_driver_allowance_count'), S('additional_driver_cost'))],
    ['연령 낮추기', S('driver_age_lowering') && meaningful(S('age_lowering_cost'))
      ? `${age(S('driver_age_lowering'))}까지 ${S('age_lowering_cost')}` : ''],
    ['차량 인도', S('delivery_fee')],
  ]);

  /** ⑤ 차에 딸려 오는 것 — 값을 그대로 쓴다. 이 차는 보험이 「별도」다. */
  const bundled = rows([
    ['보험', S('insurance_included')],
    ['보장 한도', [
      S('injury_compensation_limit') ? `대인 ${S('injury_compensation_limit')}` : '',
      S('property_compensation_limit') ? `대물 ${S('property_compensation_limit')}` : '',
      S('self_body_accident') ? `자기신체 ${S('self_body_accident')}` : '',
      S('own_damage_compensation') ? `자기차량 ${S('own_damage_compensation')}` : '',
      S('own_damage_repair_ratio') ? `수리비 ${S('own_damage_repair_ratio')}` : '',
    ].filter(Boolean).join(' · ')],
    ['정비', S('maintenance_service')],
    ['대차', S('replacement_car_policy')],
    ['긴급출동', S('annual_roadside_assistance') || S('roadside_assistance')],
    ['이용 지역', S('rental_region')],
  ]);

  const hasPolicy = !!(ageRange || canDrive.length || upfront.length || later.length || bundled.length);

  const options = parseProductOptions(p.options);
  const phone = String(agentPhone || '').trim();
  const code = String(p.product_code || '');
  const telHref = phone ? `tel:${phone.replace(/[^0-9+]/g, '')}` : '';

  const gallery = <Gallery p={p} mobile={mobile} />;

  const bar = (
    <TopBar code={code} title={title} listHref={listHref} mobile={mobile} />
  );

  const priceCard = (
    /*
     * ★대여료만 «면 위에» 올린다. 이 화면에서 손님이 찾아온 답이라, 나머지 구역과 같은 바닥에
     *   두면 여섯 중 하나로 묻힌다. 연한 브랜드 면이라 눈에 서면서도 채널색을 벗어나지 않는다.
     * ⚠ 다른 구역에는 면을 안 깐다 — 다 카드로 만들면 다시 「전부 똑같은 것」이 되고,
     *   그때는 면이 «중요하다»는 뜻을 잃는다. 하나만 올려야 그 하나가 선다.
     */
    <section aria-label="대여료" style={{
      background: C.brandSoft, borderRadius: 14,
      padding: mobile ? '20px 16px 18px' : '22px 20px 20px',
    }}>
      <SecTitle icon={Coins} accent>대여료</SecTitle>
      {/*
       * ★넓은 화면에서는 **한 줄로 편다** — 「월 얼마 · 보증금 얼마 …… [전화]」.
       *   좁은 칸(340)에서 세로로 쌓던 짜임을 900px 에 그대로 늘리면 오른쪽이 통째로 빈다.
       *   폰에서는 지금처럼 쌓는다(가로로 펼 폭이 없다).
       * ★전화가 이 줄 끝에 온다. 값 칸을 없앴으니 큰 실행 버튼이 사라지는데,
       *   손님이 「얼마」를 읽은 바로 그 자리가 전화를 누를 자리다(머리띠 버튼은 작다).
       */}
      {plan ? (
        <div style={{
          display: 'flex', gap: mobile ? 0 : 24,
          flexDirection: mobile ? 'column' : 'row',
          alignItems: mobile ? 'stretch' : 'center', justifyContent: 'space-between',
        }}>
        <div style={{ minWidth: 0 }}>
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
            {/* 목록 카드와 같은 규칙 — 「보증금 없음」에만 색을 준다(두 화면이 같은 말을 같은 색으로 한다). */}
            <span style={{
              color: plan.deposit > 0 ? C.sub : C.ok,
              fontWeight: plan.deposit > 0 ? 400 : 700,
            }}>
              {plan.deposit > 0 ? `보증금 ${manWon(plan.deposit)}` : '보증금 없음'}
            </span> · {plan.m}개월 약정
          </div>
        </div>
        {/*
         * ⚠ 여기 **웹 전화 버튼**이 있었다. 걷었다(사장님 2026-09-05 「담당자한테 연락하는 저 구성
         *   때문에 되게 쌩뚱맞아. **어차피 웹에서는 연락처를 보여주면 되는 거고**」).
         *   맞다 — 머리띠가 이미 「담당 OOO · 010-…-…· 전화 상담」을 들고 있는데, 요금 옆에 또
         *   큰 파란 버튼을 세우니 **가격을 읽는 자리에 영업이 끼어든** 꼴이었다.
         *   웹에서 전화는 «머리띠에 늘 떠 있는 연락처» 하나면 된다.
         */}
        </div>
      ) : (
        <div style={{ fontSize: SHOP.fs.body, color: C.mute }}>요금은 담당자에게 문의해 주세요.</div>
      )}

      {/*
        ★★기간별 표는 **보조표다 — 접는 게 아니라 «메인 금액 밑에» 깐다**
          (사장님 2026-09-05 「기간표를 보조라고 한 게, **메인 대여료를 하고 그 밑에 전체 기간별
          대여료를 보조표로 보여주라**는 거지」).
        ⚠ 내가 「보조」를 «접어 둬라»로 읽고 접기 버튼을 달았다가 바로잡은 자리다(같은 날).
          **보조는 «작게 아래»지 «숨김»이 아니다.** 중고차 상세도 금액 하나가 주인공이고
          할부표는 그 밑에 «깔려» 있지, 눌러야 나오지 않는다.
        ★조사와도 같은 결론이다 — 열두 곳(엔카·Cinch·Bipi·Kinto·Vamos·제네시스…) 중
          **요금 구조를 접은 곳이 0곳**이었다. 아코디언에 넣은 것은 FAQ·제원뿐이다.
        ★표가 곧 고르개다 — 줄을 누르면 위 큰 숫자가 그 기간으로 바뀐다.
          기간 오름차순(12→60)이라 「길게 하면 싸지는구나」가 읽힌다.
        ★★넓은 화면에서 **표를 늘리지 않는다**(폭 520 에서 끊는다). 세 칸짜리 표를 880px 로
          늘리면 기간과 금액 사이가 손가락 두 뼘이 되어, 같은 줄인데 눈이 못 잇는다.
          보조표는 «작아야» 보조다 — 큰 숫자와 다투면 그때부터 둘 다 안 읽힌다.
      */}
      {plans.length > 1 ? (
        <div style={{ marginTop: 18, maxWidth: mobile ? undefined : 520 }}>
          <div style={{
            marginBottom: 8, fontSize: SHOP.fs.cap, fontWeight: 600, color: C.mute,
          }}>기간별 대여료</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
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
                  const pick = () => setPlanIdx(plans.findIndex((y) => y.m === x.m));
                  return (
                    /*
                     * ⚠ 줄에 `onClick` «만» 걸어 두면 **마우스로만 고를 수 있는 고르개**가 된다
                     *   (2026-09-05 에 잡았다). `<tr>` 은 탭으로 못 가고, 보조기기는 이게 누를 것인 줄도
                     *   모른다 — 키보드로만 쓰는 사람에게는 12개월 말고 다른 기간이 «없는» 화면이다.
                     * ⇒ 줄을 버튼으로 «바꾸지» 않는다(표를 표가 아니게 만든다). 대신 **첫 칸에 진짜
                     *   `<button>`** 을 넣어 그것이 이름·역할·상태(`aria-pressed`)를 진다.
                     *   줄의 `onClick` 은 마우스 편의로 남긴다 — 같은 값을 두 번 넣어도 결과가 같다.
                     */
                    <tr key={x.m} onClick={pick}
                      style={{ cursor: 'pointer', background: on ? C.bg : 'transparent' }}>
                      <td style={{ padding: 0 }}>
                        {/*
                         * ★고른 줄은 **왼쪽에 굵은 선**이 선다. 바탕색만 바꾸면 흰 면 위 흰 줄이라
                         *   어느 줄이 골라졌는지 한눈에 안 들어온다(연한 면 위에서는 더 그렇다).
                         * ★제일 싼 줄에는 「최저가」를 붙인다 — 이 표를 읽는 이유가 그것이기 때문이다.
                         *   목록 카드가 보여 준 값도 최저가라, 손님이 «어느 줄에서 온 숫자인지»를 여기서 잇는다.
                         */}
                        <button type="button" onClick={pick} aria-pressed={!!on} style={{
                          display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                          padding: '13px 8px 13px 10px',
                          borderTop: 'none', borderRight: 'none', borderBottom: 'none',
                          borderLeft: `3px solid ${on ? C.brand : 'transparent'}`,
                          background: 'transparent', cursor: 'pointer',
                          fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                          fontSize: rateFs, fontWeight: on ? 700 : 500, color: on ? C.brand : C.ink,
                        }}>
                          {x.m}개월
                          {cheapest === x.m ? (
                            <span style={{
                              flex: '0 0 auto', padding: '2px 6px', borderRadius: 5,
                              background: C.brandBg, color: C.brand,
                              fontSize: mobile ? 9.5 : 10.5, fontWeight: 700, letterSpacing: '-0.01em',
                            }}>최저가</span>
                          ) : null}
                        </button>
                      </td>
                      <td style={{
                        padding: '13px 6px', textAlign: 'right', whiteSpace: 'nowrap',
                        fontSize: rateFs, fontWeight: on ? 800 : 600, color: C.ink,
                      }}>{manWon(x.rent)}</td>
                      <td style={{
                        padding: '13px 8px 13px 6px', textAlign: 'right', whiteSpace: 'nowrap',
                        fontSize: rateFs, color: C.mute,
                      }}>{x.deposit > 0 ? manWon(x.deposit) : '없음'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        </div>
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
      /*
       * 940 이다(2026-09-05 에 1120 에서 줄였다). 1120 은 «사진 + 옆 값 칸» 두 단을 담으려던 폭인데,
       * 한 줄 스크롤로 바꾸고 나면 그 폭이 그대로 **본문 한 줄의 길이**가 된다 —
       * 보험·운전의 흐린 나열이 1,100px 한 줄로 뻗어 눈이 줄 끝에서 다음 줄 머리를 못 찾는다.
       * 폰과 «같은 순서»를 넓게 그리는 것이지, 넓다고 더 벌리는 게 아니다.
       */
      maxWidth: 940, margin: '0 auto',
      // 하단 고정독이 마지막 줄을 덮지 않게 그만큼 비운다.
      padding: mobile ? '16px 16px 108px' : '26px 24px 40px',
    }}>
      {/*
        ★★**웹도 폰과 같은 «한 줄 스크롤»이다**(사장님 2026-09-05 「저 대여료를 꼭 사진 우측에서
          보여줄 필요가 있어? 그냥 전체에 위아래로 스크롤하고 저 대여료 섹션을 어딘가에다 갖고 가서
          보기 좋게 보여주면 되잖아」).

        여기 있던 것 — 웹만 「왼쪽 사진 · 오른쪽 따라오는 값 칸(340px)」 2단이었다. 그러면
        **같은 화면인데 웹과 폰이 다른 물건**이 된다. 구역 순서가 갈리고(웹은 대여료가 사진 «옆»,
        폰은 사진 «아래»), 손볼 때마다 두 벌을 손대야 하고, 한쪽만 고치면 다른 쪽이 「또 원래대로」가 된다.
        ⇒ 순서를 하나로 못 박는다: **사진 → 차명 → 대여료 → 차량정보 → 옵션 → 보험 → 계약 → 운전 → 기타.**
           웹은 그 순서를 «넓게» 그릴 뿐이다.
        ★대신 대여료 칸이 넓어진 만큼 안에서 가로로 편다(아래 `priceCard` 참고) —
          좁은 칸에서 세로로 쌓던 것을 그대로 늘리면 900px 짜리 빈 줄이 세 개 생긴다.
      */}
      {bar}
      {gallery}
      <Head title={title} facts={facts} />
      <Rule mobile={mobile} />
      {priceCard}

      {/*
        ② **탈 수 있는 조건** — 저신용 손님이 요금 다음으로 묻는 것은 「내가 될까」다.
           나이 하나가 결정적이라 그것만 크게 세운다.
      */}
      <Tiles title="탈 수 있는 조건" rows={canDrive} cols={mobile ? 2 : 4} mobile={mobile} icon={IdCard}
        lead={ageRange ? { label: '운전 가능 연령', value: ageRange } : undefined} />

      {/*
        ③ **처음에 드는 돈** — 이 손님층의 1번 장벽은 월요금이 아니라 **목돈**이다.
           그래서 보증금을 크게 세우고, 바로 옆에 「나눠 낼 수 있나 · 카드 되나」를 붙인다.
        ★보증금은 «고른 기간»의 값이다 — 위 표에서 줄을 바꾸면 이 숫자도 같이 바뀐다.
      */}
      <Tiles title="처음에 드는 돈" rows={upfront} cols={mobile ? 2 : 4} mobile={mobile} icon={Wallet}
        lead={plan ? {
          label: '보증금',
          value: plan.deposit > 0 ? manWon(plan.deposit) : '없음',
        } : undefined} />

      {/*
        ④ **나중에 더 드는 돈** — 조사에서 **남들이 전부 틀리는 자리**다.
           Hertz 는 큰 숫자 셋 옆에 실제 지불액을 바꾸는 넷을 각주로 미뤘고, Cinch 는 초과주행이
           두 군데에 다른 값으로 적혀 있었다. **각주로 미루지 않고 제 구역을 준다.**
      */}
      <Tiles title="나중에 더 드는 돈" rows={later} cols={mobile ? 2 : 4} mobile={mobile} icon={ReceiptText}
        lead={deductible ? { label: '사고 시 내 부담', value: deductible } : undefined} />

      {/*
        ⑤ **차에 딸려 오는 것** — 값을 그대로 쓴다. 「포함」이라 단정하지 않는다.
           이 차는 보험이 「별도」다 — 제목만 보고 포함이라 쓰면 그건 거짓말이다.
      */}
      <Tiles title="차에 딸려 오는 것" rows={bundled} cols={mobile ? 2 : 3} mobile={mobile} icon={PackageCheck} />

      {/*
        ★★**차량 정보 = 「이 차가 무엇인가」 한 덩어리**(사장님 2026-09-05).
          세부모델·세부트림 한 줄 → 연식·주행거리·배기량·연료 → 색상·정원·최초등록 → **선택 옵션**.
        ⚠ 「옵션」은 여기 있던 **별도 구역이었다.** 합쳤다 — 옵션은 그 차의 «사양»이지 딴 이야기가
          아니다. 따로 세우면 손님이 차 설명을 읽다 말고 띠를 하나 건너뛰어야 하고,
          정작 옵션이 없는 차(34%)에서는 구역이 통째로 사라져 구성이 차마다 달라 보였다.
      */}
      {(modelLine || specs.length || options.length) ? (
        <>
          <Rule mobile={mobile} />
          <section aria-label="차량 정보">
            <SecTitle icon={Car}>차량 정보</SecTitle>

            {modelLine ? (
              /* 맨 윗줄은 «이름»이라 통째로 한 줄을 준다 — 아래 값 칸들과 성격이 다르다. */
              <div style={{
                padding: mobile ? '13px 12px' : '15px 14px', marginBottom: 8,
                borderRadius: SHOP.r.card, background: C.zebra,
              }}>
                <div style={{ fontSize: SHOP.fs.cap, color: C.faint, marginBottom: 7 }}>세부모델 · 세부트림</div>
                <div style={{
                  fontSize: mobile ? 16 : 17, fontWeight: 700, color: C.ink,
                  wordBreak: 'keep-all', lineHeight: 1.4,
                }}>{modelLine}</div>
              </div>
            ) : null}

            {specs.length ? (
              <div style={{
                display: 'grid', gap: 8,
                gridTemplateColumns: `repeat(${mobile ? 2 : 4}, minmax(0, 1fr))`,
              }}>
                {specs.map(([k, v]) => (
                  <div key={k} style={{
                    minWidth: 0, padding: mobile ? '13px 12px' : '15px 14px',
                    borderRadius: SHOP.r.card, background: C.zebra,
                  }}>
                    <div style={{ fontSize: SHOP.fs.cap, color: C.faint, marginBottom: 7, letterSpacing: '0.01em' }}>{k}</div>
                    <div style={{
                      fontSize: SHOP.fs.body, fontWeight: 700, color: C.ink,
                      wordBreak: 'keep-all', lineHeight: 1.45,
                    }}>{v}</div>
                  </div>
                ))}
              </div>
            ) : null}

            {options.length ? (
              <div style={{ marginTop: 18 }}>
                <div style={{ marginBottom: 9, fontSize: SHOP.fs.cap, fontWeight: 600, color: C.mute }}>선택 옵션</div>
                {/*
                 * ★**열 개에서 자른다**(엔카 주요옵션 10개 뒤 「45개 모두보기」 · 케이카 12개).
                 * ★★**한둘 숨기려고 자르지 않는다** — 열한 개를 열로 잘라 버튼을 다는 건 손님에게
                 *   손해다. 그래서 문턱이 12다. 버튼은 **남은 개수를 말한다**(숫자 없는 「더보기」는 안 눌린다).
                 * ⚠ 이 절단은 지금 데이터에서는 한 번도 안 걸린다 — 721대 옵션이 **최대 8개**다.
                 *   규격만 세워 둔 것이고, 공급사가 옵션을 더 실으면 그날 걸린다.
                 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(options.length > OPT_CUT + 1 && !openOpts ? options.slice(0, OPT_CUT) : options).map((o) => (
                    <span key={o} style={{
                      padding: '7px 12px', borderRadius: SHOP.r.chip, background: C.zebra,
                      fontSize: SHOP.fs.sub, color: C.sub,
                    }}>{o}</span>
                  ))}
                </div>
                {options.length > OPT_CUT + 1 && !openOpts ? (
                  <button type="button" onClick={() => setOpenOpts(true)} className="fp-shop-press"
                    style={{
                      marginTop: 12, padding: '9px 14px', borderRadius: SHOP.r.chip,
                      border: `1px solid ${C.line}`, background: 'transparent', cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: SHOP.fs.sub, fontWeight: 600, color: C.sub,
                    }}>옵션 {options.length}개 모두 보기</button>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {hasPolicy ? (
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
        폰 하단 고정독 — **이전(고정폭 92) + 전화(나머지 전부)**.
        사장님 2026-09-05 「모바일에서는 하단 그 탭바 쪽에 **전화 누르기랑 이전 버튼**이랑 이렇게 할 건데」.

        ★이게 집 규격 그대로다 — 「비주요(이전) 고정폭 92 · 주요 나머지 전부」(전자계약 `.c-footer.wiz`).
          여기만 다른 짜임을 쓸 이유가 없었다.
        ⚠ 여기 있던 **금액 칸을 걷었다.** 남의 사이트가 그렇게 한다는 이유로 넣었는데
          (엔카 하단바가 가격을 든다), 그러면 이 화면에서 **금액이 세 번** 나온다 —
          큰 숫자 · 보조표의 고른 줄 · 독. 세 번 말하는 숫자는 강조가 아니라 소음이다.
        ★그래서 「이전」이 위 실행줄의 「목록으로」를 **대신한다**(폰에서는 위에서 뺐다).
          같은 일을 하는 문이 위아래로 둘이면 그건 문이 아니라 헷갈림이다.
          라우트를 벗어나는 이동은 집 규격상 **하단 「이전」**의 자리다.
      */}
      {mobile ? (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
          display: 'flex', alignItems: 'center', gap: 8,
          background: C.bg, borderTop: `1px solid ${C.line}`,
          padding: '10px 16px 14px',
          paddingBottom: 'calc(14px + var(--fp-dock-safe, env(safe-area-inset-bottom)))',
        }}>
          <Link href={listHref} onClick={() => haptic.nav()} className="fp-shop-press"
            style={{
              flex: '0 0 92px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              height: 54, borderRadius: SHOP.r.chip,
              border: `1px solid ${C.line}`, background: C.bg, color: C.sub,
              textDecoration: 'none', fontSize: SHOP.fs.sub, fontWeight: 600,
            }}>
            <ArrowLeft size={ICON.md} aria-hidden />이전
          </Link>
          {telHref ? (
            <a href={telHref} onClick={() => haptic.nav()} className="fp-shop-press"
              style={{
                flex: 1, minWidth: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                height: 54, borderRadius: SHOP.r.chip,
                background: C.brand, color: C.inverse, textDecoration: 'none',
                fontSize: SHOP.fs.body, fontWeight: 700, whiteSpace: 'nowrap',
              }}>
              <Phone size={ICON.md} aria-hidden />
              {agentName ? `${agentName} 담당자에게 전화` : '전화 상담'}
            </a>
          ) : (
            /* 담당자 전화가 없으면 «있는 척»하지 않는다 — 대신 대표번호가 머리띠에 떠 있다. */
            <div style={{
              flex: 1, minWidth: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 54, borderRadius: SHOP.r.chip, background: C.zebra,
              fontSize: SHOP.fs.sub, color: C.mute,
            }}>연락처는 위 안내를 확인해 주세요</div>
          )}
        </div>
      ) : null}
    </main>
  );
}

/**
 * 옵션을 몇 개에서 자르나 — **10**. 엔카가 주요옵션 10개 뒤에 「45개 모두보기」,
 * 케이카가 12개 뒤에 「모두 보기」다(2026-09-05 실측). 커머스 지침도 같은 구간을 말한다.
 * ★자르는 문턱은 **12개부터**다 — 한둘 숨기려고 버튼을 다는 건 손님에게 손해다.
 */
const OPT_CUT = 10;

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
function TopBar({ code, title, listHref, mobile }: {
  code: string; title: string; listHref: string; mobile?: boolean;
}) {
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
      {/*
       * ★**폰에서는 「목록으로」를 여기서 뺀다**(2026-09-05). 하단독의 「이전」이 같은 일을 한다.
       *   같은 문이 위아래로 둘이면 그건 문이 아니라 헷갈림이고, 라우트를 벗어나는 이동은
       *   집 규격상 «하단 이전»의 자리다. 웹은 하단독이 없으니 여기 그대로 둔다.
       */}
      {mobile ? <span style={{ flex: 1 }} /> : (
        <>
          <Link href={listHref} onClick={() => haptic.nav()} className="fp-shop-press"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 40, padding: '0 12px 0 8px', borderRadius: SHOP.r.chip,
              textDecoration: 'none', color: C.sub, fontSize: SHOP.fs.sub, fontWeight: 600,
            }}>
            <ArrowLeft size={ICON.lg} aria-hidden />목록으로
          </Link>
          <div style={{ flex: 1 }} />
        </>
      )}
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
 * **타일** — 서로 독립된 짧은 사실을 나란히 놓는다(제원 · 계약 조건).
 *
 * 이름/값 표와 무엇이 다른가. 표는 «세로로 견주는» 배열이라 값끼리 비교할 때 쓴다.
 * 이 값들은 견줄 것이 아니라 하나씩 확인하는 것이라, 라벨을 **값 위에 작게** 얹고 가로로 편다.
 * 그러면 눈이 왼쪽 라벨 열을 훑을 필요 없이 «값만» 읽고 지나간다.
 * ★속이 비면 통째로 안 그린다 — 제목만 있고 아래가 빈 칸은 「안 채웠다」로 보인다.
 */
function Tiles({ title, rows, cols, mobile, icon, lead }: {
  title: string; rows: [string, string][]; cols: number; mobile?: boolean; icon?: LucideIcon;
  /**
   * **하나가 결정적인 구역의 그 하나** — 나이·보증금·면책금.
   * 항목이 대여섯인데 그중 하나만 손님의 «결정»을 바꾸는 구역이 있다. 그 하나를 크게 위에 세우고
   * 나머지는 타일로 흘린다. 다 같은 크기로 늘어놓으면 결정적인 하나가 나머지에 묻힌다.
   */
  lead?: { label: string; value: string };
}) {
  if (!rows.length && !lead) return null;
  return (
    <>
      <Rule mobile={mobile} />
      <section aria-label={title}>
        <SecTitle icon={icon}>{title}</SecTitle>
        {lead ? (
          /*
           * ★라벨을 «흰 알약»으로 얹는다. 큰 값 옆에 같은 굵기로 두면 둘이 다투는데,
           *   알약에 얹으면 「이건 이름표」라고 한눈에 읽혀 값이 혼자 선다.
           * ⚠ 값에 색을 주지 않는다 — 구역 아이콘이 이미 신호다. 여기까지 색을 주면
           *   강조가 셋(아이콘·면·글자색)이 되어 그때부터 소란이다.
           */
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: mobile ? '14px' : '16px', marginBottom: rows.length ? 8 : 0,
            borderRadius: SHOP.r.card, background: C.zebra,
          }}>
            <span style={{
              flex: '0 0 auto', padding: '4px 10px', borderRadius: 999,
              background: C.bg, color: C.mute, fontSize: SHOP.fs.cap, fontWeight: 600,
            }}>{lead.label}</span>
            <span style={{
              fontSize: mobile ? 21 : 22, fontWeight: 800, color: C.ink,
              letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
            }}>{lead.value}</span>
          </div>
        ) : null}
        {/*
         * ★타일에 **연한 면**을 깐다(2026-09-05). 라벨·값만 허공에 놓으면 넓은 화면에서
         *   글자 몇 개가 흩어진 것으로 보여 «안 채운 칸»처럼 읽힌다. 면을 깔면 그게 «칸»이 되고,
         *   값이 짧아도 구역이 비어 보이지 않는다.
         * ⚠ 면은 `C.zebra`(가장 옅은 것) 하나뿐이다 — 테두리를 두르면 선이 다시 늘어난다.
         */}
        {rows.length ? (
        <div style={{
          display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: 8,
        }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{
              minWidth: 0, padding: mobile ? '13px 12px' : '15px 14px',
              borderRadius: SHOP.r.card, background: C.zebra,
            }}>
              <div style={{ fontSize: SHOP.fs.cap, color: C.faint, marginBottom: 7, letterSpacing: '0.01em' }}>{k}</div>
              <div style={{
                fontSize: SHOP.fs.body, fontWeight: 700, color: C.ink,
                wordBreak: 'keep-all', lineHeight: 1.45,
              }}>{v}</div>
            </div>
          ))}
        </div>
        ) : null}
      </section>
    </>
  );
}

/**
 * **뜻이 있는 값인가** — 「기타」·「협의」·「미정」 같은 말은 값이 아니라 «아직 안 정했다»는 표시다.
 *
 * 실측 — 색상 칸에 「기타」가 들어 있는 차가 있다. 그대로 내보내면 손님이 「색상 기타」를 읽는데,
 * 그건 색을 안 알려 준 것이면서 «칸은 채운» 꼴이라 안 적는 것보다 나쁘다.
 * 「협의」도 같다 — 읽고 나서 손님이 정할 수 있는 게 하나도 없고 「돈이 더 드나」만 남는다.
 * ⇒ 그런 값은 **줄째로 뺀다.** 없는 것은 없다고 하는 편이 낫다(확정 규격 §1-7 과 같은 판단).
 */
const NO_MEANING = new Set(['기타', '협의', '별도협의', '별도문의', '미정', '해당없음', '해당 없음', '없음', '-']);
function meaningful(v: string): boolean {
  const t = String(v ?? '').trim();
  return !!t && !NO_MEANING.has(t);
}

/**
 * 최초등록일 — **날짜꼴이 아니면 안 찍는다.**
 *
 * ⚠⚠ 원천이 이 칸에 «트림명»을 넣어 둔 차가 실측 26대다 — 「프레스티지」·「노블레스」·「45 TFSI」·
 *   「120i Sport」. 그대로 내보내면 손님이 **「최초등록 프레스티지」**를 읽는다. 칸이 밀린 것이라
 *   화면이 고칠 수 있는 게 아니고 고쳐서도 안 된다(지어내는 것이다) — **안 보여준다.**
 * ⚠ 두 자리 연도(「24-10」)가 91대다. 2000년대로 편다 — 우리 재고는 렌터카라 1900년대 차가 없다.
 * ★날은 안 쓴다. 손님이 재는 것은 「언제쯤 나온 차인가」지 며칠인지가 아니다.
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
 * 구역 경계 — **두꺼운 띠**.
 *
 * 두 번 헛짚고 여기 왔다(2026-09-05).
 *   ① 처음엔 구역마다 «가는 실선»을 그었다 → 표까지 줄마다 선을 그어 **한 화면이 온통 가로줄**이 됐다.
 *      사장님 「저런 쓸데없는 라인들, 없어도 되는 구분선은 최소화해야 된다」
 *   ② 그래서 선을 다 걷고 «여백만» 뒀다 → 이번엔 **어디서 갈리는지가 안 보였다.**
 *      사장님 「섹션 경계나 구분을 너무 안 주니까 이게 뭔가 싶다. 렌터카 전문으로 하는 플랫폼인데
 *      너무 섹션마다의 구분이 없잖아」
 *
 * ⇒ 실선도 여백도 아닌 **면(面)**이다. 1px 선은 «금»이라 여섯 개면 창살이 되지만,
 *   띠는 «바닥»이라 몇 개가 있어도 시끄럽지 않고 경계는 훨씬 분명하다.
 * ★폰은 화면 끝까지 흘린다(여백 밖으로 뺀다) — 안쪽에서 끊기면 띠가 아니라 또 하나의 상자가 된다.
 *   웹은 본문 칼럼 안에서 끝낸다(1120px 을 가로지르면 화면이 두 동강 난 것처럼 보인다).
 *
 * ⚠⚠ **여기 「한국 커머스가 공통으로 띠를 쓴다」고 적혀 있었다. 틀린 말이라 지웠다**(2026-09-05 실측).
 *   폰 375×812 로 재 보니 셋이 셋 다 다르다 — **엔카는 여백 50px 만**(띠도 선도 없다) ·
 *   **무신사는 띠 8px** · **당근은 1px 선**. 네이버·쿠팡은 봇차단으로 **못 쟀다.**
 *   ⇒ 「띠를 쓴다」는 무신사 한 곳의 선례고, 그 값이 **8px** 이다. 10px 은 아무 데도 없었다.
 * ★★그리고 우리는 **구분을 두 번 하고 있었다** — 띠 10 + 여백 56 = 하나에 66px(여섯이면 396px).
 *   여백만 해도 이미 엔카(50)보다 넓은데 그 위에 띠를 또 깔았다. 그러면 띠가 «경계»가 아니라
 *   빈 데 놓인 장식이 된다. 띠를 남기고(사장님이 구분을 원하셨다) **여백을 줄여** 띠가 경계를 맡는다.
 *   경계 = 8 + 40 = 48px. 이래야 「띠에서 갈린다」로 읽힌다.
 *   (구분선 원칙도 같은 말을 한다 — eBay·Material: 「여백으로 부족할 때만」 긋는다.)
 */
function Rule({ mobile }: { mobile?: boolean }) {
  return (
    <div aria-hidden style={{
      height: 8,
      background: C.zebra,
      margin: mobile ? '22px -16px 18px' : '26px 0 20px',
    }} />
  );
}

/**
 * 구역 제목 — 띠 바로 다음에 오는 글자라, 여기서 「새 구역이 시작됐다」가 확정된다.
 * 띠만으로는 «갈렸다»까지고 «무엇이 시작됐는지»는 제목이 말한다 — 그래서 굵고 크다.
 *
 * ★아이콘을 하나 붙인다(사장님 2026-09-05 「아이콘도 좀 넣고 … 적당한 강조가 있어야 되거든,
 *   촌스럽지 않은?」). 글자만 여섯 줄이면 어느 구역이나 같은 얼굴이라, 눈이 제목을 «읽어야» 안다.
 *   아이콘이 있으면 **읽기 전에** 무슨 칸인지 안다.
 * ★★색은 «흐리게»가 기본이다. 아이콘마다 색을 주면 그 순간 촌스러워진다 —
 *   빨강·초록·노랑이 한 화면에 서면 그건 강조가 아니라 소란이다.
 *   **채널색은 딱 한 구역(대여료)에만** 준다. 손님이 찾아온 답이라 거기만 서면 된다.
 */
function SecTitle({ children, icon: Icon, accent }: {
  children: React.ReactNode; icon?: LucideIcon; accent?: boolean;
}) {
  return (
    <h2 style={{
      margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8,
      /*
       * 20px 이다(2026-09-05 에 18에서 올렸다). 엔카 폰 상세의 대구역 제목이 **22px/700**,
       * 우리 차명(h1)이 22px 이다. 구역 제목이 18이면 7화면짜리 페이지를 훑을 때
       * «착지 표지»로 안 걸린다 — 눈이 제목을 읽어야 아는 크기다.
       * 차명(22)보다는 한 단 낮게 둬서 위계는 지킨다.
       */
      fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: '-0.025em',
    }}>
      {/*
       * ★아이콘을 **연한 사각 면 위에** 앉힌다(2026-09-05). 맨 글리프를 흐린 회색으로 두면
       *   제목 옆에 붙은 «먼지»처럼 보여, 아이콘을 넣은 뜻(읽기 전에 무슨 칸인지 안다)이 안 산다.
       *   면에 앉히면 그 자체가 «표지»가 되어 스크롤에서 눈에 걸린다.
       * ★★색은 여전히 대여료 하나만 브랜드색이다 — 아이콘마다 색을 주면 그때부터 소란이다.
       */}
      {Icon ? (
        <span aria-hidden style={{
          flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: 9,
          background: accent ? C.brandBg : C.zebra,
        }}>
          <Icon size={18} style={{ color: accent ? C.brand : C.mute }} />
        </span>
      ) : null}
      {children}
    </h2>
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
 * 사진 — **손가락으로 미는** 갤러리.
 *
 * ★브라우저의 가로 스크롤 + `scroll-snap` 을 그대로 쓴다. 관성·고무줄이 공짜로 따라오고
 *   한 장씩 딱 멈춘다. JS 로 드래그를 흉내 내면 그 둘이 없어 «싸구려 같은» 움직임이 된다.
 * ★화살표는 마우스 쓰는 사람 몫이다 — 폰에서는 아무도 안 누른다(사진은 미는 것이라고 손이 안다).
 * ★사진이 한 장뿐이면 화살표도 점도 세는 표시도 안 그린다 — 누를 데가 없는 단추를 두지 않는다.
 * ★사진이 없으면 «없다»고 조용히 말한다. 실측 28%가 그렇다 — 회색 판만 두면 고장으로 보인다.
 */
function Gallery({ p, mobile }: { p: EntityRecord; mobile?: boolean }) {
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
      /*
       * ★넓은 화면에서는 **높이를 520 에서 끊는다**(2026-09-05). 2단을 걷고 한 줄로 펴자
       *   사진이 본문 폭(892)을 다 먹어 4:3 이면 **669px** 이 됐다 — 노트북 첫 화면(900)이
       *   사진 하나로 끝나고, 손님이 찾아온 답(대여료)이 접힘 아래로 내려간다.
       *   폰은 390 폭이라 292px 이라 그대로 둔다.
       * ⚠ 4:3 → 1.7:1 이라 위아래가 12%씩 잘린다. 차 사진은 대개 가로라 견디지만,
       *   잘려서 못 보는 장이 있으면 화살표·「n / N」 로 다음 장을 본다.
       */
      maxHeight: mobile ? undefined : 520,
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
