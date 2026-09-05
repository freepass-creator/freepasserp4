'use client';
import { memo } from 'react';
import Link from 'next/link';
import { Check, CircleCheck, ImageOff, ShieldCheck, Tag } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { C, FW, NUM } from '@/components/ui';
import { PerkMarks, SHOP, type ShopMark } from '@/components/shop/shop-ui';
import { useIsMobile } from '@/lib/use-mobile';
import { useInView } from '@/lib/use-in-view';
import { useFirstPhoto } from '@/components/use-product-photos';
import { haptic } from '@/lib/haptics';
import { cheapest, creditDisplay, CREDIT_UNSET } from '@/lib/domain/product';
import { PERKS, hasPerk } from '@/lib/domain/product-filters';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import { yearFullDisplay, fuelDisplay } from '@/lib/domain/vehicle-master-format';
import { isEvFuel, kmDisplay, kmValue, manShort } from '@/lib/format';

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
 * ★★우대조건은 **상세와 같은 칩 원자**(`shop-ui` `PerkMarks`)를 쓴다 — 아이콘 + 먹색 글자다
 *   (사장님 2026-09-05 「목록 페이지하고 전체 구성 한번 맞춰보자 — **일체감이 있는지**」).
 *   ⚠ 2026-09-04 까지는 여기가 **ERP `Badge` 원자**(테두리 두른 박스)였다. 사장님 「뱃지로
 *     들어가거나 우리 그 ERP에서 쓰는 거 있잖아」를 그렇게 읽었는데, 그 뒤 상세가 09-05 에
 *     아이콘+글자로 확정되면서 **같은 값이 두 화면에서 다른 모양**이 됐다. 카드에서 상세로
 *     넘어가면 손님이 「다른 표시인가」를 한 번 생각한다.
 *   ⇒ 상세 쪽으로 맞췄다. 집 규칙(2026-08-28·08-30 「박스 뱃지 쓰지 말고 아이콘 텍스트로,
 *     **모든 곳에서**」)과도 이쪽이 맞다. 박스로 되돌리려면 **먼저 여쭙는다** — 그때는 상세도
 *     같이 되돌려야 한다. 한쪽만 바꾸면 다시 갈린다.
 *   ★색은 아이콘에만(무심사 초록 · 소득확인·신용조회는 흐림 · 나머지 채널색), 글자는 먹색.
 */
export const ShopCard = memo(function ShopCard({ p, href }: {
  p: EntityRecord;
  href: string;
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
  /* 주행거리는 «한 읽개»로 읽는다 — 콤마·「만km」를 견딘다(`kmValue`). 각자 파싱하면 또 갈린다. */
  const km = kmValue(p.mileage);
  /*
   * ★전기차는 배기량이 없다 — 원천이 실어 보내도 안 쓴다(`isEvFuel` 머리말. 42대 중 9대가
   *   딴 차 값을 들고 있다). 상세만 가리고 여기는 내보내고 있어서 **같은 차가 두 화면에서
   *   다르게** 보였다(코덱스 2026-09-05 검토).
   */
  const cc = isEvFuel(p.fuel_type) ? 0 : (Number(p.engine_cc) || 0);
  /*
   * ★★**차번은 차명 «뒤»에 붙는다** — 상세와 같은 규칙이다(사장님 2026-09-05 「차량 번호를
   *   그 현대 그랜저 뒤쪽으로 갖고 오는 게 맞을 것 같아요」 · 목록도 같이 맞춘다).
   *   차번은 따로 떨어진 정보가 아니라 **이름의 끝**이다 — 「모닝」은 백 대가 있고
   *   「모닝 284무4044」가 이 차다. 사실 줄 맨 앞에 두면 이름과 갈려 «값 하나»로 읽힌다.
   * ⚠ 2026-09-04 에는 「차번이 이 줄의 맨 앞」이었다. 상세가 09-05 에 이름 뒤로 확정되면서
   *   두 화면이 갈렸고, 상세 쪽으로 맞췄다. 자리만 옮긴 것이고 **빼지 않았다** —
   *   실물 재고를 파는 판에서 「이 차다」의 증거다.
   */
  const plate = String(p.car_number || '').trim();
  const facts = [
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
  /*
   * ★★**상세와 «같은 얼굴»이다**(사장님 2026-09-05 「목록 페이지하고 전체 구성 한번 맞춰보자 —
   *   상세 페이지에 맞는 자연스러운 화면인지, **일체감이 있는지**」).
   *   여기만 **테두리 두른 박스 뱃지**였다. 같은 값(무심사·분납가능·만21세·경력무관)이 상세에서는
   *   아이콘 + 글자로 서 있어, 카드에서 상세로 넘어가면 손님이 「다른 표시인가」를 한 번 생각했다.
   *   집 규칙도 이쪽이 틀렸다 — 사장님 2026-08-28·08-30 「박스 뱃지 쓰지 말고 아이콘 텍스트로,
   *   **모든 곳에서**」. 손님 카드가 그 「모든 곳」에서 빠져 있었다.
   * ⇒ 꼴은 `shop-ui` 의 `PerkMarks` 하나가 든다(상세와 같은 원자). 카드는 «무엇을 실을지»만 정한다.
   * ★심사는 셋(무심사·소득확인·신용조회) — 무심사만 초록이고 나머지 둘은 «해야 할 일»이라 흐리다.
   */
  /*
   * ★★**신원 칩은 «사진 우하»다**(사장님 2026-09-05 「출고 가능, 그리고 상품 구분 요거는
   *   그 **썸네일 사진 우측 하단**으로 들어가도 되지 않나」). 업무동 카드가 이미 그 자리를 쓴다
   *   (`product-card-atoms` — 사장님 2026-09-04 「박스를 달리해서 텍스트에 딱 붙여 두 개로」).
   *   ⇒ 두 목록이 **같은 자리·같은 짜임**이 된다. 글자 줄에서 내려오면서 카드 본문은
   *     「차명 → 사실 → 요금 → 조건」 넉 줄로 단정해진다(사장님 「대여료 밑에는 분납 가능,
   *     만21세, 경력 무관 이런 거」 — 그 줄이 바로 아래에 남는다).
   * ★사진 위는 **흰 글자·흰 그림 + 어두운 유리**(`.fp-onphoto`·`.fp-signal-chip`)다 —
   *   사진 밝기가 제각각이라 톤색은 안 읽힌다. 이건 이미 확정된 처리라 새로 만들지 않는다.
   * ★**낱개 칩 둘**이다. 한 그릇에 담으면 「출고가능 픽업구독」이 한 덩어리 문장처럼 읽힌다 — 다른 갈래다.
   * ⚠ 글자 줄에 있을 때는 「출고가능」(721대 중 492)을 뺐다 — 열에 일곱 장에 같은 말이 붙으면
   *   본문 한 줄을 소음이 먹기 때문이었다. **사진 위로 오면서 되살렸다** — 거기서는 본문을
   *   밀어내지 않고, 「살 수 있는 차인가」는 목록에서 제일 먼저 확인하는 값이다.
   */
  const status = String(p.vehicle_status || '').trim();
  const kind = String(p.product_type || '').trim();
  const stateMarks: ShopMark[] = [
    ...(status ? [{ text: status, icon: CircleCheck, good: /출고가능|즉시출고/.test(status) }] : []),
    ...(kind ? [{ text: kind, icon: Tag }] : []),
  ];

  const marks: ShopMark[] = [
    ...(credit ? [{
      text: credit, icon: ShieldCheck,
      good: /무심사/.test(credit), ask: !/무심사/.test(credit),
    }] : []),
    /*
     * ⚠ 「무보증」은 **바로 윗줄이 이미 「보증금 없음」이라고 말한** 차에서 뺀다(2026-09-05 검토).
     *   같은 카드에서 같은 사실을 두 번 하면 자리를 낭비하고, 손님은 「둘이 다른 건가」를 생각한다.
     */
    ...PERKS.filter((k) => hasPerk(p, k) && !(k === '무보증' && price && price.deposit === 0))
      .map((k) => ({ text: k as string, icon: Check })),
    ...(sameDay ? [{ text: '당일출고', icon: CircleCheck, good: true }] : []),
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
        <ShopThumb p={p} marks={stateMarks} />

        <div style={{
          padding: mobile ? '12px 2px 2px' : '13px 2px 2px',
          display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1,
        }}>
          {/*
            차명 — 두 줄로 접히면 카드마다 높이가 달라져 목록이 들쭉날쭉해진다. 한 줄로 못 박고
            넘치면 … 로 자른다(전문은 title 속성이 들고 있고, 상세로 들어가면 다 보인다).
          */}
          {/*
            ⚠ 차명과 차번을 «한 칸»에 넣고 통째로 말줄임했더니, 이름이 긴 차는 **차번이 통째로
              사라졌다**(코덱스 2026-09-05 검토). 차번은 「이 차다」의 증거라 잘리면 안 된다.
            ⇒ 줄이는 것은 **이름만**이다 — 차번은 제 폭을 갖고 끝에 붙어 선다.
          */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            <span style={{
              fontSize: SHOP.fs.h2, fontWeight: 700, color: C.ink,
              lineHeight: 1.35, letterSpacing: '-0.02em', minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={title}>{title}</span>
            {plate ? (
              <span style={{
                flex: '0 0 auto', fontSize: SHOP.fs.sub, fontWeight: FW.meta,
                color: C.mute, fontFamily: NUM, letterSpacing: 0, whiteSpace: 'nowrap',
              }}>{plate}</span>
            ) : null}
          </div>

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
            ★★**훑는 자리라 자릿수를 줄인다**(사장님 2026-09-05 「간단하게 보는 거에서는 보증금은
              120만원 이렇게 뒤에 거 다 떼내고, 대여료는 46.7만원·99.9만원 이런 식으로 만까지만」).
              대여료 = 만 단위 소수 한 자리(견주는 값이라 천원 자리가 판을 가른다) ·
              보증금 = 만원 단위(목돈의 «크기»를 재는 값이다). 둘 다 **버린다 — 반올림 아니다**.
            ⚠ 상세는 그대로 원 단위다(`manWon`) — 거기는 «낼 금액»을 확인하는 자리다.
          */}
          {price && price.rent > 0 ? (
            /* ⚠ 잘라 내지 않는다 — 「보증금 103만 5,…」로 끝이 잘리고 있었다(2026-09-05 실측).
                 보증금은 저신용 손님이 제일 먼저 재는 «지금 드는 돈»이라, 자리에 안 맞으면
                 자르는 게 아니라 **다음 줄로 내린다**(`flexWrap`). 값은 줄이지 않는다. */
            <div style={{
              display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8, rowGap: 2,
              marginTop: 5, minWidth: 0,
            }}>
              <span style={{ fontSize: SHOP.fs.sub, color: C.mute, flex: '0 0 auto' }}>
                {price.m}개월
              </span>
              <span style={{
                fontSize: mobile ? 25 : 24, fontWeight: FW.head, color: C.ink, flex: '0 0 auto',
                letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums',
              }}>{manShort(price.rent, { decimal: true })}</span>
              {/*
                ★「보증금 없음」에만 색을 준다(2026-09-05). 저신용 손님의 1번 장벽은 월요금이 아니라
                  **지금 당장 필요한 목돈**이라, 이 판에서 제일 센 말이 이거다.
                  뱃지를 하나 더 세우는 대신 «있는 글자»에 색을 얹었다 — 「무보증」 뱃지를 뺀 자리를
                  이게 대신한다(같은 사실을 두 번 말하지 않으면서 눈에는 선다).
                ⚠ 보증금이 «있는» 차는 흐린 회색 그대로다. 금액마다 색을 주면 그건 강조가 아니라 소란이다.
              */}
              <span style={{
                fontSize: SHOP.fs.sub, flex: '0 0 auto', whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
                color: price.deposit > 0 ? C.mute : C.ok,
                fontWeight: price.deposit > 0 ? 400 : 700,
              }}>
                {price.deposit > 0 ? `보증금 ${manShort(price.deposit)}` : '보증금 없음'}
              </span>
            </div>
          ) : null}

          {/*
            ⑤ 우대조건 — **상세와 같은 원자**(`PerkMarks`). 위 `marks` 머리말 참고.
            ★카드는 좁으니 한 단 작게 든다(글자 12 · 아이콘 13) — 꼴은 같고 치수만 준다.
          */}
          {marks.length ? (
            <div style={{ marginTop: 'auto', paddingTop: 10 }}>
              <PerkMarks marks={marks} fs={SHOP.fs.cap} size={13} columnGap={10} />
            </div>
          ) : null}
        </div>
      </Link>

      {/*
        관심 표시 — 카드 «위»에 따로 올린다. Link 안에 두면 하트를 누를 때마다 상세로 넘어간다.
        손님이 여러 대를 두고 고민하는 것이 이 장사의 정상 흐름이라 담아 둘 곳이 있어야 한다.
        자리는 **사진 위 오른쪽** — 글자 위에 얹으면 차명을 가린다.
      */}
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
function ShopThumb({ p, marks = [] }: { p: EntityRecord; marks?: ShopMark[] }) {
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

      {/*
        ★사진 우하 = **출고상태 · 상품구분**(위 `stateMarks` 머리말). 업무동 카드와 같은 자리다.
        ★흰 글자·흰 그림 + 어두운 유리(`.fp-onphoto`·`.fp-signal-chip`) — 사진 밝기가 제각각이라
          톤색은 안 읽힌다. 둥글기만 가게 말씨로 맞춘다(업무동은 각지고 여기는 알약이다).
        ⚠ 사진이 없는 차(28%)에도 그대로 선다 — 회색 판 위에서도 읽힌다.
      */}
      {marks.length ? (
        <div className="fp-onphoto" style={{
          position: 'absolute', right: 8, bottom: 8, zIndex: 2,
          display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '92%',
        }}>
          {marks.map((m) => (
            <span key={m.text} className="fp-signal-chip" style={{
              gap: 4, borderRadius: SHOP.r.chip,
              fontSize: SHOP.fs.cap, fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              <m.icon size={12} aria-hidden />{m.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
