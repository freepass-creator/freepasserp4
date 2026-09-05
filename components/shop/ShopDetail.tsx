'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Car, Check, ChevronLeft, ChevronRight, CircleCheck, Coins, FileText, Heart, Plus, Tag,
  IdCard, ImageOff, Info, Phone, Share2, ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { C, FW, FS, ICON } from '@/components/ui';
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
  /*
   * ★맨 위 제목은 차명 원자의 **`base` 단**이다 — 「현대 그랜저」에서 끝낸다
   *   (사장님 2026-09-05 「요약으로 보여주는 데는 **그냥 현대, 그랜저** 이렇게만 보여줘도 상관은 없어.
   *   그리고 차량 정보에 좀 **디테일한 차명 세부 트림**이 들어가는 거고」).
   * ★세부 트림까지 붙은 전문 이름은 아래 **차량 정보의 첫 줄**이 든다 —
   *   훑는 자리와 확인하는 자리는 하는 일이 다르다. 같은 이름을 두 번 말하지 않는다.
   * ⚠ `base` 단은 이 요구 때문에 차명 원자에 «새로» 낸 것이다(2026-09-05). 원자를 고쳤지
   *   이 화면에서 이름을 손으로 조립하지 않았다 — 그러면 화면마다 이름이 갈린다.
   */
  const title = vehicleNameOf({ kind: 'product', product: p }, { tier: 'base', fallback: 'none' }) || '차량';

  /** 매물 필드 읽기 — 정책의 `S` 와 달리 상품 자체의 값이다. */
  const S2 = (v: unknown) => String(v ?? '').trim();
  const km = Number(String(p.mileage ?? '').replace(/[^0-9.]/g, '')) || 0;
  /*
   * ★★**전기차에는 배기량을 안 쓴다**(2026-09-05 전수에서 잡았다).
   *   실측 — 전기 42대 중 **9대에 `engine_cc` 가 붙어 있다**: EV6 111 · 모델3 239 · 캐스퍼 158 ·
   *   니로 180, 그리고 **니로 넷은 1580**(가솔린 니로의 배기량이 전기 니로에 붙은 것이다).
   *   전기차는 배기량이라는 값 자체가 없다. 그대로 내보내면 **손님 화면에 거짓 숫자**가 뜬다.
   * ⇒ 원천을 못 고치는 동안 화면이 «안 보여준다». 지어내지 않는 것과 같은 규칙이다 —
   *   틀린 값을 보여주는 것은 안 보여주는 것보다 나쁘다.
   * ⚠ 하이브리드는 엔진이 있으므로 그대로 쓴다.
   */
  const isEv = /전기|EV|이브이/i.test(String(p.fuel_type || ''));
  const cc = isEv ? 0 : (Number(p.engine_cc) || 0);
  const seats = Number(p.seats) || 0;
  /*
   * ★★요약줄은 **차번 하나**다(2026-09-05 저녁).
   *   사장님 「어떤 원자가 그 해당 섹션에 들어가야 되고 **중복되면 안 되지** …
   *   어정쩡한 데에 명분 없이 들어가지 마. **꼭 있어야 될 자리에 있어야 되고**」.
   * ⚠ 여기 「차번 · 연식 · 주행 · 배기량 · 연료」 다섯이 있었다. 그중 **넷이 바로 아래
   *   차량 정보와 같은 값**이었다 — 손님이 두 화면 뛰어 같은 것을 두 번 읽는다.
   *   게다가 차량 정보 쪽이 라벨이 붙어 «무슨 값인지»까지 말하므로, 요약줄은 늘 «덜 정확한 쪽»이다.
   * ★남긴 차번은 **차량 정보에 없는 유일한 값**이고, 이 차를 특정하는 신원이라
   *   제목 바로 밑이 그 자리다.
   */
  const facts = String(p.car_number || '').trim();

  /*
   * ⚠⚠ 여기서 **우대조건 뱃지 목록을 만들고 있었다**(심사 + 분납가능·무보증·만21세·경력무관).
   *   걷었다(2026-09-05 저녁) — 넷이 전부 아래 제자리와 «같은 말»을 하고 있었기 때문이다.
   *   자세한 대조는 대여료 구역의 주석에 적어 뒀다.
   * ★「심사(무심사)」는 애초에 여기까지 값이 오지도 않는다 — `screening_criteria` 는 정책 정본이
   *   **내부용**으로 못 박아 둔 값이고(`policy-tier` 「손님 화면·계약서에 절대 실리지 않는다」)
   *   손님 화이트리스트에도 없다. 열지 여부는 사장님 판단을 기다린다.
   */

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
   * ★★★**차량 정보에 들어갈 것은 사장님이 세어 주셨다**(2026-09-05).
   *
   * > 「차량 정보 섹션은 뻔해. **차명 · 선택 옵션**, 그리고 그 밑으로 **색상, 연식, 주행거리,
   * >  배기량, 연료, 구동 방식, 인승, 배터리 정보**(전기차에만 해당이 되겠지?), 그리고
   * >  **차량 가격 — 신차 가격 기준**. 그 정도가 차량 정보에만 딱 들어가면 돼.
   * >  그리고 차량 정보에 좀 **디테일한 차명 세부 트림**이 들어가는 거고,
   * >  **요약으로 보여주는 데는 그냥 현대, 그랜저** 이렇게만 보여줘도 상관은 없어.」
   *
   * ⇒ 차명(전문) → 선택 옵션 → 외부/내부 색상 · 연식 · 주행거리 · 배기량 · 연료 ·
   *   구동방식 · 승차정원 · 배터리 · 차량가격.
   * ★**구동방식이 돌아왔다.** 09-05 낮에 사장님이 「연식이, 이륜구동, 이런 걸 넣는 게 아니라」
   *   하셔서 뺐는데, 그때 지적은 «구동방식이 첫 칸이었던 것»이지 «있으면 안 된다»가 아니었다.
   *   이번에 직접 넣으라 하셨으므로 되돌린다 — 자리는 뒤쪽이다.
   * ★**최초등록은 뺐다** — 사장님이 세어 주신 목록에 없다(「그 정도가 딱 들어가면 돼」).
   * ★★**배터리는 전기차에만.** 배기량이 없는 자리를 대신 든다.
   *   ⚠ 값이 오는지는 원천에 달렸다 — `battery_capacity` 는 ERP 원자에는 있는데 손님 API
   *     화이트리스트에 없어서 여태 화면까지 못 왔다. 그 줄을 이번에 열었다.
   * ⚠⚠ **차량 가격(신차가)은 «데이터가 없다».** `vehicle_price` 는 이 사업에 없는 개념이고
   *   실측으로도 전 대수가 비어 있다(`public-catalog` 주석). 신차 기준가를 담는 칸 자체가 없다.
   *   ⇒ **지어내지 않는다.** 자리는 만들어 뒀으니 원천이 값을 실어 주면 그날 바로 뜬다.
   */
  const isEvSpec = isEv;
  const specs: [string, string][] = ([
    ['외부 색상', String(p.ext_color || '')],
    ['내부 색상', String(p.int_color || '')],
    ['연식', yearFullDisplay(p.year)],
    ['주행거리', km > 0 ? kmDisplay(p.mileage) : ''],
    /*
     * ★★**배기량과 배터리는 «한 칸»을 나눠 쓴다**(사장님 2026-09-05 「배기량하고 배터리 정보가
     *   같이 들어갈 일이 없으니까 … 전기차는 배터리 용량이 **그 항목을 바꿔 가면서** 쓰는 거야」).
     *   맞다 — 한 차가 둘 다 갖는 일이 없다. 두 칸을 따로 세우면 어느 차를 봐도 **하나는 늘 비고**,
     *   격자에 구멍이 생겨 「덜 채운 표」로 보인다. 라벨이 바뀌는 한 칸이면 언제나 꽉 찬다.
     * ★업무동도 같은 규칙이다(`lib/domain/product.ts` `ccLabel` — 「전기차는 배터리 용량이
     *   그 자리를 든다」, 사장님 2026-08-23). 두 화면이 같은 말을 같은 방식으로 한다.
     */
    [isEvSpec ? '배터리' : '배기량',
      isEvSpec
        ? (Number(p.battery_capacity) > 0 ? `${Number(p.battery_capacity)}kWh` : '')
        : (cc > 0 ? `${cc.toLocaleString('ko-KR')}cc` : '')],
    ['연료', fuelDisplay(p.fuel_type) || String(p.fuel_type || '')],
    ['구동방식', String(p.drive_type || '')],
    ['승차정원', seats > 0 ? `${seats}인승` : ''],
    ['차량 가격', Number(p.vehicle_price) > 0 ? `${Math.round(Number(p.vehicle_price) / 10000).toLocaleString('ko-KR')}만원` : ''],
  ] as [string, string][]).filter(([, v]) => meaningful(v));

  /** 차량 정보 맨 윗줄 — **전문 차명**. 위 요약(h1)은 짧게 두고 여기서 세부 트림까지 편다. */
  const modelLine = [makerDisplay(p.maker), String(p.sub_model || '').trim(), String(p.trim_name || '').trim()]
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
   * ★★★**구역 순서는 사장님이 정하셨다**(2026-09-05).
   *
   * > 「**사진이 맨 위에 있고, 다음에 차량 정보** 설명하고, 그 다음에 **대여료 정보** 설명하고
   * >  **보험** 관련된 거 설명하고, 다음에 뭐 **운전자 연령, 주행거리 같은 조건** 설명하고
   * >  **기타사항** 설명하고, 이거를 **각 섹션마다 좀 디자인을 해서 모바일 웹** 이렇게 디자인하는 게」
   *
   *     ① 사진        ② 차량 정보     ③ 대여료
   *     ④ 보험        ⑤ 이용 조건     ⑥ 기타 사항
   *
   * ⚠ 여기 있던 「손님이 묻는 순서」(탈 수 있는 조건 / 처음에 드는 돈 / 나중에 더 드는 돈 /
   *   차에 딸려 오는 것)는 **내가 지어낸 이름**이었다. 뜻은 맞았는데 «구역 이름»이 손님에게
   *   낯선 말이 됐다 — 손님은 「나중에 더 드는 돈」이라는 칸을 찾지 않는다. 사장님이 부르신
   *   여섯 이름이 이 장사에서 실제로 쓰는 말이다. 그 이름을 쓴다.
   * ★내용은 안 버렸다 — 흩어졌던 값들이 여섯 구역에 «전부» 들어간다(아래 표).
   *
   * ★★**섹션마다 얼굴이 다르다.** 자료의 성격이 배열을 정한다(꾸미려고 다르게 하는 게 아니다).
   *     ② 차량 정보 → 이름 한 줄(넓게) + 값 **타일 격자**
   *     ③ 대여료    → **브랜드 면** 위 큰 숫자 + **표** + 납부 타일   ← 이 화면에서 유일한 색 면
   *     ④ 보험      → 큰 값 하나 + **두 칸 정의 목록**(라벨 왼쪽 · 값 오른쪽)
   *     ⑤ 이용 조건 → 큰 값 하나 + 타일 격자
   *     ⑥ 기타      → 제일 조용한 **흐린 한 줄**
   */

  const age = (v: string) => v.replace(/\s*(이상|이하|까지|부터)\s*$/, '').replace(/^만\s*/, '만 ').trim();

  /** ③ 대여료 — 요금·보증금 다음에 「그 돈을 어떻게 내나」가 붙는다. */
  const payRows = rows([
    ['보증금 분납', S('deposit_installment')],
    ['보증금 카드', S('deposit_card_payment')],
    ['대여료 카드', S('rental_card_payment')],
    ['납부 방법', join(S('payment_method'), S('payment_timing') && S('payment_timing') !== S('payment_method') ? S('payment_timing') : '')],
  ]);

  /*
   * ⚠⚠ **「낮출 수 있는 나이」와 「낮출 수 없다」를 가려야 한다**(2026-09-05 화면에서 잡았다).
   *   `driver_age_lowering` 은 나이(「만21세」)가 올 때도 있고 **「불가」·「협의」**가 올 때도 있다
   *   — 실측 61대(불가 59 · 협의 2). 안 가리고 아래 끝으로 쓰니 테슬라 모델3 화면에
   *   **「운전 가능 연령 불가 ~ 만 70세」**가 떴다. 숫자가 든 값만 나이로 본다.
   */
  const isAgeValue = (v: string) => /\d/.test(v);
  const lowered = isAgeValue(S('driver_age_lowering')) ? S('driver_age_lowering') : '';

  /**
   * ④ 보험 — **면책금이 먼저, 보장은 그다음**(사장님 2026-09-05).
   *
   * > 「보험은 … 거기에 **면책금과, 대인 대물 자손 요기에 대한 면책금과 자차 면책금을 따로**
   * >  표시해 줘야 될 거 같애. 그리고 밑에는 **보장 사항**을 쭉 주면 될 거 같고,
   * >  **수리비 부담은 자차 면책금에 포함**이 되는 거고, 그 보험 **맨 밑에 긴급 출동 연 오 회** 표시해 주면 되고.」
   *
   * ★손님 지갑에서 실제로 돈이 나가는 건 **면책금**이다. 보장 한도(대인 무한·대물 1억)는
   *   «얼마까지 보상해 주나»라 손님이 낼 돈이 아니다. 그래서 면책금이 위, 보장이 아래다.
   * ★**자차 면책금이 제일 크다** — 사고 한 번에 50~100만원이 나간다. 그것만 큰 값으로 세운다.
   *   수리비 부담(20%)은 그 값에 딸린 조건이라 같은 줄에 붙인다.
   * ★대인·대물·자손 면책금은 셋이 나란한 값이라 한 묶음으로 흐른다.
   */
  /**
   * 자차 면책금 — **「수리비 ○○% · 최소 얼마 ~ 최대 얼마」** 한 줄로 쓴다
   * (사장님 2026-09-05 「자차 면책금은 **수리비 땡땡 프로, 최소 얼마에서 최대 얼마** 표현해 줘야 되고」).
   *
   * ★셋이 «따로 노는 값»이 아니라 **한 값의 세 조각**이다 — 사고가 나면 수리비의 20%를 물되,
   *   그 금액이 50만원 밑으로는 안 내려가고 100만원 위로는 안 올라간다. 그게 이 칸의 뜻이다.
   *   떼어 놓으면 손님이 「20%」와 「50~100만원」을 **다른 조건 둘**로 읽는다.
   */
  const ownDamageDeductible = [
    meaningful(S('own_damage_repair_ratio')) ? `수리비 ${S('own_damage_repair_ratio')}` : '',
    S('own_damage_min_deductible') && S('own_damage_max_deductible')
      ? `최소 ${S('own_damage_min_deductible')} ~ 최대 ${S('own_damage_max_deductible')}`
      : (S('own_damage_min_deductible') ? `최소 ${S('own_damage_min_deductible')}` : ''),
  ].filter(Boolean).join(' · ');

  /*
   * ★★★**보험 구역 안에서 넷은 성격이 다 다르다 — 위계를 달리 준다**(사장님 2026-09-05
   *   「**보험료 포함 여부와 보상 한도, 긴급출동, 자차 면책금** 여부 요기가 조금씩 다 그 **위계가
   *   달라야** 돼. 보험료 별도 이 부분은 그 보상 한도랑은 좀 **다른 영역**이니까 별도로 표시를 좀
   *   해줘야 될 거 같고, 긴급출동은 **보험은 아니긴 하지**」).
   *
   *   ① 보험료 포함 여부 — «이 대여료에 보험이 들었나». 돈의 크기를 바꾸는 **상품 조건**이지
   *      보장 내용이 아니다. 그래서 맨 위에 혼자 선다(면 위 큰 값).
   *   ② 보상 한도       — «어디까지 보상되나». 넷이 나란한 값이라 격자로 편다.
   *   ③ 면책금          — «사고 나면 내가 얼마 내나». 그중 **자차가 따로 논다**(금액이 크고
   *      수리비 부담이 딸린다) — 한 줄로 떼고, 대인·대물·자손은 그 밑에 흐리게.
   *   ④ 긴급출동        — **보험이 아니다.** 사고가 아니라 고장일 때 부르는 부가 서비스다.
   *      그래서 제일 아래에서 **여백으로 확실히 떨어뜨린다.**
   */
  /** ① 보험료 — 「포함」이냐 「별도」냐. 값 앞의 「보험료」는 라벨과 겹치므로 떼고 쓴다. */
  const insuranceFee = meaningful(S('insurance_included'))
    ? S('insurance_included').replace(/^보험료\s*/, '').trim()
    : '';
  /*
   * ★★★**보험 구역에서는 「없음」이 «값»이다** — 지워서는 안 된다(2026-09-05).
   *
   * 다른 칸에서는 「없음」을 뺀다(`meaningful`) — 색상·정비·대차에 「없음」이 뜨면 그건
   * «안 알려 준 것»에 가깝다. 그런데 **보험에서는 정반대**다:
   *   · 면책금 「없음」 = 사고 나도 **내 돈이 안 나간다**. 손님에게 제일 좋은 소식이다.
   *   · 보장 「없음」  = 그 항목은 **보상이 안 된다**. 손님이 반드시 알아야 할 구멍이다.
   * 둘 다 «모른다»가 아니라 «확정된 사실»이라 지우면 정보를 없애는 것이다.
   * ⇒ 이 구역만 「없음」을 남긴다. 「협의·미정·기타·-」는 여기서도 뺀다(그건 여전히 «안 정함»이다).
   */
  const insMeaningful = (v: string) => {
    const t = String(v ?? '').trim();
    return !!t && !['기타', '협의', '별도협의', '별도문의', '미정', '해당없음', '해당 없음', '-'].includes(t);
  };
  const insRows = (list: [string, string][]) => list.filter(([, v]) => insMeaningful(v));

  /** ② 보상 한도 — 어디까지 보상되나. */
  const coverage = insRows([
    ['대인', S('injury_compensation_limit')],
    ['대물', S('property_compensation_limit')],
    ['자기신체', S('self_body_accident')],
    ['자기차량', S('own_damage_compensation')],
    ['무보험차', S('uninsured_damage')],
  ]);
  /**
   * ③ 면책금 — **자차가 맨 앞**이고 나머지 셋이 뒤따른다.
   * ★자차도 «면책금»이라 **같은 줄 규칙(라벨 왼쪽 · 값 오른쪽)**을 쓴다
   *   (사장님 2026-09-05 「이것도 면책금이니까 **우측 정렬**을 해줘야지」).
   * ⚠ 한때 자차만 왼쪽 정렬 큰 줄로 떼어 놓았다 — 그러면 넷이 «다른 종류»로 보인다.
   *   갈라야 할 것은 «정렬»이 아니라 **무게**다. 자차는 같은 줄에서 굵게 선다.
   */
  /*
   * ★★★**면책금은 «두 줄»이다 — 자차 한 줄, 나머지 한 줄**(사장님 2026-09-05
   *   「그냥 자차 면책금이랑 **기타 면책금이라고 하긴 좀 그렇고** … 그냥 **면책금을 면책금이라고
   *   해 놓고**, 대인 대물 뭐 그 **있는 면책금은 그냥 「대인 얼마 대물 얼마」**, 뭐 **없는 거는 쓰지
   *   말고**. **자차는 다가 한 줄로 좀 길게** 이렇게 쓰는 게 나을 거 같아」).
   *
   * ⚠ 여기 라벨이 네 줄이었다 — 「자차 면책금 / 대인 면책금 / 대물 면책금 / 기타 면책금」.
   *   소제목이 이미 「면책금」인데 줄마다 «면책금»을 또 붙이니 같은 낱말이 다섯 번 나왔고,
   *   「기타」는 그 숫자가 무엇의 면책금인지 안 알려 주면서 칸만 차지했다.
   * ⇒ 소제목이 「면책금」이라고 말했으니 **줄에서는 이름만** 쓴다 — 「대인 30만원 · 대물 30만원」.
   * ★자차만 따로 한 줄인 이유 — 값이 셋(수리비·최소·최대)이라 남들 옆에 끼면 줄이 터진다.
   *   그리고 사고 나면 실제로 무는 돈이 이것이다.
   * ★**없는 것은 안 쓴다** — 「대인 없음」이 아니라 그냥 그 이름이 안 나온다.
   *   (단 값이 「없음」인 것은 «확정된 사실»이라 쓴다 — 아래 `insMeaningful`.)
   */
  const otherDeductibles = [
    ['대인', S('injury_deductible')] as [string, string],
    ['대물', S('property_deductible')] as [string, string],
    ['자손', S('self_body_deductible')] as [string, string],
    ['무보험', S('uninsured_deductible')] as [string, string],
  ].filter(([, v]) => insMeaningful(v)).map(([k, v]) => `${k} ${v}`).join(' · ');

  /** ④ 긴급출동 — 보험이 아니라 부가 서비스. */
  const roadside = S('annual_roadside_assistance') || S('roadside_assistance');

  /** ⑤ 이용 조건 — 「내가 탈 수 있나」. 심사도 여기다(요금이 아니라 «자격»이다). */
  const ageRange = S('basic_driver_age') && S('driver_age_upper_limit')
    ? `${age(lowered || S('basic_driver_age'))} ~ ${age(S('driver_age_upper_limit'))}`
    : age(S('basic_driver_age'));
  const creditRaw = creditDisplay(p);
  const credit = creditRaw && creditRaw !== CREDIT_UNSET ? creditRaw : '';
  const useRows = rows([
    /*
     * ★★**나이는 «둘»이다 — 기본 연령과 가능 구간**(사장님 2026-09-05
     *   「**기본 운전 연령**이 있고, 그게 **대여료 표의 기본 조건 26세**라는 거고,
     *   **운전 연령 구간**을 만들어 주고」).
     *   · 기본 운전 연령 = 위 대여료 표가 «그 나이 기준»으로 나온 값이다. 이게 바뀌면 요금이 바뀐다.
     *   · 운전 가능 연령 = 돈을 더 내면 어디까지 내려가고, 위로는 어디서 막히는가.
     *   둘을 한 값으로 뭉치면 「26세인데 왜 21세라고 써 있나」가 된다.
     * ⚠ 구간은 **큰 값에서 내렸다**(사장님 「몇 세부터 몇 세까지 **메인에 올라갈 필요가 없다**니까,
     *   그냥 밑에 그 하나의 항목으로 표기를 해주면 되고」). 나이는 이 구역에서 결정적인 하나가
     *   아니라 «확인하는 값 여럿» 중 하나다 — 심사·주행·면허와 같은 무게가 맞다.
     */
    ['기본 운전 연령', age(S('basic_driver_age'))],
    ['운전 가능 연령', ageRange],
    /*
     * ★★**심사는 계속 띄운다**(사장님 2026-09-05 「그 심사 조건은 계속 띄워요」).
     *   그전까지 손님 화면에 안 나갔다 — 값이 화이트리스트에 없어 오지도 않았다. 이번에 열었다.
     * ★자리는 **이용 조건**이다. 「내가 될까」를 묻는 칸이지 요금 칸이 아니다.
     *   ⚠ 요금 «밑»에는 안 쓴다 — 이 장사의 셀링포인트가 「무심사」인데 금액 옆에서 그 말을 꺼내면
     *     손님이 평생 들어 온 그 단어를 다시 만난다(§1-12 는 그대로다).
     */
    ['심사', credit],
    /*
     * ★★**「초과」가 아니라 「추가」다**(사장님 2026-09-05 「연간 약정 주행거리는
     *   **1만km 추가 시 10만원**이야. 그 표현을 명확하게 해줘야 돼」).
     *
     * ⚠ 내가 「초과 1만km당 10만원」이라고 썼는데 **뜻이 반대에 가깝다.**
     *   「초과」는 «약정을 넘겨서 무는 벌칙»으로 읽히고, 실제로는 «약정을 미리 올릴 때의 가산액»이다.
     *   손님이 겁먹을 이유가 없는 값을 겁나게 쓴 것이다.
     * ★정책 정본도 그렇게 적어 두었다 — `policy-tier` 「**1만km 상향 요금** ·
     *   약정 주행거리를 **올릴 때의 가산액**」. 필드 이름부터 `upcharge`(상향)다.
     * ★약정과 가산액은 «붙여서» 쓴다 — 떼면 무엇에 얼마가 붙는지 모른다.
     */
    ['약정 주행', join(S('annual_mileage'),
      /*
       * ★★**「1만km당」이다 — 한 번 붙는 값이 아니다**(사장님 2026-09-05
       *   「**1만km씩 추가할 수 있는 거야.** 1만km 추가, **1만km당** 10만원이 추가된다는 거지」).
       * ⚠ 「1만km 추가 ↑10만원」이라고 썼더니 «한 단만 올릴 수 있는 것»으로 읽힌다.
       *   실제로는 1만km씩 **되풀이해서** 올릴 수 있고, 그때마다 그 금액이 붙는다.
       * ★스키마도 그렇게 적혀 있다 — `entities` 「**추가주행 금액(1만km당)**」.
       */
      S('mileage_upcharge_per_10000km') ? `1만km당 ↑${S('mileage_upcharge_per_10000km')}` : '')],
    /*
     * ★**최대 주행거리** — 1만km씩 올리다가 «어디서 멈추나»(사장님 2026-09-05
     *   「최대 주행거리에 있는데 정책에다가 최대 주행거리를 안 넣어놨네. 그것도 넣을 수 있게끔」).
     *   여태 정책에 칸 자체가 없어서 아무 데도 안 적혔다 — 이번에 정책 원자에 냈다
     *   (`entities` · `policy-tier` · 정책 입력 화면 「운행 조건」 · 손님 화이트리스트).
     * ⚠ 값이 들어오기 전까지는 이 줄이 안 그려진다 — **지어내지 않는다.**
     */
    ['최대 주행', S('max_annual_mileage')],
    ['면허', S('license_period')],
    ['운전 범위', S('personal_driver_scope')],
    ['추가 운전자', join(S('additional_driver_allowance_count'), S('additional_driver_cost'))],
    /*
     * ★★**연령 낮추기는 «나이 + 얹히는 돈»이고, 못 낮추면 「불가」다**(사장님 2026-09-05
     *   「연령 낮추기는 **21세, 23세가 있으니까**, 아예 **불가하면 그냥 「연령 낮추기 불가」**.
     *   그리고 21세에 23세, 거기다가 **플러스 얼마**. 그 **플러스 아이콘은 다 동일하게** 써줄게」).
     *
     *   · 낮출 수 있으면 → 「만 21세 ↑10만원」 (차마다 21세인 곳도 23세인 곳도 있다)
     *   · 못 낮추면      → 「불가」  ← 이것도 «확정된 사실»이라 줄을 지우지 않는다
     * ⚠ 한때 목표 나이를 빼고 값만 썼다 — 「위 구간의 아래 끝이 말한다」는 내 판단이었는데,
     *   **낮추는 나이가 차마다 다르다.** 얼마를 내면 «몇 살까지» 내려가는지가 이 칸의 뜻이다.
     * ★화살표는 약정 주행 가산액과 **같은 것**을 쓴다 — 둘 다 「돈이 얹힌다」는 같은 말이다.
     */
    ['연령 낮추기', (() => {
      const raw = S('driver_age_lowering');
      if (!raw) return '';
      if (!lowered) return /불가/.test(raw) ? '불가' : '';
      const cost = S('age_lowering_cost');
      return meaningful(cost) ? `${age(lowered)} ↑${cost}` : age(lowered);
    })()],
  ]);

  /** ⑥ 기타 — 참고만 하는 값. 제일 조용하게 한 줄로 흘린다. */
  const pair = (label: string, v: string) => (meaningful(v) ? `${label} ${v}` : '');
  const etc = [
    pair('정비', S('maintenance_service')),
    pair('대차', S('replacement_car_policy')),
    pair('이용 지역', S('rental_region')),
    pair('차량 인도', S('delivery_fee')),
  ].filter(Boolean).join(' · ');

  const hasPolicy = !!(payRows.length || ownDamageDeductible || otherDeductibles || coverage.length || ageRange || useRows.length || etc || roadside);

  /*
   * ★★★**제목 밑 칩 줄** — 「이 차가 지금 어떤 물건인가」를 한눈에(사장님 2026-09-05
   *   「**출고 가능, 구분, 신차 렌트, 중고 렌트, 그리고 우대 조건** 같은 거는 **적절한 위치 공간에다가
   *   배열**을 해주면 좋을 거 같고」).
   *
   * ⚠ **출고상태와 상품구분은 상세에 아예 없었다.** 목록 카드는 보여 주는데 상세에서 사라져,
   *   손님이 카드에서 「출고가능·중고렌트」를 보고 들어오면 그 말이 없어졌다.
   *   실측 — 출고가능 492 · 출고협의 164 · 계약중 40 · 즉시출고 20 / 중고렌트 224 · 신차렌트 72 …
   * ★자리는 **차명·차번 바로 밑**이다. 「무엇인가」를 말하는 줄이라 이름 옆이 제자리다.
   * ★★**상자 뱃지가 아니라 아이콘 + 글자**다(사장님 2026-08-28·08-30 「박스 뱃지 쓰지 말고
   *   아이콘 텍스트로, **모든 곳에서**」 · 2026-09-05 「연한 배경으로 칩을 해주는 건 좋은데」).
   *   연한 면은 깔되 테두리는 두르지 않는다.
   * ★색은 **좋은 소식에만** — 출고가능·즉시출고·무심사 셋. 나머지는 회색이다.
   *   칩마다 색을 주면 그 순간 촌스러워진다(대여료 큰 줄과 같은 규칙).
   */
  const status = S2(p.vehicle_status);
  const kind = S2(p.product_type);
  const creditChip = creditDisplay(p);
  type Mark = { text: string; icon: LucideIcon; good?: boolean };
  /**
   * ① **차명 줄 오른쪽** — 「지금 살 수 있나 · 무슨 상품인가」.
   *   제목 옆이 비어 있어 거기로 올렸다(사장님 2026-09-05 「**차량번호 뒤에 현대 그랜저,
   *   그리고 우측 정렬로 출고가능·상품구분**을 하고」). 이름과 같은 줄에 서야 «이 차의 신원»으로 읽힌다.
   */
  const stateMarks: Mark[] = [
    ...(status ? [{ text: status, icon: CircleCheck, good: /출고가능|즉시출고/.test(status) }] : []),
    ...(kind ? [{ text: kind, icon: Tag }] : []),
  ];
  /**
   * ② **그 밑 한 줄** — 「내가 되나」. 심사와 우대조건은 «조건»이라 신원과 성격이 다르다
   *   (사장님 「그 밑에 심사 조건, 우대 조건 그런 것들을 쭉」).
   */
  const perkMarks: Mark[] = [
    ...(creditChip && creditChip !== CREDIT_UNSET
      ? [{ text: creditChip, icon: ShieldCheck, good: /무심사/.test(creditChip) }] : []),
    ...PERKS.filter((k) => hasPerk(p, k)).map((k) => ({ text: k as string, icon: Check })),
  ];

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
     * ★★★**대여료도 다른 구역과 «같은 짜임»이다** — 큰 값 하나만 강조하고 나머지는 흐른다
     *   (사장님 2026-09-05 「대여료도 **메인 대여료 하나 메인으로** 있고, 나머지 것들을 지금
     *   **박스로 다 가둬 놨잖아**. 어떤 주요 값을 쪼금 강조하는 느낌이라면 대여료도 그렇게 해야 된다」).
     *
     * ⚠ 여기 구역 «전체»가 연한 브랜드 카드였다. 걷었다. 그러면 대여료만 얼굴이 달라서,
     *   보험·이용 조건이 「큰 값 하나 + 흐르는 값」인데 대여료만 **상자에 통째로 갇힌** 꼴이 됐다.
     *   기간표도 납부도 뱃지도 다 그 상자 안이라, 정작 **주인공인 금액이 상자의 일부**로 읽혔다.
     * ⇒ 면은 **큰 금액 한 줄에만** 남긴다. 그 한 줄만 브랜드 색을 쓴다 —
     *   다른 구역의 큰 값(사고 시 내 부담·운전 가능 연령)은 회색 면, 여기만 채널색.
     *   **면이 한 줄로 줄어들수록 그 줄이 더 선다.**
     */
    /* 제목이 「대여료」만이면 보증금이 딸린 값처럼 보인다 — 둘 다 이 구역의 주인공이다(사장님 2026-09-05). */
    <Sec title="대여료 및 보증금" icon={Coins} accent mobile={mobile}>
      <>
      {plan ? (
        <>
          {/* 메인 — 이 화면에서 손님이 찾아온 답. 브랜드 면을 쓰는 유일한 줄이다. */}
          <div style={{
            display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 12, rowGap: 4,
            padding: mobile ? '16px' : '18px 20px',
            borderRadius: SHOP.r.card, background: C.brandSoft,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: SHOP.fs.sub, color: C.mute }}>월</span>
              <span style={{
                fontSize: mobile ? 32 : 34, fontWeight: FW.head, color: C.ink,
                letterSpacing: '-0.045em', fontVariantNumeric: 'tabular-nums',
              }}>{manWon(plan.rent)}</span>
            </div>
            {/*
              ★이 줄은 **큰 숫자의 닻**이다. 없애 보니 「월 15만원」이 «어느 기간인지 모르는 숫자»가 됐다
                — 바로 밑 표는 1개월부터 시작해서, 큰 숫자와 첫 줄을 붙여 읽으면 서로 안 맞는다.
            */}
            <div style={{ fontSize: SHOP.fs.body, color: C.sub, fontVariantNumeric: 'tabular-nums' }}>
              {/* 목록 카드와 같은 규칙 — 「보증금 없음」에만 색을 준다. */}
              <span style={{
                color: plan.deposit > 0 ? C.sub : C.ok,
                fontWeight: plan.deposit > 0 ? 400 : 700,
              }}>
                {plan.deposit > 0 ? `보증금 ${manWon(plan.deposit)}` : '보증금 없음'}
              </span> · {plan.m}개월 약정
            </div>
          </div>

          {/*
            ⚠⚠ **여기 있던 우대조건 뱃지 줄을 걷었다**(2026-09-05 저녁).
            사장님 「빼찌든 뭐든 **어떤 원자가 그 해당 섹션에 들어가야 되고 중복되면 안 되지.**
            밑에 **보증금 분납**이라는 거 있잖아. 그리고 우리가 **몇 회까지 분납이 되는지** 있으니까
            그런 것들 표현해 주고. **어정쩡한 데에 명분 없이 들어가지 마.** 꼭 있어야 될 자리에 있어야 되고.」

            세어 보니 뱃지 넷이 **전부** 아래 제자리와 같은 말을 하고 있었다 —
              분납가능  → 납부 「보증금 분납: 2회까지 / 가능」   ← 뱃지보다 **값이 더 많다**
              무보증    → 대여료 큰 줄 「보증금 없음」
              만21세    → 이용 조건 「운전 가능 연령 만 21세 ~ 만 70세」
              경력무관  → 이용 조건 「면허: 제한없음」
            뱃지는 «있다/없다»만 말하고, 제자리는 «얼마·몇 회·몇 살까지»를 말한다.
            둘을 같이 두면 손님이 같은 것을 두 번 읽고, 뱃지는 **덜 정확한 쪽**이다.
            ★그래서 뱃지를 지운 게 아니라 **값을 제자리에 둔 것**이다. 표시는 그대로 남아 있다.
            ⚠ 남은 하나 「무사고」는 제자리가 없지만 `accident_history` 실측이 **0%**라 어차피 안 뜬다.
              데이터가 오면 차량 정보에 자리를 준다 — 대여료 밑은 그 값의 자리가 아니다.
          */}
        </>
      ) : (
        <div style={{ fontSize: SHOP.fs.body, color: C.mute }}>요금은 담당자에게 문의해 주세요.</div>
      )}

      {/*
        ★★기간별 표는 **보조표다 — 접는 게 아니라 «메인 금액 밑에» 깐다**(사장님 2026-09-05).
        ★조사와도 같은 결론이다 — 열두 곳 중 **요금 구조를 접은 곳이 0곳**이었다.
        ★표가 곧 고르개다 — 줄을 누르면 위 큰 숫자가 그 기간으로 바뀐다.
        ★★넓은 화면에서 **표를 늘리지 않는다**(폭 520). 세 칸짜리 표를 880px 로 늘리면
          기간과 금액 사이가 손가락 두 뼘이 되어, 같은 줄인데 눈이 못 잇는다.
      */}
      {/*
        ★★웹에서는 **기간표와 납부를 나란히** 놓는다(2026-09-05 웹 화면을 재 보고 넣었다).
          표는 세 칸이라 520 에서 끊는데(늘리면 기간과 금액 사이가 손가락 두 뼘이 된다),
          내용 칸이 832 라 **오른쪽 310px 가 비었다.** 그 자리에 납부를 놓으면 공백이 메워지고
          「얼마」와 「어떻게 내나」가 한눈에 붙는다 — 돈 이야기를 한자리에서 끝낸다는 규칙과도 맞다.
        ★폰은 그대로 쌓는다 — 나란히 놓을 폭이 없다.
      */}
      <div style={{
        display: mobile ? 'block' : 'flex', gap: mobile ? 0 : 32, alignItems: 'flex-start',
      }}>
      {plans.length > 1 ? (
        <div style={{ marginTop: 22, flex: '0 0 auto', width: mobile ? undefined : 520 }}>
          <div style={{
            marginBottom: 8, fontSize: SHOP.fs.cap, fontWeight: 600, color: C.mute,
          }}>기간별 대여료 및 보증금</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr>
                {['기간', '월 대여료', '보증금'].map((h, i) => (
                  /*
                   * ★★기간표는 **보조 설명**이다(사장님 2026-09-05 「기간별 대여료는 보조 설명으로
                   *   대여료 섹션에 그 고유니까 **분위기 해치지 않게** 해주고」).
                   *   그래서 머리줄의 **밑선을 걷었다** — 이 화면은 선을 최소로 쓰는데, 표 머리에만
                   *   선이 하나 있으면 그 한 줄이 «표»를 선언해 버려서 구역이 갑자기 서류처럼 보인다.
                   *   라벨을 흐리게 두면 선 없이도 「여기부터 표」가 읽힌다.
                   */
                  <th key={h} scope="col" style={{
                    padding: '0 0 7px', textAlign: i === 0 ? 'left' : 'right',
                    fontSize: SHOP.fs.cap, fontWeight: 500, color: C.faint,
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
                   * ⚠ 줄에 `onClick` «만» 걸어 두면 **마우스로만 고를 수 있는 고르개**가 된다.
                   *   `<tr>` 은 탭으로 못 가고, 보조기기는 이게 누를 것인 줄도 모른다.
                   * ⇒ 첫 칸에 진짜 `<button>` 을 넣어 이름·역할·상태(`aria-pressed`)를 지게 한다.
                   */
                  <tr key={x.m} onClick={pick}
                    style={{ cursor: 'pointer', background: on ? C.zebra : 'transparent' }}>
                    <td style={{ padding: 0 }}>
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

      {payRows.length ? (
        <div style={{ marginTop: 22, flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 9, fontSize: SHOP.fs.cap, fontWeight: 600, color: C.mute }}>납부</div>
          <Facts rows={payRows} cols={2} mobile={mobile} />
        </div>
      ) : null}
      </div>
      </>
    </Sec>
  );

  return (
    <main style={{
      /*
       * 웹 1120 · 폰은 어차피 화면 폭이다.
       * ⚠ 한때 940 으로 줄였었다 — 「한 줄이 1,100px 로 뻗으면 눈이 줄 끝에서 다음 줄 머리를
       *   못 찾는다」는 이유였고, 그건 **제목까지 한 칸에 쌓던 때** 맞는 말이었다.
       * 2026-09-05 에 `Sec` 이 웹에서 **제목을 왼쪽 기둥(200)으로** 빼면서 값이 흐르는 칸은
       *   1120 − 48(여백) − 200 − 40(사이) ≒ **830** 이 된다 — 한 줄이 길어지지 않으면서
       *   가로로는 펴진다(사장님 2026-09-05 「가로로 이렇게 좀 펼쳐져서 보인다든가」).
       */
      maxWidth: mobile ? 940 : 1120, margin: '0 auto',
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
        ⇒ 순서를 하나로 못 박는다: **사진 → 차명 → 선택 옵션 → 기간별 대여료 → 차량정보 → 이용 조건.**
           웹은 그 순서를 «넓게» 그릴 뿐이다.
        ★대신 대여료 칸이 넓어진 만큼 안에서 가로로 편다(아래 `priceCard` 참고) —
          좁은 칸에서 세로로 쌓던 것을 그대로 늘리면 900px 짜리 빈 줄이 세 개 생긴다.
      */}
      {bar}
      {gallery}
      <Head title={title} facts={facts} stateMarks={stateMarks} perkMarks={perkMarks} />
      {/*
        ★★**차량 정보 = 「이 차가 무엇인가」 한 덩어리**.
          제조사·세부모델·세부트림 한 줄 → 연식·주행거리·배기량·연료 → 색상·정원·최초등록.
        선택 옵션은 이 구역이 아니라 차명 바로 아래에서 먼저 읽는다.
      */}
      {(modelLine || specs.length || options.length) ? (
        <Sec title="차량 정보" icon={Car} mobile={mobile}>
          <>

            {/*
             * ★맨 윗줄은 «이 차의 이름»이다 — 상자를 두르지 않고 **한 단 큰 글자**로 세운다.
             *   상자에 넣으면 아래 값들과 같은 «칸»이 되어, 이름인지 값인지가 안 갈린다.
             */}
            {modelLine ? (
              <div style={{ marginBottom: options.length ? 14 : 20 }}>
                <div style={{ fontSize: SHOP.fs.cap, color: C.faint, marginBottom: 5 }}>제조사 · 세부모델 · 세부트림</div>
                <div style={{
                  fontSize: mobile ? 17 : 18, fontWeight: 800, color: C.ink,
                  letterSpacing: '-0.02em', wordBreak: 'keep-all', lineHeight: 1.4,
                }}>{modelLine}</div>
              </div>
            ) : null}

            {/*
             * ★★**선택 옵션은 차명 «바로 다음»**이다(사장님 2026-09-05
             *   「차명 밑에 선택 옵션을 넣으라는 거는 그 **차량 정보 섹션** 차명 들어가고 선택 옵션
             *   들어가는 거야. 그 위에 요약표에 들어가는 그 밑에를 말하는 게 아니라」).
             * ⚠ 한때 화면 맨 위 사실줄 밑에 놓았다가 여기로 옮겼다 — 옵션은 «그 차가 무엇인가»의
             *   일부라 차 설명 안에 있어야지, 요약줄에 붙으면 훑는 줄이 길어지기만 한다.
             * ★칩은 «낱말»이라 상자가 아니다 — 낱개로 세는 값이라 칩이 제 모양이다.
             */}
            {options.length ? (
              <div aria-label="선택 옵션" style={{ marginBottom: specs.length ? 20 : 0 }}>
                <div style={{ marginBottom: 8, fontSize: SHOP.fs.cap, color: C.faint }}>선택 옵션</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {options.map((o) => (
                    <span key={o} style={{
                      padding: '7px 12px', borderRadius: SHOP.r.chip, background: C.zebra,
                      fontSize: SHOP.fs.sub, color: C.sub,
                    }}>{o}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {specs.length ? <Facts rows={specs} cols={mobile ? 2 : 3} mobile={mobile} /> : null}
          </>
        </Sec>
      ) : null}

      {/* ③ 대여료 — 이 화면에서 «색 면»을 쓰는 유일한 구역이다(구역 띠는 `Sec` 이 그린다). */}
      {priceCard}

      {/*
        ④ 보험 — **한도가 메인, 면책금은 그 밑**(사장님 2026-09-05
           「보험은 **한도를 메인에 하고 그 밑에 면책금**에 대한 거를 써야겠다」).
             보장 한도 → 면책금 → 긴급출동.
        ⚠ 잠깐 반대로 세웠었다(면책금 위). 「손님이 내는 돈이 먼저」라는 내 판단이었는데,
          손님이 이 구역에서 먼저 확인하는 것은 **「이 차가 어디까지 보장되나」**다.
          면책금은 그 보장을 «쓸 때» 따라오는 조건이라 뒤에 온다.
        ★자차 면책금은 면책금 묶음의 맨 앞이고, **수리비 부담은 그 칸 안에** 붙는다
          (사장님 「수리비 부담은 자차 면책금에 포함이 되는 거고」).
      */}
      {/*
          ① 보험료 포함 여부는 **제목 옆**에 붙는다(사장님 2026-09-05 「보험 타이틀 옆에다가
             표시를 해주는 것이 직관적일 거 같애」). 값이 「포함/별도」 둘뿐이라 큰 줄을 통째로
             쓰면 «읽을 것»만 하나 더 생긴다 — 제목 옆이면 구역을 보는 순간 같이 읽힌다.
          ⚠ 여기 큰 줄(BigRow)로 세웠다가 옮겼다. 보장 한도와 «다른 영역»이라는 판단은 그대로다 —
             다른 영역이니까 격자에 안 섞고, 그렇다고 본문에 또 한 줄을 쓰지도 않는다.
      */}
      {(insuranceFee || ownDamageDeductible || otherDeductibles || coverage.length || roadside) ? (
        <Sec title="보험" icon={ShieldCheck} tag={insuranceFee} mobile={mobile}>
          <>
            {/* ② 보상 한도 — 어디까지 보상되나. 넷이 나란한 값이라 격자로 편다. */}
            {coverage.length ? (
              <div>
                <div style={{ marginBottom: 9, fontSize: SHOP.fs.cap, fontWeight: 600, color: C.mute }}>보상 한도</div>
                <Facts rows={coverage} cols={mobile ? 2 : 3} mobile={mobile} />
              </div>
            ) : null}

            {/*
              ③ 면책금 — 사고 나면 «내가» 내는 돈. 그중 **자차가 따로 논다** —
                 금액이 제일 크고 수리비 부담이 딸려 있다(사장님 「자차 면책금하고는 더 분리를」).
                 그래서 자차는 한 줄로 떼고, 대인·대물·자손은 그 밑에 흐리게 흘린다.
            */}
            {(ownDamageDeductible || otherDeductibles) ? (
              <div style={{ marginTop: 22 }}>
                <div style={{ marginBottom: 9, fontSize: SHOP.fs.cap, fontWeight: 600, color: C.mute }}>면책금</div>
                {/* 자차 — 값이 셋이라 한 줄을 통째로 쓴다. 사고 나면 실제로 무는 돈이라 굵다. */}
                {ownDamageDeductible ? (
                  <div style={{
                    display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
                    marginBottom: otherDeductibles ? 8 : 0,
                  }}>
                    <span style={{ flex: '0 0 auto', fontSize: SHOP.fs.sub, color: C.faint }}>자차</span>
                    <span style={{
                      flex: 1, minWidth: 0,
                      fontSize: SHOP.fs.body, fontWeight: 800, color: C.ink,
                      fontVariantNumeric: 'tabular-nums', wordBreak: 'keep-all', lineHeight: 1.5,
                    }}>{ownDamageDeductible}</span>
                  </div>
                ) : null}
                {/* 나머지 — 있는 것만, 이름과 값을 이어서 한 줄로. */}
                {otherDeductibles ? (
                  <div style={{
                    fontSize: SHOP.fs.sub, color: C.sub,
                    fontVariantNumeric: 'tabular-nums', lineHeight: 1.7,
                  }}>{otherDeductibles}</div>
                ) : null}
              </div>
            ) : null}

            {/*
              ④ 긴급출동 — **보험이 아니다**(사장님 「긴급출동은 보험은 아니긴 하지」).
                 사고가 아니라 «고장»일 때 부르는 부가 서비스다. 그래서 여백으로 확실히 떨어뜨리고
                 제일 흐리게 둔다 — 위 셋과 같은 무게로 붙여 놓으면 보장의 하나로 읽힌다.
            */}
            {roadside ? (
              <div style={{ marginTop: 30, fontSize: SHOP.fs.sub, color: C.faint }}>
                긴급출동 {roadside}
              </div>
            ) : null}
          </>
        </Sec>
      ) : null}

      {/*
        ⑤ 이용 조건 — 「내 나이로 되나」가 결정적이라 그것만 크게. 주행거리·면허·운전 범위가 뒤따른다.
           ★약정주행과 초과료는 한 칸에 붙여 쓴다 — 떼면 어느 선을 넘어야 무는지 모른다.
      */}
      {/*
        ⚠ 여기 「운전 가능 연령」이 **큰 값 한 줄**로 서 있었다. 내렸다(사장님 2026-09-05
          「몇 세부터 몇 세까지 **메인에 올라갈 필요가 없다**니까, 그냥 밑에 그 하나의 항목으로」).
          이 구역에는 결정적인 하나가 없다 — 심사·나이·주행·면허가 «다 같이 확인하는 값»이다.
          하나만 크게 세우면 나머지가 곁다리로 보인다.
      */}
      <Tiles title="이용 조건" rows={useRows} cols={mobile ? 2 : 4} mobile={mobile} icon={IdCard} />

      {/* ⑥ 기타 — 참고만 하는 값. 제일 조용하게 한 줄로 흘린다. */}
      {etc ? (
        <Sec title="기타 사항" icon={Info} mobile={mobile}>
          <div style={{ fontSize: SHOP.fs.sub, color: C.mute, lineHeight: 1.9 }}>{etc}</div>
        </Sec>
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
      {/*
        ★★**누를 것처럼 보이게 한다**(사장님 2026-09-05 「**공유 버튼이 좀 있어야** 할 거 같고」).
          여기 둘은 배경도 테두리도 없는 «맨 글자»여서, 화면 오른쪽 위 여백에 놓인 장식처럼 보였다.
        ★**공유는 이 사업의 퍼널**이다 — 저신용 렌트는 배우자·부모와 상의해서 정한다.
          안 눌리면 손님이 화면을 «찍어» 보내고 그 순간 담당자 귀속이 끊긴다.
          그 버튼이 안 보이는 것은 기능 하나가 아니라 매출이 새는 것이다.
        ★연한 테두리만 두른다 — 파랗게 칠하면 「전화」와 다툰다. 주요 실행은 전화 하나뿐이다.
      */}
      <button type="button" onClick={toggleFav} className="fp-shop-press"
        aria-pressed={faved} aria-label={faved ? '관심 차량에서 빼기' : '관심 차량으로 담기'}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 40, height: 40, borderRadius: 999,
          border: `1px solid ${faved ? C.danger : C.line}`, background: C.bg,
          cursor: 'pointer', color: faved ? C.danger : C.sub,
        }}>
        <Heart size={ICON.lg} aria-hidden fill={faved ? 'currentColor' : 'none'} />
      </button>
      <button type="button" onClick={share} className="fp-shop-press" aria-label="이 차량 공유하기"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 40, padding: '0 14px', borderRadius: 999,
          border: `1px solid ${copied ? C.ok : C.line}`, background: C.bg,
          cursor: 'pointer', color: copied ? C.ok : C.sub, fontSize: SHOP.fs.sub, fontWeight: 600,
        }}>
        {copied ? <Check size={ICON.lg} aria-hidden /> : <Share2 size={ICON.lg} aria-hidden />}
        {copied ? '복사했습니다' : '공유'}
      </button>
    </div>
  );
}

/**
 * **구역 껍데기** — 띠 + 제목 + 내용.
 *
 * ★★웹에서는 **제목을 왼쪽 기둥으로 빼고 내용을 오른쪽에 편다**(사장님 2026-09-05
 *   「웹 화면도 좀 디자인이 정갈하게, 모바일에서 보던 거 어색하지 않게끔 **가로로 펼쳐져서**
 *   보인다든가 그랬으면 좋겠는데」).
 *
 * 무엇이 문제였나. 웹이 **폰을 그대로 늘려 놓은 꼴**이었다 — 제목 한 줄, 값 한 덩어리, 또 제목…
 * 940px 를 세로로만 쓰니 왼쪽은 늘 제목 몇 글자뿐이고 오른쪽은 비었다.
 * ⇒ 제목이 왼쪽 기둥(200)에 서고 값이 오른쪽(나머지)에 흐르면, 눈이 **왼쪽으로 구역을 세고
 *   오른쪽으로 값을 읽는다.** 같은 순서인데 화면이 가로로 펴진다.
 * ★폰은 그대로 쌓는다 — 390px 에 기둥을 세우면 값 칸이 200px 밖에 안 남는다.
 * ⚠ 순서는 안 바뀐다. 사장님이 정하신 여섯 구역이 위에서 아래로 그대로다 —
 *   **한 구역 «안»에서만 가로로 편다.**
 */
function Sec({ title, icon, accent, tag, mobile, children }: {
  title: string; icon?: LucideIcon; accent?: boolean; tag?: string;
  mobile?: boolean; children: React.ReactNode;
}) {
  return (
    <>
      <Rule mobile={mobile} />
      <section aria-label={title} style={mobile ? undefined : {
        display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)',
        columnGap: 40, alignItems: 'start',
      }}>
        <SecTitle icon={icon} accent={accent} tag={tag}>{title}</SecTitle>
        <div style={{ minWidth: 0 }}>{children}</div>
      </section>
    </>
  );
}

/**
 * **흐르는 값 격자** — 라벨 위 · 값 아래. **칸마다 상자를 두르지 않는다.**
 *
 * ⚠⚠ 여기 값마다 «연한 면»을 깔았었다. 걷었다(사장님 2026-09-05
 *   「너무 막 이렇게 **표박스화 하지 말고**, 전체적으로 쓱 봐서 잘 **어우러지게** 해야 돼 정보들이」).
 *   상자가 열 몇 개 깔리면 값 하나하나가 «칸»으로 갈려서, 눈이 훑는 게 아니라 **세게** 된다.
 *   그러면 구역 하나가 표가 되고, 표가 여섯이면 화면 전체가 창살이다.
 * ★대신 **간격과 글자 무게**가 가른다 — 라벨은 작고 흐리게, 값은 굵게, 줄 사이는 넉넉히.
 *   면이 하나도 없어도 「라벨 / 값」 짝은 눈에 저절로 묶인다.
 * ★★면은 **한 군데만** — 대여료의 큰 금액 한 줄이다.
 *   면이 드물어야 그 면이 «중요하다»는 뜻을 갖는다.
 */
/**
 * ★값 안에 **`↑`** 를 넣어 두면 그 자리에 **더하기(＋) 아이콘**이 선다.
 *   쓰는 곳은 둘 — 약정 주행의 가산액(「1만km당 **+10만원**」)과
 *   연령 낮추기(「만 21세 **+10만원**」). 둘 다 「이 돈이 **얹힌다**」는 같은 말이라 같은 표시다.
 *
 * ★★**화살표가 아니라 더하기다**(사장님 2026-09-05 「**금액이 더해지는 거면 플러스를 쓰는 게**
 *   맞을 거 같아」). 맞다 — 화살표는 «값이 오른다»는 방향이고, 이건 «이만큼을 더 낸다»는 셈이다.
 *   1만km를 두 단 올리면 +10만원이 두 번 붙는다. 그 뜻은 더하기가 정확히 말한다.
 * ⚠ **글자 「+」를 값에 그냥 쓰지 않는다.** 「10만원+」은 «10만원 이상»으로 읽히고,
 *   더 나쁘게는 데이터에 이미 「본인+직계가족」처럼 «+»가 들어 있다 — 그걸 아이콘으로 바꿔 버린다.
 *   그래서 자리표는 데이터에 안 나오는 `↑` 를 쓰고, 그 자리에 아이콘을 꽂는다.
 * ★★**자리는 «금액» 앞이다.** 줄 맨 앞에 두면 「연 20,000km」까지 더해지는 것처럼 보인다 —
 *   더해지는 건 약정이 아니라 **가산액**이다. 그래서 값을 만드는 쪽이 자리를 정한다.
 * ⚠ 색을 주지 않는다 — 더 내는 돈이라고 빨강을 쓰면 겁주는 화면이 된다.
 *   이건 벌칙이 아니라 «더 타고 싶을 때의 값»이다.
 */
function Facts({ rows, cols, mobile }: {
  rows: [string, string][]; cols: number; mobile?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      columnGap: mobile ? 16 : 24, rowGap: mobile ? 18 : 22,
    }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <div style={{
            fontSize: SHOP.fs.cap, color: C.faint, marginBottom: 5, letterSpacing: '0.01em',
          }}>{k}</div>
          <div style={{
            fontSize: SHOP.fs.body, fontWeight: 700, color: C.ink,
            wordBreak: 'keep-all', lineHeight: 1.45,
          }}>
            {v.split('↑').map((piece, i) => (
              <span key={i}>
                {i > 0 ? (
                  <Plus size={13} aria-hidden style={{
                    display: 'inline', verticalAlign: '-1px', marginRight: 1, color: C.mute,
                  }} />
                ) : null}
                {piece}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * **정의 목록** — 라벨 왼쪽 · 값 오른쪽. 보험 구역만 이 얼굴을 쓴다.
 *
 * 왜 여기만 다른가(사장님 2026-09-05 「각 섹션마다 좀 디자인을 해서」).
 * 보장 한도는 **하나씩 확인하는 값이 아니라 «읽어 내려가는» 값**이다 — 대인·대물·자기신체를
 * 견주지 않고 위에서 아래로 훑는다. 타일 격자로 놓으면 여섯이 같은 무게가 되어
 * 바로 위 「사고 시 내 부담」이 묻힌다.
 * ★선을 긋지 않는다 — 줄 간격과 라벨 색만으로 갈린다(구분선은 이 화면에서 최소로 쓴다).
 * ★폰에서는 한 칸, 웹에서는 두 칸으로 흘린다 — 여섯 줄을 900px 에 한 칸으로 세우면
 *   오른쪽이 통째로 빈다.
 */
function DefList({ rows, mobile, strongFirst }: {
  rows: [string, string][]; mobile?: boolean;
  /** 첫 줄만 굵게 — 같은 종류인데 «하나가 더 큰» 값일 때(면책금의 자차). 정렬은 그대로다. */
  strongFirst?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <div style={{
      marginTop: 14,
      display: 'grid', columnGap: 28, rowGap: 0,
      gridTemplateColumns: mobile ? '1fr' : '1fr 1fr',
    }}>
      {rows.map(([k, v], i) => {
        const strong = !!strongFirst && i === 0;
        return (
          <div key={k} style={{
            display: 'flex', alignItems: 'baseline', gap: 12,
            padding: strong ? '9px 0 12px' : '9px 0', minWidth: 0,
          }}>
            <span style={{
              flex: '0 0 auto', minWidth: 72,
              fontSize: SHOP.fs.sub, color: strong ? C.mute : C.faint,
            }}>{k}</span>
            <span style={{
              flex: 1, minWidth: 0, textAlign: 'right',
              fontSize: strong ? SHOP.fs.body : SHOP.fs.sub,
              fontWeight: strong ? 800 : 600, color: C.ink,
              wordBreak: 'keep-all', lineHeight: 1.5,
            }}>{v}</span>
          </div>
        );
      })}
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
/*
 * ⚠ 여기 `lead`(큰 값 한 줄)가 있었다. **걷었다**(2026-09-05) — 쓰는 구역이 하나도 안 남았다.
 *   나이는 「메인에 올라갈 필요가 없다」 하셔서 칸으로 내렸고, 보증금·면책금도 각자 자리를 찾았다.
 *   ★이 화면에서 «면 위 큰 값»은 **대여료 한 줄뿐**이다. 그래야 그 줄이 선다.
 */
function Tiles({ title, rows, cols, mobile, icon }: {
  title: string; rows: [string, string][]; cols: number; mobile?: boolean; icon?: LucideIcon;
}) {
  if (!rows.length) return null;
  return (
    <Sec title={title} icon={icon} mobile={mobile}>
      <Facts rows={rows} cols={cols} mobile={mobile} />
    </Sec>
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
function SecTitle({ children, icon: Icon, accent, tag }: {
  children: React.ReactNode; icon?: LucideIcon; accent?: boolean;
  /**
   * **제목 옆 표시** — 그 구역 전체를 한마디로 규정하는 «켜짐/꺼짐»짜리 값.
   *
   * 지금 쓰는 곳은 보험의 「포함 / 별도」 하나다(사장님 2026-09-05 「보험료 포함 별도로,
   * 어 그냥 이거 다 단순히 그거 하는 거라서 그 **보험 타이틀 옆에다가 표시를 해주는 것**이
   * 직관적일 거 같애」).
   * ★맞다 — 값이 둘뿐인 것에 큰 줄 하나를 통째로 쓰면 «읽을 것»이 하나 더 생긴다.
   *   제목 옆에 붙으면 구역을 보는 순간 같이 읽힌다.
   * ⚠ 여기에 «값»을 넣지 마라. 「50만원」처럼 읽어야 아는 숫자는 본문의 자리다.
   *   제목 옆은 **한 낱말**만 선다.
   */
  tag?: string;
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
      {tag ? (
        <span style={{
          /* 「포함」은 손님에게 좋은 소식이라 색을 준다 — 목록의 「보증금 없음」과 같은 규칙이다. */
          marginLeft: 2, padding: '3px 9px', borderRadius: 999,
          background: /포함/.test(tag) ? C.okBg : C.zebra,
          color: /포함/.test(tag) ? C.ok : C.mute,
          fontSize: SHOP.fs.cap, fontWeight: 700, letterSpacing: '-0.01em',
        }}>{tag}</span>
      ) : null}
    </h2>
  );
}

function Head({ title, facts, stateMarks, perkMarks }: {
  title: string; facts: string;
  /** 차명 줄 «오른쪽» — 출고상태 · 상품구분. 이 차의 «신원»이라 이름과 같은 줄에 선다. */
  stateMarks: { text: string; icon: LucideIcon; good?: boolean }[];
  /** 그 밑 한 줄 — 심사 · 우대조건. 「내가 되나」라 신원과 성격이 다르다. */
  perkMarks: { text: string; icon: LucideIcon; good?: boolean }[];
}) {
  /*
   * ★★**상자 뱃지가 아니라 아이콘 + 글자**다(사장님 2026-08-28·08-30 「박스 뱃지 쓰지 말고
   *   아이콘 텍스트로, **모든 곳에서**」 · 2026-09-05 「연한 배경으로 칩을 해주는 건 좋은데」).
   *   연한 면은 깔되 **테두리는 두르지 않는다** — 테두리가 붙는 순간 그게 상자 뱃지다.
   * ★색은 **좋은 소식에만**(출고가능·즉시출고·무심사). 칩마다 색을 주면 그때부터 소란이다.
   */
  /**
   * **신원 칩** — 출고상태 · 상품구분. 「이 차가 지금 어떤 물건인가」를 **통보**하는 값이다.
   * 연한 «면» 위에 작은 글자로 얹는다 — 사실 표시라 조용해야 하고, 면이 있으면 이름 옆에서
   * «딱지»처럼 붙어 읽힌다.
   */
  const stateChip = (m: { text: string; icon: LucideIcon; good?: boolean }) => (
    <span key={m.text} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '5px 10px', borderRadius: SHOP.r.chip,
      background: m.good ? C.okBg : C.zebra,
      color: m.good ? C.ok : C.mute,
      fontSize: SHOP.fs.cap, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      <m.icon size={13} aria-hidden />{m.text}
    </span>
  );

  /**
   * **조건 칩** — 심사 · 우대조건. 「**내가 되나**」의 답이라 성격이 아주 다르다
   * (사장님 2026-09-05 「위에 배지하고 아래 배지하고 **성격이 다르니까 그걸 좀 차이 나게끔**」).
   *
   * ★그래서 **면을 안 깐다 — 아이콘 + 글자만**이다(집 규칙 그대로: 「박스 뱃지 쓰지 말고
   *   아이콘 텍스트로」). 면이 없으면 상태 딱지와 한눈에 갈리고, 글자를 진하게 세울 수 있어
   *   **오히려 더 또렷하다** — 회색 면에 회색 글자로 눕히면 셀링포인트가 딱지로 보인다.
   * ★저신용 손님이 이 화면에서 제일 먼저 재는 값이다. 조용해선 안 된다.
   * ★아이콘만 색을 갖는다(무심사는 초록, 나머지는 채널색). 글자는 검정이라 소란하지 않다.
   * ★사이를 넉넉히 벌린다 — 붙여 놓으면 다시 «칩 줄»로 보인다.
   */
  const perkChip = (m: { text: string; icon: LucideIcon; good?: boolean }) => (
    <span key={m.text} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      color: C.ink, fontSize: SHOP.fs.sub, fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      <m.icon size={15} aria-hidden style={{ color: m.good ? C.ok : C.brand }} />{m.text}
    </span>
  );

  return (
    <header style={{ paddingTop: 18 }}>
      {/*
        ★★**차명 줄 오른쪽에 출고상태·상품구분**(사장님 2026-09-05 「차량번호 뒤에 현대 그랜저,
          그리고 **우측 정렬로 출고가능·상품구분**을 하고, 그 밑에 심사 조건·우대 조건을 쭉」).
          제목 오른쪽이 늘 비어 있었다 — 이름이 짧으니 웹에서 700px 넘게 남았다.
          그 자리에 **이 차의 신원**(살 수 있나 · 무슨 상품인가)이 서면 이름과 함께 한 번에 읽힌다.
        ★조건 칩(심사·우대)은 **밑줄로 내린다** — 신원이 아니라 「내가 되나」라 성격이 다르다.
        ⚠ 이름이 길면 칩이 아래로 접힌다(`flexWrap`) — 겹쳐서 잘리지 않는다.
      */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap',
      }}>
        <h1 style={{
          margin: 0, fontSize: 22, fontWeight: FW.head, color: C.ink,
          lineHeight: 1.3, letterSpacing: '-0.03em', minWidth: 0,
        }}>{title}</h1>
        {stateMarks.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
            {stateMarks.map(stateChip)}
          </div>
        ) : null}
      </div>
      {facts ? (
        <div style={{ marginTop: 8, fontSize: SHOP.fs.body, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>
          {facts}
        </div>
      ) : null}
      {perkMarks.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 8, marginTop: 12 }}>
          {perkMarks.map(perkChip)}
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

  /** 썸네일을 누르면 그 장으로 간다 — 화살표를 여러 번 누르지 않아도 된다. */
  const goTo = (k: number) => {
    const el = railRef.current;
    if (!el) return;
    setI(k);
    el.scrollTo({ left: k * el.clientWidth, behavior: 'smooth' });
  };

  const stage = (
    <div style={{
      position: 'relative', flex: 1, minWidth: 0, aspectRatio: '4 / 3', overflow: 'hidden',
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

  /*
   * ★★**웹에서는 사진 «옆»에 썸네일 줄을 세운다**(2026-09-05 웹 화면을 재 보고 넣었다).
   *
   * 무엇이 문제였나. 높이를 520 에서 끊었더니 4:3 비율 때문에 **사진 폭이 693 으로 줄었고**,
   * 본문 1120 중 **오른쪽 427px 가 통째로 비었다.** 사진 한 장이 왼쪽에 떠 있는 꼴이라
   * 화면이 «덜 만든 것»으로 보였다 — 사장님 「웹 화면이 조금 더 우려스러워」.
   * ⇒ 그 빈자리에 **남은 장들**을 놓는다. 공백이 메워지면서 «몇 장이 있다»가 한눈에 보이고,
   *   화살표를 아홉 번 누르지 않아도 원하는 장으로 바로 간다.
   * ★사진 «구역 안»에서만 가로로 펴는 것이라 순서를 안 건드린다 —
   *   대여료를 사진 옆에 두던 옛 2단과는 다른 것이다.
   * ★폰에는 안 그린다 — 밀어서 넘기는 게 이미 제일 빠르고, 좁은 화면에 썸네일을 넣으면
   *   정작 사진이 작아진다.
   */
  const thumbs = !mobile && n > 1 ? (
    <div style={{
      flex: '0 0 auto', width: 200,
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start',
    }}>
      {photos.slice(0, 8).map((src, k) => (
        <button key={src} type="button" onClick={() => goTo(k)} className="fp-shop-press"
          aria-label={`${k + 1}번째 사진 보기`} aria-pressed={k === i}
          style={{
            position: 'relative', padding: 0, aspectRatio: '4 / 3', overflow: 'hidden',
            borderRadius: 8, cursor: 'pointer', background: C.placeholder,
            /* 보고 있는 장만 테두리로 표시한다 — 색을 칠하면 사진 위에 색이 얹혀 지저분하다. */
            border: k === i ? `2px solid ${C.brand}` : `1px solid ${C.line2}`,
          }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 원본은 외부 도메인(프록시 경유)이다. */}
          <img src={src} alt="" decoding="async" loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          {/* 여덟째 칸에 남은 장 수 — 「더 있다」를 숫자로 말한다. */}
          {k === 7 && n > 8 ? (
            <span style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,.5)', color: '#fff',
              fontSize: SHOP.fs.sub, fontWeight: 700,
            }}>+{n - 8}</span>
          ) : null}
        </button>
      ))}
    </div>
  ) : null;

  if (!thumbs) return stage;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
      {stage}
      {thumbs}
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
