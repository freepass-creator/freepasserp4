/**
 * 가게(손님 동) 조건 — **화면이 아니라 여기가 정본**이다.
 *
 * 왜 떼어냈나. 2026-09-04 까지 손님 카탈로그는 ERP `/catalog` 페이지 «안의 분기»로 살았고,
 * 조건 상태·필터링·집계·주소가 전부 그 한 화면에 뭉쳐 있었다. 그래서 무엇을 고치든 업무동
 * 도구를 끌어다 쓰게 됐고, 실제로 **모수를 영업자 잣대(`isStockedProduct`)로 세다 축 셋을
 * 통째로 잃는** 사고가 났다(같은 날). 가게는 가게 잣대로 센다 — 그 잣대가 이 파일이다.
 *
 * ★★조건은 «주소에 실린다». B2C 판에서 이건 기능 하나가 아니라 **장사의 뼈대**다.
 *   영업자가 손님에게 보내는 것은 사이트 주소가 아니라 「이 조건으로 골라 둔 목록」이다.
 *   주소에 안 실리면 그 링크를 만들 수가 없고, 손님이 새로고침만 해도 조건이 날아간다.
 *   (`?a=` 담당자 귀속은 이미 주소로 다니고 있었다 — 조건만 빠져 있었던 것이다.)
 *
 * ★밴드 «정의»(금액·거리 구간)는 `product-filters` 를 그대로 쓴다. 구간의 뜻까지 갈라 두면
 *   영업자가 「50만↓」로 본 것과 손님이 「50만↓」로 본 것이 달라진다. 여기서 정하는 것은
 *   **무엇을 모수로 삼고 어떻게 세는가**뿐이다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { cheapest, creditDisplay, isListableProduct, isOperatedPeriod, priceList } from '@/lib/domain/product';
import { matchProductQuery } from '@/lib/domain/search';
import { firstProductImage } from '@/lib/domain/product-photos';
import {
  RENT_BANDS, DEP_BANDS, MILE_BANDS, CREDITS, CATALOG_PERKS, hasPerk, popularRank, type Band,
} from '@/lib/domain/product-filters';
import { fuelDisplay, makerDisplay, yearFullDisplay } from '@/lib/domain/vehicle-master-format';
import { canonProductType } from '@/lib/domain/product';
import { CUSTOMER_VEHICLE_CLASSES, customerVehicleClass } from '@/lib/domain/catalog-facets';

/** 고를 수 있는 축. 값은 주소 파라미터 이름이기도 하다 — 짧고 안 바뀌는 이름으로 둔다. */
/*
 * ★★**순서가 곧 손님이 좁혀 가는 차례다.**
 *   ① 무슨 차인가(차종 → 차급 → 제조사)  ② 얼마인가(기간 → 월 대여료 → 보증금)
 *   ③ 될까(심사)                        ④ 어떤 차인가(연식 · 주행 · 연료 · 혜택)
 * ★**기간이 월 대여료 «앞»이다** — 그 금액이 기간에 따라 달라지기 때문이다.
 *   뒤에 두면 「50만원대」를 고른 뒤에야 「어느 기간의 50만원인지」를 묻는 꼴이 된다.
 * ⚠ 새 축을 «끼워 넣을» 때 나머지 순서는 건드리지 않는다 — 손님은 자리로 기억한다.
 */
export const SHOP_AXES = ['vc', 'ptype', 'vclass', 'maker', 'term', 'rent', 'dep', 'credit', 'year', 'mile', 'fuel', 'perk'] as const;
export type ShopAxis = (typeof SHOP_AXES)[number];

/** 축 이름 — 조건칸 제목이자 「적용한 조건」 토큰의 앞머리. 한 곳에서만 적는다. */
export const AXIS_LABEL: Record<ShopAxis, string> = {
  vc: '차종', ptype: '상품구분', vclass: '차급', term: '계약기간', maker: '제조사', rent: '월 대여료', dep: '보증금',
  credit: '심사', year: '연식', mile: '주행거리', fuel: '연료', perk: '혜택',
};

/**
 * **계약기간 축** — 「이 기간으로 계약할 수 있는 차」.
 *
 * ★★왜 넣었나(2026-09-08 · 703대 실측) — 손님은 「월 얼마」로 고르는데 **그 금액이 기간마다 다르다.**
 *   그런데 손님 화면에는 기간을 고르는 자리가 아예 없었다. 게다가 데이터가 잘 갈린다:
 *   48개월 87% · 36개월 78% · 24개월 68% · 12개월 57% · **1개월 98대 · 6개월 43대**.
 *   ⇒ **단기(1·6개월)를 찾는 손님은 지금 그 차를 찾을 길이 없었다.**
 * ★값은 «데이터가 가진 것»만 세운다(`freeTally` 가 0건을 지운다) — 없는 기간을 세워 두지 않는다.
 * ⚠ 「인수형」·「연 3만km」 같은 **변형 키는 여기 안 든다.** 그건 같은 기간의 «다른 조건»이지
 *   기간 자체가 아니다 — 섞으면 「12개월」이 두 줄이 된다(`isStandardPeriod` 밖은 그대로 둔다).
 */
const TERM_LABEL = (m: number) => `${m}개월`;

/** 빠른필터 칩 하나 — 축 + 그 축의 값. 이름은 구간이 스스로 말한다(`soloLabel`). */
export type ShopQuickChip = { axis: ShopAxis; key: string; label?: string };

/**
 * **집 기본 빠른필터** — 채널이 제 것을 안 정하면 이게 선다.
 *
 * ★★**채널마다 다를 수 있다**(사장님 2026-09-08 「그 **회사별로 필터값이나 빠른필터나 원하는 게
 *   달라서** 그걸 구현해 주려고 해」). 그래서 이 목록은 «기본값»이고, 채널이 제 줄
 *   (`lib/whitelabel.ts` `quick`)에 적으면 그것이 이긴다.
 * ★★**구간은 이름을 «손으로 안 적는다»** — `soloLabel(key)` 가 준다. 예전엔 화면에서만 손으로
 *   적어(「보증금 0원」) 걸린 조건 칩(「보증 없음」)과 **한 화면에서 두 말**이 됐다.
 * ★차종·연료는 구간이 아니라 값이 곧 말이라 여기 적는다 —
 *   손님이 «말로 하는» 조건이다(「SUV 있어요?」 「전기차 돼요?」가 상담 첫 마디).
 */
export const DEFAULT_QUICK: ShopQuickChip[] = [
  { axis: 'dep', key: 'd0' },
  { axis: 'rent', key: 'r50' },
  { axis: 'rent', key: 'r60' },
  { axis: 'rent', key: 'r70' },
  { axis: 'vc', key: 'SUV', label: 'SUV' },
  { axis: 'vc', key: '승합', label: '승합·카니발' },
  { axis: 'vc', key: '승용', label: '승용' },
  { axis: 'fuel', key: '전기', label: '전기차' },
  { axis: 'fuel', key: '하이브리드', label: '하이브리드' },
];

export const SHOP_SORTS = [
  /*
   * ★★★**기본 정렬 = 인기순**(사장님 2026-09-07 「그리고 **기본 정렬은 인기순으로**」).
   *   순위는 «바깥»에서 온다 — `POPULAR_MODELS`(product-filters). 우리 재고가 정하지 않는다.
   * ★맨 앞에 둔다 — 기본값이 목록 가운데 있으면 고르개를 열었을 때 지금 무엇으로 보고 있는지
   *   눈이 한 번 더 찾아야 한다.
   * ★순위 밖 차는 «뒤»로 가되 사라지지 않는다. 뒤에서는 싼 것부터 선다(아래 `sortValue`).
   */
  { key: 'popular', label: '인기순' },
  { key: 'asc', label: '낮은 대여료순' },
  { key: 'desc', label: '높은 대여료순' },
  { key: 'dep', label: '보증금 낮은순' },
  { key: 'year', label: '연식 최신순' },
  { key: 'mile', label: '주행거리 짧은순' },
  /*
   * ★★**같은 차가 여러 대 있는 것부터**(사장님 2026-09-07 「정렬 방식은 **상품 많은 수**도 있어야 해」).
   *
   * ★왜 쓸모가 있나 — 우리 판에서 「그 차 한 대뿐」은 **못 파는 차에 가깝다.** 손님이 색을 고르거나
   *   조건을 바꾸면 바로 없어진다. 같은 차가 열 대 있으면 상담이 끝까지 간다.
   *   영업자가 손님에게 보낼 목록을 고를 때 제일 먼저 보는 값이기도 하다.
   * ★세는 단위는 **제조사 + 모델**이다(「기아 모닝」). 세부트림까지 묶으면(「모닝 어반 JA」)
   *   거의 다 한 대가 되어 이 정렬이 아무 일도 안 한다.
   * ★같은 대수면 **싼 것부터** — 순서가 안 흔들려야 새로고침해도 같은 화면이 나온다.
   */
  { key: 'many', label: '같은 차 많은순' },
] as const;
export type ShopSort = (typeof SHOP_SORTS)[number]['key'];

/**
 * **첫 화면의 정렬 — 한 곳에서 정한다.**
 *
 * ⚠⚠ 이 값이 **네 군데에 흩어져** 있었다(`emptyQuery` · 주소 읽기 두 곳 · 주소 쓰기).
 *   그래서 2026-09-07 에 기본을 인기순으로 바꿨을 때 **한 곳만 고쳐져 안 먹었다** —
 *   주소에 `sort` 가 없으면 읽는 쪽이 다시 `'asc'` 로 채웠기 때문이다.
 * ★주소에 «기본값은 안 싣는다»는 규칙이 있어서(아래 `writeQuery`), 읽는 쪽과 쓰는 쪽이
 *   **같은 값**을 봐야 한다. 다르면 링크를 복사할 때마다 정렬이 슬쩍 바뀐다.
 */
export const SHOP_DEFAULT_SORT: ShopSort = 'popular';

export type ShopSel = Record<ShopAxis, string[]>;
export type ShopQuery = { q: string; sort: ShopSort; sel: ShopSel };

export const emptySel = (): ShopSel =>
  Object.fromEntries(SHOP_AXES.map((a) => [a, [] as string[]])) as unknown as ShopSel;

/*
 * ★첫 화면의 정렬 = **인기순**(사장님 2026-09-07). 전에는 「낮은 대여료순」이었는데,
 *   그러면 첫 화면이 «제일 싼 차»로 채워진다 — 값이 싼 데는 이유가 있고(연식·주행) 그게
 *   우리 판의 첫인상이 된다. 손님이 아는 차가 먼저 보여야 한다.
 */
export const emptyQuery = (): ShopQuery => ({ q: '', sort: SHOP_DEFAULT_SORT, sel: emptySel() });

export const queryCount = (query: ShopQuery): number =>
  SHOP_AXES.reduce((n, a) => n + query.sel[a].length, 0);

/** 한 값을 켜고 끈다 — 상태를 만지는 곳이 한 군데뿐이어야 조건칸과 토큰줄이 안 갈린다. */
export function toggleAxis(query: ShopQuery, axis: ShopAxis, key: string): ShopQuery {
  const cur = query.sel[axis];
  const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
  return { ...query, sel: { ...query.sel, [axis]: next } };
}

export function clearAxis(query: ShopQuery, axis: ShopAxis): ShopQuery {
  return { ...query, sel: { ...query.sel, [axis]: [] } };
}

/* ── 주소 ↔ 조건 ─────────────────────────────────────────────────────────
 * 값은 «보이는 그대로» 싣는다(`maker=기아,현대`). 코드로 줄이면 주소는 짧아지지만 손님이
 * 주소만 봐서는 무슨 조건인지 알 수 없고, 나중에 코드표를 바꾸면 **이미 보낸 링크가 깨진다.**
 * 쉼표는 값 안에 안 나오는 글자라 구분자로 쓴다(제조사·연료·심사 실측 확인).
 */
export function readQuery(params: URLSearchParams): ShopQuery {
  const sel = emptySel();
  for (const a of SHOP_AXES) {
    const raw = params.get(a);
    if (raw) sel[a] = raw.split(',').map((v) => v.trim()).filter(Boolean);
  }
  const sort = String(params.get('sort') || SHOP_DEFAULT_SORT) as ShopSort;
  return {
    q: params.get('q') || '',
    sort: SHOP_SORTS.some((s) => s.key === sort) ? sort : SHOP_DEFAULT_SORT,
    sel,
  };
}

/**
 * 조건을 주소 문자열로. **기본값은 안 싣는다** — 아무것도 안 고른 손님의 주소가
 * `?sort=asc&q=` 로 지저분해지면 그 링크를 복사해 보낼 마음이 안 든다.
 * `keep` 은 조건이 아닌 파라미터(담당자 `a`, 공급사 `p`, 브랜드 `wl`) — 조건을 바꿔도 살아남아야 한다.
 */
export function writeQuery(query: ShopQuery, keep?: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const [k, v] of keep?.entries() || []) {
    if (k !== 'q' && k !== 'sort' && !(SHOP_AXES as readonly string[]).includes(k)) out.set(k, v);
  }
  if (query.q.trim()) out.set('q', query.q.trim());
  if (query.sort !== SHOP_DEFAULT_SORT) out.set('sort', query.sort);
  for (const a of SHOP_AXES) if (query.sel[a].length) out.set(a, query.sel[a].join(','));
  const s = out.toString();
  return s ? `?${s}` : '';
}

/* ── 값 읽기 — 한 차에서 축의 값을 뽑는 방법.
 *    ★세는 쪽과 거르는 쪽이 «같은 함수»를 쓴다. 다르면 「칩엔 12대라는데 눌렀더니 9대」가 된다. */
const bandOf = (bands: Band[], key: string) => bands.find((b) => b.k === key);

const axisMatch: Record<ShopAxis, (p: EntityRecord, key: string) => boolean> = {
  vc: (p, k) => customerVehicleClass(p) === k,
  /*
   * ★★**상품구분** — 「신차렌트냐 중고렌트냐 구독이냐」. 사장님 2026-09-09
   *   「차종구분 밑에 **상품구분도 넣어주라** … 신차렌트 중고렌트 오공구독 오플구독 중고구독 이런 식으로」.
   * ★★**값을 «정본»에서 안 가져오고 재고에서 «센다».** 이유가 있다 —
   *   정본(`PRODUCT_TYPES`, 다섯)이 지금 재고를 못 따라간다. 2026-09-09 실측 710대:
   *   중고렌트 266 · 픽업구독 221 · **오플구독 72** · 신차렌트 68 · **오공구독 60** · 중고구독 22.
   *   **오공·오플구독은 정본에 없고 신차구독은 재고에 없다.** 정본으로 칸을 박으면 손님 화면에서
   *   132대(19%)가 통째로 안 걸리고, 있지도 않은 「신차구독」이 서 있게 된다.
   * ⇒ `canonProductType` 으로 **표기 변형만 접고**(재렌트→중고렌트) 값은 데이터가 정한다.
   *   원천이 새 갈래를 주면 저절로 선다. 정본은 정본대로 고쳐야 하지만, 그건 **원자 일**이지
   *   손님 화면이 기다릴 일이 아니다.
   */
  ptype: (p, k) => canonProductType(p.product_type) === k,
  /*
   * ★**차급** — 「준대형 세단」·「중형 SUV」 처럼 손님이 실제로 말하는 단위다.
   *   위 `vc`(승용·SUV·승합·화물)는 **네 갈래**라 빠른 조건 칩에는 맞지만, 「경차」나 「대형 세단」을
   *   찾는 손님에게는 너무 굵다. 실측 19종이 고르게 갈린다(준대형 세단 27% · 중형 SUV 13% …).
   * ★원천 값을 그대로 쓴다 — 우리가 이름을 새로 지으면 그 순간 차종마스터와 갈린다.
   */
  vclass: (p, k) => String(p.vehicle_class || '').trim() === k,
  /* 그 기간의 요금이 «있는가». 없는 기간으로는 계약이 안 된다(위 `TERM_LABEL` 머리말). */
  term: (p, k) => priceList(p).some((x) => isOperatedPeriod(x.m) && TERM_LABEL(x.m) === k),
  maker: (p, k) => makerDisplay(p.maker) === k,
  year: (p, k) => yearFullDisplay(p.year) === k,
  fuel: (p, k) => (fuelDisplay(p.fuel_type) || String(p.fuel_type || '').trim()) === k,
  credit: (p, k) => creditDisplay(p) === k,
  perk: (p, k) => hasPerk(p, k),
  rent: (p, k) => { const b = bandOf(RENT_BANDS, k); return !!b && priceList(p).some((x) => x.rent > b.lo && x.rent <= b.hi); },
  dep: (p, k) => { const b = bandOf(DEP_BANDS, k); return !!b && priceList(p).some((x) => x.deposit > b.lo && x.deposit <= b.hi); },
  /*
   * ⚠⚠ **값이 없는 차를 구간에 넣지 않는다**(2026-09-05 실측 사고).
   *   `MILE_BANDS` 의 첫 칸이 `lo: -1` 이라, 주행거리가 `0`(= 모른다)인 차가 전부 「1만km↓」에 들어갔다.
   *   그래서 화면이 **「1만km↓ 716대」**라고 말했다 — 실제로 값이 있는 차는 **24대**뿐이다.
   *   카드에서는 「0 은 0km 가 아니라 모른다」고 안 찍어 놓고(확정 규격 §1-6) 필터만 0km 라고 우긴 꼴이다.
   *   누르면 아무것도 안 걸러지니 손님은 그 뒤로 이 화면의 숫자를 안 믿는다.
   * ⇒ `km > 0` 인 차만 센다. 값이 없으면 어느 구간에도 안 든다 — 「모른다」는 조건이 아니다.
   *   (정렬 `mile` 은 원래부터 값 없는 차를 맨 뒤로 보낸다 — `Number(0) || MAX` 이라 0 이 falsy 다.)
   */
  mile: (p, k) => { const b = bandOf(MILE_BANDS, k); const km = Number(p.mileage) || 0; return !!b && km > 0 && km > b.lo && km <= b.hi; },
};

/** 같은 축 안은 OR(기아 «또는» 현대), 축끼리는 AND(기아 «이면서» SUV) — 마켓의 상식대로. */
const passes = (p: EntityRecord, sel: ShopSel, skip?: ShopAxis) =>
  SHOP_AXES.every((a) => a === skip || !sel[a].length || sel[a].some((k) => axisMatch[a](p, k)));

/**
 * 「같은 차」를 세는 열쇠 — **제조사 + 모델**.
 * ★세부트림까지 넣으면(「모닝 어반 JA」) 거의 다 한 대가 되어 「많은순」이 아무 일도 안 한다.
 * ★대소문자·공백은 지우고 본다 — 원천이 「기아 」와 「기아」를 섞어 보낸다.
 */
const sameCarKey = (p: EntityRecord): string =>
  `${makerDisplay(p.maker) || ''}|${String(p.model ?? '').trim()}`.toLowerCase().replace(/\s+/g, '');

const sortValue = (p: EntityRecord, sort: ShopSort): number => {
  const price = cheapest(p);
  /*
   * ★인기순 — 순위(0,1,2…)가 잣대다. 같은 모델끼리는 «싼 것부터»(아래 tie-break).
   *   순위 밖은 `MAX_SAFE_INTEGER` 라 통째로 뒤에 서고, 그 안에서 다시 싼 것부터 선다.
   */
  if (sort === 'popular') return popularRank(p.model);
  if (sort === 'dep') return price?.deposit ?? Number.MAX_SAFE_INTEGER;
  if (sort === 'year') return -(Number(yearFullDisplay(p.year)) || 0);
  if (sort === 'mile') return Number(p.mileage) || Number.MAX_SAFE_INTEGER;
  const rent = price?.rent ?? 0;
  // 값이 없는 차는 «뒤로». 앞에 세우면 빈 카드가 첫 화면을 덮는다.
  if (!rent) return Number.MAX_SAFE_INTEGER;
  return sort === 'desc' ? -rent : rent;
};

export type ShopOption = {
  key: string;
  label: string;
  /** **지금 조건에서** 몇 대인가 — 교차 집계(제 축은 빼고 센다). 0 이 될 수 있다. */
  count: number;
  /**
   * **조건을 다 풀면** 몇 대인가 — 그 채널 재고 전체 기준.
   *
   * ★★**줄이 «있나 없나»는 이 값이 정한다**(사장님 2026-09-10 「필터는 **연동형 필터 아니고**
   *   그냥 누른다고 해서 **다 없어지면 안 되는데**」 · 「그냥 기존 필터에서 **숫자가 0으로 바뀌면**
   *   되잖아 **이게 쭈구러 든다**고」). 예전에는 `count === 0` 이면 줄을 뺐는데, 그러면 손님이
   *   조건 하나를 누를 때마다 **조건칸이 통째로 쪼그라들어** 방금 보던 줄이 사라진다.
   * ⇒ 줄은 **재고에 있으면 선다**(`base > 0`). 조건에 안 걸리면 **숫자만 0** 이 된다.
   * ★차례도 이 값으로 매긴다 — 지금 건수로 매기면 누를 때마다 줄이 위아래로 뛴다.
   */
  base: number;
};
export type ShopFacets = Record<ShopAxis, ShopOption[]>;

export type ShopResult = {
  /** 조건을 다 통과한 차 — 화면에 그릴 목록. */
  list: EntityRecord[];
  /** 조건 없이 팔 수 있는 차 전부 — 「전체차량 N대」의 N. */
  total: number;
  facets: ShopFacets;
};

/**
 * 세고 거르기 — 한 번에.
 *
 * ★★건수는 «그 축을 뺀 나머지 조건»으로 센다(교차 집계).
 *   제조사에서 「기아」를 켠 채 연료 칩의 숫자를 보면, 그 숫자는 **기아 안에서** 몇 대인지를
 *   말해야 한다. 전체 716대 기준으로 세면 「디젤 120」이라 써 놓고 눌렀을 때 3대가 나온다 —
 *   마켓에서 손님이 제일 빨리 등 돌리는 거짓말이다.
 *   반대로 «자기 축»은 빼고 세야 이미 켠 값 옆의 다른 값도 숫자가 살아 있다(안 그러면 전부 0).
 * ★★★**줄은 «재고에 있으면» 선다 — 조건에 안 걸리면 숫자만 0 이 된다**(2026-09-10).
 *   사장님 「필터는 **연동형 필터 아니고** 그냥 누른다고 해서 **다 없어지면 안 되는데**」 ·
 *   「그냥 기존 필터에서 **숫자가 0으로 바뀌면** 되잖아 **이게 쭈구러 든다**고」.
 *   ⚠ 전에는 건수 0 을 뺐다. 그래서 손님이 「SUV」 하나를 누르면 제조사 열둘이 셋으로 줄고
 *     차급 줄이 절반 사라져, **방금 보던 자리가 없어졌다.** 조건칸은 «지도»라 모양이 흔들리면
 *     손님이 제 위치를 잃는다.
 *   ⇒ **명단과 차례는 «재고 전체»(`base`)가 정하고, 숫자만 «지금 조건»(`count`)이 정한다.**
 *     그래서 무엇을 눌러도 줄 수와 순서가 안 바뀐다 — 숫자만 오르내린다.
 * ★재고에 아예 없는 값은 여전히 안 선다(`base === 0`) — 그건 「지금 0」이 아니라 「원래 없다」다.
 */
export function runShopQuery(rows: EntityRecord[] | null, query: ShopQuery): ShopResult {
  const pool = (rows || []).filter(isListableProduct);
  const { sel, q } = query;
  const searched = q.trim() ? pool.filter((p) => matchProductQuery(p, q)) : pool;

  const baseFor = (axis: ShopAxis) => searched.filter((p) => passes(p, sel, axis));

  /*
   * ★**두 벌을 센다.**
   *   ㉠ `pool` — 조건도 검색도 «안 탄» 재고 전체. **명단·차례**를 여기서 만든다(줄이 안 사라진다).
   *   ㉡ `baseFor(axis)` — 지금 조건(제 축은 뺀다)+검색. **숫자**를 여기서 만든다.
   * ⚠ 명단까지 ㉡ 로 만들면 조건을 걸 때마다 조건칸이 쪼그라든다 — 그게 「쭈구러 든다」다.
   */
  const freeTally = (axis: ShopAxis, of: (p: EntityRecord) => string): ShopOption[] => {
    const uni = new Map<string, number>();
    for (const p of pool) { const v = of(p); if (v) uni.set(v, (uni.get(v) || 0) + 1); }
    const live = new Map<string, number>();
    for (const p of baseFor(axis)) { const v = of(p); if (v) live.set(v, (live.get(v) || 0) + 1); }
    return [...uni.entries()].map(([key, base]) => ({ key, label: key, count: live.get(key) || 0, base }));
  };
  /** 값 목록이 정해진 축 — 순서를 재고 대수가 아니라 «손님이 말하는 순서»로 고정한다. */
  const fixedTally = (axis: ShopAxis, order: readonly string[]): ShopOption[] => {
    const live = baseFor(axis);
    return order.map((k) => ({
      key: k, label: k,
      count: live.filter((p) => axisMatch[axis](p, k)).length,
      base: pool.filter((p) => axisMatch[axis](p, k)).length,
    })).filter((o) => o.base > 0);
  };
  const bandTally = (axis: ShopAxis, bands: Band[]): ShopOption[] => {
    const live = baseFor(axis);
    /* ★손님 동은 «축 밑» 이름(`shop`)을 쓴다 — 화살표(`↓`·`↑`)는 우리끼리 쓰는 기호다. */
    return bands.map((b) => ({
      key: b.k, label: b.shop || b.label,
      count: live.filter((p) => axisMatch[axis](p, b.k)).length,
      base: pool.filter((p) => axisMatch[axis](p, b.k)).length,
    })).filter((o) => o.base > 0);
  };

  const facets: ShopFacets = {
    vc: fixedTally('vc', CUSTOMER_VEHICLE_CLASSES),
    /*
     * ★**상품구분은 «물량 많은 순»**(사장님 2026-09-09 「물량 많은 거부터겠지 당연히 순서는」).
     *   차급·제조사와 같은 규칙이다. 0대인 갈래는 `freeTally` 가 알아서 뺀다 —
     *   그래서 정본에만 있고 재고에 없는 「신차구독」은 안 선다.
     * ⚠ 열둘로 자르지 않는다 — 제조사(수십)와 달리 갈래가 예닐곱이라 잘릴 일이 없고,
     *   자르면 새 갈래가 생겼을 때 조용히 사라진다.
     */
    ptype: freeTally('ptype', (p) => canonProductType(p.product_type))
      .sort((a, b) => b.base - a.base || a.key.localeCompare(b.key, 'ko')),
    /*
     * ★기간은 **짧은 것부터** 세운다 — 대수 순으로 세우면 48·36·24·60·12 처럼 뒤죽박죽이 되어
     *   「기간」이라는 축으로 안 읽힌다. 숫자에는 손님이 이미 아는 순서가 있다.
     * ⚠⚠ **표준 여섯(1·12·24·36·48·60)만 세우면 «단기가 사라진다».**
     *   처음에 `PERIODS` 로 박았다가 **6개월 43대 · 18개월** 이 통째로 안 나왔다 —
     *   그 축을 넣은 이유의 절반이 「단기를 찾을 길이 없다」였는데 정작 6개월을 빼먹은 것이다.
     * ⇒ **데이터가 가진 기간을 그대로 세운다.** 원천이 새 기간을 주면 저절로 선다.
     */
    term: fixedTally('term', [...new Set(pool
      .flatMap((p) => priceList(p).filter((x) => isOperatedPeriod(x.m)).map((x) => x.m)))]
      .sort((a, b) => a - b).map(TERM_LABEL)),
    /*
     * ★차급은 **대수 많은 순**이다. 「준대형 세단」이 27% 인데 이름 순으로 세우면 「경형 해치백」이
     *   맨 위에 선다 — 손님이 열에 세 번 고를 것을 맨 밑에 두는 셈이다.
     * ★열둘까지 — 제조사와 같은 규칙이다(스물을 세우면 그게 벽이다).
     */
    vclass: freeTally('vclass', (p) => String(p.vehicle_class || '').trim())
      .sort((a, b) => b.base - a.base || a.key.localeCompare(b.key, 'ko')).slice(0, 12),
    credit: fixedTally('credit', CREDITS),
    perk: fixedTally('perk', CATALOG_PERKS),
    // 제조사는 대수 많은 순 열둘까지 — 스물을 세우면 그게 벽이다.
    maker: freeTally('maker', (p) => makerDisplay(p.maker))
      .sort((a, b) => b.base - a.base || a.key.localeCompare(b.key, 'ko')).slice(0, 12),
    year: freeTally('year', (p) => yearFullDisplay(p.year)).sort((a, b) => b.key.localeCompare(a.key, 'ko')),
    fuel: freeTally('fuel', (p) => fuelDisplay(p.fuel_type) || String(p.fuel_type || '').trim())
      .sort((a, b) => b.base - a.base),
    rent: bandTally('rent', RENT_BANDS),
    dep: bandTally('dep', DEP_BANDS),
    mile: bandTally('mile', MILE_BANDS),
  };

  const kept = searched.filter((p) => passes(p, sel));

  /*
   * ★★**사진 없는 차는 «무조건» 뒤로**(사장님 2026-09-07 「사진 없는 거는 정렬순 할 때 일단
   *   **무조건 밀리는 거로**… 인기순이나 정렬순이나 필터 잡았을 때 **사진 있는 거부터** 나오기」).
   *
   * ★어느 정렬이든 «먼저» 보는 잣대다. 손님이 고르는 화면에서 회색 판은 고를 수가 없다 —
   *   제일 싼 차라도 사진이 없으면 그 카드는 지나간다. 값이 좋은데 안 팔리는 자리를
   *   사진 있는 차가 먼저 채우는 편이 낫다.
   * ★기준은 **카드가 «지금» 그릴 수 있는 사진**이다 — 목록 썸네일과 «같은 함수»(`firstProductImage`)를
   *   쓴다. 다르면 「사진 준비 중인데 앞에 서 있는」 카드가 생긴다(세는 쪽과 그리는 쪽이 갈리는 그 사고).
   * ⚠ 실측(2026-09-07 운영) — 725대 중 첫 화면에 사진이 뜨는 것은 **206대**뿐이다.
   *   나머지는 사진이 «아예 없거나»(200) 드라이브 폴더라 서버가 풀어 줘야 한다(319).
   *   ⇒ 사진을 채우는 일은 재고 쪽 몫이고, 이 잣대는 그때까지 손님 화면을 지켜 준다.
   */
  const photoRank = (p: EntityRecord) => (firstProductImage(p) ? 0 : 1);

  /*
   * ★★★**잣대는 «줄마다 한 번»만 잰다 — 비교마다 재지 않는다**(사장님 2026-09-10
   *   「뭔가 **필터를 잡는데 버벅이는데** 그것도 해결해봐」).
   *
   *   `sort` 의 비교 함수는 n log n 번 불린다(694대면 만 몇 천 번). 그 안에서 `photoRank`(사진을
   *   풀어 본다)와 `sortValue`(요금표를 푼다)를 부르면, **같은 차의 사진과 값을 수십 번 다시 푼다.**
   *   ⚠ 실측 2026-09-10 — 694대·조건 없음에서 `runShopQuery` 가 **292ms** 였다.
   *     그런데 집계(facets)는 다 합쳐 **22ms** 뿐이었다. 나머지 270ms 가 여기였다.
   *     조건을 걸수록 빨라지던 것도 이것 때문이다(목록이 짧아지니 비교가 준다).
   *   ⇒ 줄마다 한 번 재서 숫자로 들고, 비교는 **숫자끼리만** 한다. 694번이면 끝난다.
   * ★차례를 정하는 규칙은 **하나도 안 바뀐다** — 재는 시점만 앞으로 당긴 것이다.
   */
  type Ranked = { p: EntityRecord; photo: number; v: number; tie: number; same: string };
  const rankRows = (list: EntityRecord[], sort: ShopSort, withSame: boolean): Ranked[] =>
    list.map((p) => ({
      p,
      photo: photoRank(p),
      v: sortValue(p, sort),
      /* 인기순은 같은 값이 무더기라 2차 잣대(싼 것부터)가 필요하다 — 그것도 미리 잰다. */
      tie: sort === 'popular' || sort === 'many' ? sortValue(p, 'asc') : 0,
      same: withSame ? sameCarKey(p) : '',
    }));

  /*
   * ★「같은 차 많은순」만 **한 대를 봐서는 못 정하는** 값이다 — 목록 전체를 세어야 순위가 나온다.
   *   그래서 `sortValue`(한 대짜리 잣대)에 못 넣고 여기서 «센 뒤에» 정렬한다.
   * ★세는 모수는 «조건을 통과한 목록»이다. 전체 재고로 세면 「기아가 원래 많으니까」로 줄이 서서
   *   조건을 걸어도 순서가 안 변한다 — 손님이 방금 좁힌 것을 안 반영하는 꼴이다.
   */
  if (query.sort === 'many') {
    const ranked = rankRows(kept, 'many', true);
    const tally = new Map<string, number>();
    for (const r of ranked) tally.set(r.same, (tally.get(r.same) || 0) + 1);
    return {
      list: ranked.sort((a, b) => {
        // ★사진 먼저 — 어느 정렬이든 이 잣대가 앞선다(위 `photoRank`).
        const ph = a.photo - b.photo;
        if (ph) return ph;
        const d = (tally.get(b.same) || 0) - (tally.get(a.same) || 0);
        // 같은 대수면 싼 것부터 — 순서가 안 흔들려야 새로고침해도 같은 화면이다.
        return d || (a.tie - b.tie);
      }).map((r) => r.p),
      total: pool.length,
      facets,
    };
  }

  /*
   * ⚠ 인기순은 «같은 값»이 무더기로 나온다(그랜저 89대가 전부 순위 1). 2차 잣대가 없으면
   *   원천이 준 순서 그대로 서서, 새로고침할 때마다 첫 화면이 달라 보인다.
   *   ⇒ 같은 순위면 싼 것부터. 그러면 목록이 늘 같은 얼굴이다.
   */
  const list = rankRows(kept, query.sort, false).sort((a, b) =>
    // ★사진 먼저 — 어느 정렬이든 이 잣대가 앞선다(위 `photoRank`).
    (a.photo - b.photo)
    || (a.v - b.v)
    || (a.tie - b.tie)).map((r) => r.p);
  return { list, total: pool.length, facets };
}

/** 「적용한 조건」 줄에 뿌릴 토큰 — 무엇이 걸렸는지 본문 위에서 보이고 하나씩 뗀다. */
/**
 * `solo` = **이름이 이미 축을 담고 있다**(「월 50~60만원」·「보증금 없음」·「주행 1만km 이하」).
 * 화면에는 어차피 이름만 뜨지만, **읽어 주는 이름**(`aria-label`)에서 축을 또 붙이면
 * 「보증금 보증금 없음」처럼 말을 더듬는다 — 그래서 부르는 쪽이 이 표시를 보고 뺀다.
 */
export type ShopToken = { axis: ShopAxis; key: string; label: string; solo: boolean };

/**
 * 구간 키의 «혼자 서는 이름» — 걸린 조건 칩이 쓴다.
 *
 * ★★칩에는 **축 앞머리를 안 붙인다**(사장님 2026-09-06 「거기 뭐 **월 대여료 · 보증금 · 기간
 *   넣을 필요 없어. 딱 보면 알지**」). 그래서 값이 «스스로» 무엇인지 말해야 한다 —
 *   숫자만 남기면 「100~200만원」이 대여료인지 보증금인지 못 가른다(둘의 구간이 겹친다).
 *   ⇒ `solo` 가 「월 …」·「보증금 …」·「주행 …」 한 마디를 제 이름으로 갖는다(`product-filters`).
 * ⚠ 2026-09-05 실측. 「보증금 없음」 + 「월 50만↓」을 같이 걸면 0대가 되는데, 그 순간
 *   집계(`bandTally`)가 대수 0인 구간을 걷어내므로 토큰이 이름을 못 찾아 **「월 대여료 r50」·
 *   「보증금 d0」** 이라고 날키를 그대로 보여줬다. 조건이 0대가 됐을 때가 바로 손님이 그 줄을
 *   읽고 하나 떼려는 순간이라, 하필 그때만 읽을 수 없는 말이 서 있었다.
 * ★구간 이름은 «집계»가 아니라 **정의(`*_BANDS`)**가 갖고 있다 — 거기서 찾는다.
 *   나머지 축(제조사·연식·연료·심사·혜택)은 키가 곧 사람 말이라 키가 그대로 이름이다.
 */
const SOLO_LABEL: Record<string, string> = Object.fromEntries(
  [...RENT_BANDS, ...DEP_BANDS, ...MILE_BANDS].map((b) => [b.k, b.solo || b.shop || b.label]),
);

/**
 * 구간 키의 «혼자 서는 이름» — 빠른 조건 칩도 이걸 쓴다.
 * ★칩은 어디에 있든 같은 말이라야 한다. 예전엔 빠른 칩만 손으로 적어(「보증금 0원」)
 *   걸린 조건 칩(「보증 없음」)과 한 화면에서 두 말이 됐다.
 */
export const soloLabel = (key: string): string | undefined => SOLO_LABEL[key];

export function activeTokens(query: ShopQuery, facets: ShopFacets): ShopToken[] {
  const out: ShopToken[] = [];
  for (const axis of SHOP_AXES) {
    for (const key of query.sel[axis]) {
      /*
       * ★구간은 **`SOLO_LABEL` 이 먼저**다 — 집계 이름(`shop`)은 축 제목 밑에서 쓸 짧은 말이라
       *   칩에 혼자 세우면 무엇의 값인지 모른다(「없음」·「100~200만원」).
       * 구간이 아닌 축(제조사·연료·심사…)은 키가 곧 사람 말이라 집계 이름을 그대로 쓴다.
       * 집계에서 사라진 값(조건을 좁혀 0대가 된 것)도 토큰은 **남긴다.** 안 그러면
       * 「아무것도 안 나오는데 뗄 수도 없는」 조건이 생긴다.
       */
      const found = facets[axis].find((o) => o.key === key);
      const solo = SOLO_LABEL[key];
      out.push({ axis, key, label: solo || found?.label || key, solo: !!solo });
    }
  }
  return out;
}
