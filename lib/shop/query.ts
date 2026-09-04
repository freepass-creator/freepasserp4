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
import { cheapest, creditDisplay, isListableProduct, priceList } from '@/lib/domain/product';
import { matchProductQuery } from '@/lib/domain/search';
import {
  RENT_BANDS, DEP_BANDS, MILE_BANDS, CREDITS, CATALOG_PERKS, hasPerk, type Band,
} from '@/lib/domain/product-filters';
import { fuelDisplay, makerDisplay, yearFullDisplay } from '@/lib/domain/vehicle-master-format';
import { CUSTOMER_VEHICLE_CLASSES, customerVehicleClass } from '@/lib/domain/catalog-facets';

/** 고를 수 있는 축. 값은 주소 파라미터 이름이기도 하다 — 짧고 안 바뀌는 이름으로 둔다. */
export const SHOP_AXES = ['vc', 'maker', 'rent', 'dep', 'credit', 'year', 'mile', 'fuel', 'perk'] as const;
export type ShopAxis = (typeof SHOP_AXES)[number];

/** 축 이름 — 조건칸 제목이자 「적용한 조건」 토큰의 앞머리. 한 곳에서만 적는다. */
export const AXIS_LABEL: Record<ShopAxis, string> = {
  vc: '차종', maker: '제조사', rent: '월 대여료', dep: '보증금',
  credit: '심사', year: '연식', mile: '주행거리', fuel: '연료', perk: '혜택',
};

export const SHOP_SORTS = [
  { key: 'asc', label: '낮은 대여료순' },
  { key: 'desc', label: '높은 대여료순' },
  { key: 'dep', label: '보증금 낮은순' },
  { key: 'year', label: '연식 최신순' },
  { key: 'mile', label: '주행거리 짧은순' },
] as const;
export type ShopSort = (typeof SHOP_SORTS)[number]['key'];

export type ShopSel = Record<ShopAxis, string[]>;
export type ShopQuery = { q: string; sort: ShopSort; sel: ShopSel };

export const emptySel = (): ShopSel =>
  Object.fromEntries(SHOP_AXES.map((a) => [a, [] as string[]])) as unknown as ShopSel;

export const emptyQuery = (): ShopQuery => ({ q: '', sort: 'asc', sel: emptySel() });

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
  const sort = String(params.get('sort') || 'asc') as ShopSort;
  return {
    q: params.get('q') || '',
    sort: SHOP_SORTS.some((s) => s.key === sort) ? sort : 'asc',
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
  if (query.sort !== 'asc') out.set('sort', query.sort);
  for (const a of SHOP_AXES) if (query.sel[a].length) out.set(a, query.sel[a].join(','));
  const s = out.toString();
  return s ? `?${s}` : '';
}

/* ── 값 읽기 — 한 차에서 축의 값을 뽑는 방법.
 *    ★세는 쪽과 거르는 쪽이 «같은 함수»를 쓴다. 다르면 「칩엔 12대라는데 눌렀더니 9대」가 된다. */
const bandOf = (bands: Band[], key: string) => bands.find((b) => b.k === key);

const axisMatch: Record<ShopAxis, (p: EntityRecord, key: string) => boolean> = {
  vc: (p, k) => customerVehicleClass(p) === k,
  maker: (p, k) => makerDisplay(p.maker) === k,
  year: (p, k) => yearFullDisplay(p.year) === k,
  fuel: (p, k) => (fuelDisplay(p.fuel_type) || String(p.fuel_type || '').trim()) === k,
  credit: (p, k) => creditDisplay(p) === k,
  perk: (p, k) => hasPerk(p, k),
  rent: (p, k) => { const b = bandOf(RENT_BANDS, k); return !!b && priceList(p).some((x) => x.rent > b.lo && x.rent <= b.hi); },
  dep: (p, k) => { const b = bandOf(DEP_BANDS, k); return !!b && priceList(p).some((x) => x.deposit > b.lo && x.deposit <= b.hi); },
  mile: (p, k) => { const b = bandOf(MILE_BANDS, k); const km = Number(p.mileage) || 0; return !!b && km > b.lo && km <= b.hi; },
};

/** 같은 축 안은 OR(기아 «또는» 현대), 축끼리는 AND(기아 «이면서» SUV) — 마켓의 상식대로. */
const passes = (p: EntityRecord, sel: ShopSel, skip?: ShopAxis) =>
  SHOP_AXES.every((a) => a === skip || !sel[a].length || sel[a].some((k) => axisMatch[a](p, k)));

const sortValue = (p: EntityRecord, sort: ShopSort): number => {
  const price = cheapest(p);
  if (sort === 'dep') return price?.deposit ?? Number.MAX_SAFE_INTEGER;
  if (sort === 'year') return -(Number(yearFullDisplay(p.year)) || 0);
  if (sort === 'mile') return Number(p.mileage) || Number.MAX_SAFE_INTEGER;
  const rent = price?.rent ?? 0;
  // 값이 없는 차는 «뒤로». 앞에 세우면 빈 카드가 첫 화면을 덮는다.
  if (!rent) return Number.MAX_SAFE_INTEGER;
  return sort === 'desc' ? -rent : rent;
};

export type ShopOption = { key: string; label: string; count: number };
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
 * ★건수 0 인 값은 **안 보여준다.** 눌러도 아무것도 없는 조건을 세워 두지 않는다.
 */
export function runShopQuery(rows: EntityRecord[] | null, query: ShopQuery): ShopResult {
  const pool = (rows || []).filter(isListableProduct);
  const { sel, q } = query;
  const searched = q.trim() ? pool.filter((p) => matchProductQuery(p, q)) : pool;

  const baseFor = (axis: ShopAxis) => searched.filter((p) => passes(p, sel, axis));

  const freeTally = (axis: ShopAxis, of: (p: EntityRecord) => string): ShopOption[] => {
    const m = new Map<string, number>();
    for (const p of baseFor(axis)) { const v = of(p); if (v) m.set(v, (m.get(v) || 0) + 1); }
    return [...m.entries()].map(([key, count]) => ({ key, label: key, count }));
  };
  /** 값 목록이 정해진 축 — 순서를 재고 대수가 아니라 «손님이 말하는 순서»로 고정한다. */
  const fixedTally = (axis: ShopAxis, order: readonly string[]): ShopOption[] => {
    const base = baseFor(axis);
    return order.map((k) => ({ key: k, label: k, count: base.filter((p) => axisMatch[axis](p, k)).length }))
      .filter((o) => o.count > 0);
  };
  const bandTally = (axis: ShopAxis, bands: Band[]): ShopOption[] => {
    const base = baseFor(axis);
    return bands.map((b) => ({ key: b.k, label: b.label, count: base.filter((p) => axisMatch[axis](p, b.k)).length }))
      .filter((o) => o.count > 0);
  };

  const facets: ShopFacets = {
    vc: fixedTally('vc', CUSTOMER_VEHICLE_CLASSES),
    credit: fixedTally('credit', CREDITS),
    perk: fixedTally('perk', CATALOG_PERKS),
    // 제조사는 대수 많은 순 열둘까지 — 스물을 세우면 그게 벽이다.
    maker: freeTally('maker', (p) => makerDisplay(p.maker))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'ko')).slice(0, 12),
    year: freeTally('year', (p) => yearFullDisplay(p.year)).sort((a, b) => b.key.localeCompare(a.key, 'ko')),
    fuel: freeTally('fuel', (p) => fuelDisplay(p.fuel_type) || String(p.fuel_type || '').trim())
      .sort((a, b) => b.count - a.count),
    rent: bandTally('rent', RENT_BANDS),
    dep: bandTally('dep', DEP_BANDS),
    mile: bandTally('mile', MILE_BANDS),
  };

  const list = searched.filter((p) => passes(p, sel))
    .sort((a, b) => sortValue(a, query.sort) - sortValue(b, query.sort));
  return { list, total: pool.length, facets };
}

/** 「적용한 조건」 줄에 뿌릴 토큰 — 무엇이 걸렸는지 본문 위에서 보이고 하나씩 뗀다. */
export type ShopToken = { axis: ShopAxis; key: string; label: string };

export function activeTokens(query: ShopQuery, facets: ShopFacets): ShopToken[] {
  const out: ShopToken[] = [];
  for (const axis of SHOP_AXES) {
    for (const key of query.sel[axis]) {
      /*
       * 라벨은 집계에서 찾는다 — 밴드는 키가 `r50` 이라 그대로 보여줄 수 없다.
       * 집계에서 사라진 값(조건을 좁혀 0대가 된 것)도 토큰은 **남긴다.** 안 그러면
       * 「아무것도 안 나오는데 뗄 수도 없는」 조건이 생긴다.
       */
      const found = facets[axis].find((o) => o.key === key);
      out.push({ axis, key, label: found?.label || key });
    }
  }
  return out;
}
