'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { cheapestRent, creditDisplay, isListableProduct, priceList } from '@/lib/domain/product';
import { matchProductQuery } from '@/lib/domain/search';
import { ProductCard } from '@/components/ProductCard';
import {
  RENT_BANDS, DEP_BANDS, MILE_BANDS, CREDITS, CATALOG_PERKS, hasPerk,
  presentFilterOptions,
} from '@/lib/domain/product-filters';
import { fuelDisplay, makerDisplay, yearDisplay } from '@/lib/domain/vehicle-master-format';
import { CUSTOMER_VEHICLE_CLASSES, customerVehicleClass } from '@/lib/domain/catalog-facets';
import { C, FW, FS, CenterNote, FilterChips, FilterGroup, ListMoreBar, Message, SearchInput, Select, ToggleChips, ProductCardSkeleton } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { toggleInSet } from '@/lib/set';
import { GUEST_W } from '@/lib/guest-layout';
import { WhitelabelFrame } from '@/components/WhitelabelFrame';
import { FREEPASS, hasBrand, type Whitelabel } from '@/lib/whitelabel';
/**
 * 손님 공개 카탈로그(화이트라벨) — 영업 공유의 착지점. ERP 크롬 없음.
 * 필터 축 = 홈과 동일 SSOT (심사 CREDITS · 혜택 CATALOG_PERKS · 월대여료=matchProduct와 동일 밴드).
 *
 * ★데이터는 **서버 API**(`/api/catalog/feed`)에서 받는다. 예전엔 브라우저가 products 와
 *   partners 를 통째로 직접 읽었는데, 규칙이 인증을 요구해 비로그인 손님에게는 목록 0건이었다
 *   (LAUNCH_QA_2026-07-30 「영업 공유 퍼널 전면 불능」). 규칙을 열어 풀었다면 공급사 명단까지
 *   샜을 구조다. 서버가 화이트리스트만 걸러 준다.
 *
 *   ?p={공급사코드} → 그 공급사 매물만(화이트라벨) · ?a={영업 user_code} → 담당 귀속
 *
 * ★브랜드(워드마크·색·푸터)는 여기서 정하지 않는다 — **서버 껍데기(`page.tsx`)가 호스트를 보고**
 *   정해서 `wl` 로 넘긴다. 클라이언트에서 칠하면 브랜드 없는 맨 화면이 한 번 번쩍인 뒤 바뀐다
 *   (globals.css 「칠하는 주체는 CSS 다」와 같은 이유).
 *
 * ★★껍데기가 둘인 것은 **일부러**다(사장님 2026-09-04 「유니오토거 바꾸고 프리패스도 따라 갈 거야」).
 *   · 브랜드 O = **마켓 껍데기** — 첫 줄 검색 + 좌 조건칸 + 전체차량 N대 + 격자.
 *     중고차·렌터카 마켓(현대인증중고차·티카·리본카)이 공통으로 쓰는 짜임이다.
 *   · 브랜드 X = **지금 프리패스 화면 그대로.** 한 줄도 안 건드린다.
 *   프리패스가 따라올 때는 화면을 다시 짜는 게 아니라 **이 분기를 지우면** 된다 —
 *   그때까지 새 짜임은 여기 한 곳에만 있다(두 벌로 갈라 두지 않는다).
 */

const PAGE = 100; // 파인더와 동일 — 첫 화면·더보기 단위

/**
 * 첫 줄에 세우는 「많이 찾는 조건」 — 손님이 제일 먼저 누르는 것만.
 * ★값은 지어내지 않고 `RENT_BANDS`(필터 SSOT) 의 **키를 그대로** 쓴다. 키가 안 맞으면
 *   칩이 조용히 0개가 되어 라벨만 남는다(실제로 한 번 그렇게 비었다).
 * 저신용·무심사 손님은 싼 쪽부터 보므로 아래 세 밴드가 첫 줄이다.
 */
const QUICK_RENT = ['r50', 'r60', 'r70'] as const;

export function CatalogView({ wl = FREEPASS }: { wl?: Whitelabel }) {
  const mobile = useIsMobile();
  const branded = hasBrand(wl);
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [brand, setBrand] = useState('');
  // 공유링크(?a=)로 들어온 손님의 담당 영업자 — 머리 오른쪽 「담당 OOO · 전화」가 쓴다.
  const [agent, setAgent] = useState<{ name?: string; phone?: string } | null>(null);
  const [attr, setAttr] = useState('');
  const [qInput, setQInput] = useState(''); // 검색창 즉시 반영
  const [q, setQ] = useState(''); // 디바운스된 검색
  const [rent, setRent] = useState('');
  const [credit, setCredit] = useState<Set<string>>(new Set());
  const [perks, setPerks] = useState<Set<string>>(new Set());
  // 손님용으로 더한 축 — 차종·제조사·보증금·연식·주행거리·연료.
  const [vclass, setVclass] = useState<Set<string>>(new Set());
  const [maker, setMaker] = useState<Set<string>>(new Set());
  const [dep, setDep] = useState<Set<string>>(new Set());
  const [year, setYear] = useState<Set<string>>(new Set());
  const [mile, setMile] = useState<Set<string>>(new Set());
  const [fuel, setFuel] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState('asc');
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => { (async () => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    const a = params.get('a') || (typeof window !== 'undefined' ? localStorage.getItem('fp4_attr') : '') || '';
    if (a && typeof window !== 'undefined') localStorage.setItem('fp4_attr', a);
    setAttr(a);
    const provider = params.get('p') || '';
    try {
      const q2 = new URLSearchParams();
      if (provider) q2.set('p', provider);
      if (a) q2.set('a', a);
      const res = await fetch(`/api/catalog/feed?${q2}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({})) as {
        products?: EntityRecord[];
        brand?: string;
        agent?: { name?: string; phone?: string } | null;
      };
      setRows(res.ok && body.products ? body.products : []);
      setBrand(String(body.brand || ''));
      setAgent(body.agent || null);
    } catch {
      setRows([]);
    }
  })(); /* eslint-disable-next-line */ }, []);

  // 검색 디바운스 — 타이핑마다 전량 filter/sort 방지(파인더 180ms와 동일)
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 180);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => { setLimit(PAGE); }, [q, rent, credit, perks, vclass, maker, dep, year, mile, fuel, sort]);

  /**
   * 옵션·건수 = **finder 와 같은 SSOT**(`presentFilterOptions`). 따로 세면 「웹에선 걸리는데
   * 손님 화면엔 안 걸리는」 숨은 필터가 생긴다. 값이 없는 축·칩은 알아서 숨는다.
   * ★차종·제조사·연식은 여기 없어 직접 센다 — 판정식은 finder 와 같은 표시함수를 쓴다.
   */
  const facets = useMemo(() => presentFilterOptions(rows || []), [rows]);
  const dynFacets = useMemo(() => {
    const count = (get: (p: EntityRecord) => string) => {
      const m = new Map<string, number>();
      for (const p of rows || []) { const v = get(p); if (v) m.set(v, (m.get(v) || 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
    };
    return {
      // 차종은 «큰 갈래»로 접어 센다 — 원본 20갈래를 손님 화면에 그대로 세우면 벽이 된다.
      //  순서는 재고 대수가 아니라 «손님이 말하는 순서»(승용 → SUV → 승합 → 화물)로 고정한다.
      vclass: (() => {
        const m = new Map(count((p) => customerVehicleClass(p)));
        return CUSTOMER_VEHICLE_CLASSES.filter((k) => m.has(k)).map((k) => [k, m.get(k) || 0] as [string, number]);
      })(),
      // 제조사는 대수 많은 순 열둘까지 — 손님 화면에 스무 개를 세우면 그게 또 벽이다.
      maker: count((p) => makerDisplay(p.maker)).slice(0, 12),
      // 연식은 최신순.
      year: count((p) => yearDisplay(p.year)).sort((a, b) => b[0].localeCompare(a[0], 'ko')),
    };
  }, [rows]);

  const list = useMemo(() => {
    const l = (rows || []).filter((p) => {
      // peekList 캐시도 같은 판매조건을 다시 통과시켜 첫 페인트 누출을 막는다.
      if (!isListableProduct(p)) return false;
      if (!matchProductQuery(p, q)) return false;
      // 월대여료 = 홈 matchProduct SSOT (모든 기간 중 하나라도 밴드에 들면 통과)
      if (rent) {
        const b = RENT_BANDS.find((x) => x.k === rent);
        if (b && !priceList(p).some((x) => x.rent > b.lo && x.rent <= b.hi)) return false;
      }
      // 보증금·주행 = finder 와 같은 밴드 의미(lo < x ≤ hi 를 하나라도 만족).
      if (dep.size && !DEP_BANDS.some((b) => dep.has(b.k) && priceList(p).some((x) => x.deposit > b.lo && x.deposit <= b.hi))) return false;
      if (mile.size) {
        const km = Number(p.mileage) || 0;
        if (!MILE_BANDS.some((b) => mile.has(b.k) && km > b.lo && km <= b.hi)) return false;
      }
      if (fuel.size && !fuel.has(fuelDisplay(p.fuel_type) || String(p.fuel_type || ''))) return false;
      if (vclass.size && !vclass.has(customerVehicleClass(p))) return false;
      if (maker.size && !maker.has(makerDisplay(p.maker))) return false;
      if (year.size && !year.has(yearDisplay(p.year))) return false;
      if (credit.size && !credit.has(creditDisplay(p))) return false;
      if (perks.size && ![...perks].every((pk) => hasPerk(p, pk))) return false;
      return true;
    });
    l.sort((a, b) => (sort === 'asc' ? 1 : -1) * (cheapestRent(a) - cheapestRent(b)));
    return l;
  }, [rows, q, rent, credit, perks, vclass, maker, dep, year, mile, fuel, sort]);

  const shown = list.slice(0, limit);
  const href = (p: EntityRecord) => `/q/${encodeURIComponent(String(p.product_code))}${attr ? `?a=${encodeURIComponent(attr)}` : ''}`;

  // 껍데기는 목록을 기다리는 동안에도 서 있어야 한다 — 머리띠가 뒤늦게 나타나면 그게 「번쩍」이다.
  const frame = (node: ReactNode) => (
    <WhitelabelFrame wl={wl} agentName={agent?.name} agentPhone={agent?.phone}>{node}</WhitelabelFrame>
  );

  /**
   * 목록 머리의 정렬 — **조건칸이 아니라 카드 열의 어깨다.**
   * 현대인증중고차·티카 둘 다 「N대 + 정렬」을 목록 열 머리에 둔다(실측 2026-09-04).
   * 정렬을 왼쪽 기둥에 넣으면 기둥만 무거워지고, 격자에는 머리가 없어 어깨가 안 생긴다.
   */
  const sortRow = (
    <FilterChips
      value={sort}
      onChange={setSort}
      options={[{ key: 'asc', label: '낮은 대여료순' }, { key: 'desc', label: '높은 대여료순' }]}
      clearKey="asc"
    />
  );

  // ── 조건칸 — 웹은 왼쪽 기둥, 모바일은 목록 위에 눕는다. 값·축은 양쪽이 같은 것을 쓴다. ──
  /**
   * 조건칸 — **손님이 쓰는 축만.** 프리패스 필터는 이보다 많지만(기간·상품구분·프로모·색상·
   * 약정주행·공급사) 손님 화면에 다 세우면 그게 또 벽이다.
   * ⚠ **공급사는 절대 안 낸다** — 누구 차인지 손님이 알 필요가 없고, 알면 우리를 건너뛴다.
   * 순서는 손님이 고르는 순서다: 무슨 차 → 어느 회사 → 얼마 → 얼마 걸고 → 심사 → 상태 → 혜택.
   */
  const multi = (
    title: string, sel: Set<string>, set: (fn: (p: Set<string>) => Set<string>) => void,
    clear: () => void, opts: { key: string; label: string }[], first?: boolean,
  ) => (opts.length ? (
    <FilterGroup title={title} count={sel.size} defaultOpen={!mobile} first={first} onClear={clear}>
      <ToggleChips selected={sel} onToggle={(k) => set((p) => toggleInSet(p, k))} options={opts} />
    </FilterGroup>
  ) : null);

  const conditions = (
    <>
      {multi('차종', vclass, setVclass, () => setVclass(new Set()),
        dynFacets.vclass.map(([v]) => ({ key: v, label: v })), true)}
      {multi('제조사', maker, setMaker, () => setMaker(new Set()),
        dynFacets.maker.map(([v]) => ({ key: v, label: v })))}
      <FilterGroup title="월 대여료" count={rent ? 1 : 0} defaultOpen={!mobile} onClear={() => setRent('')}>
        <FilterChips
          value={rent}
          onChange={setRent}
          options={(facets.rent.length ? facets.rent : RENT_BANDS.map((b) => ({ key: b.k, label: b.label, count: 0 })))
            .map((b) => ({ key: b.key, label: b.label }))}
          clearKey=""
        />
      </FilterGroup>
      {multi('보증금', dep, setDep, () => setDep(new Set()),
        facets.dep.map((b) => ({ key: b.key, label: b.label })))}
      {multi('심사', credit, setCredit, () => setCredit(new Set()),
        (facets.credit.length ? facets.credit.map((c) => ({ key: c.key, label: c.label })) : CREDITS.map((c) => ({ key: c, label: c }))))}
      {multi('연식', year, setYear, () => setYear(new Set()),
        dynFacets.year.map(([v]) => ({ key: v, label: v })))}
      {multi('주행거리', mile, setMile, () => setMile(new Set()),
        facets.mile.map((b) => ({ key: b.key, label: b.label })))}
      {multi('연료', fuel, setFuel, () => setFuel(new Set()),
        facets.fuel.map((f) => ({ key: f.key, label: f.label })))}
      {multi('혜택', perks, setPerks, () => setPerks(new Set()),
        (facets.perks.length ? facets.perks.map((p) => ({ key: p.key, label: p.label })) : CATALOG_PERKS.map((pk) => ({ key: pk, label: pk }))))}
    </>
  );

  const cards = rows === null ? <ProductCardSkeleton count={6} />
    : list.length === 0 ? <CenterNote>조건에 맞는 차량이 없습니다.</CenterNote> : (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
        {shown.map((p) => <ProductCard key={String(p.product_code)} p={p} audience="customer" href={href(p)} />)}
      </div>
      <ListMoreBar shown={shown.length} total={list.length} unit="대" pageSize={PAGE} onMore={() => setLimit((n) => n + PAGE)} />
    </>
  );

  /** 대수는 목록이 오기 «전»엔 0 이 아니라 빈칸이다 — 0 을 보여 주면 「차가 없다」로 읽힌다. */
  const countText = rows === null ? '—' : String(list.length);

  // ── 브랜드 O = 마켓 껍데기 ──────────────────────────────────────────────
  // ★목록을 기다리는 동안에도 **검색·조건·대수는 서 있다.** 예전엔 스켈레톤만 그리고
  //   그 셋을 통째로 안 그렸는데, 매물이 늦게 오면 화면이 「스켈레톤 몇 장 + 바로 푸터」가 되어
  //   시안과 전혀 다른 화면이 됐다(2026-09-04 프리뷰 실측).
  if (branded) {
    return frame(
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: mobile ? '14px 16px 28px' : '32px 24px 48px' }}>
        {/*
          ★검색창을 «페이지 중앙»에 두지 않는다 — 목록 열 위에 둔다(실측 자문 2026-09-04).
            중앙 900px 검색창은 필터 기둥(99~359) 위를 파고들어 **어느 열에도 안 걸린 제3의 축**이었다.
            왼끝이 헤더 75 · 기둥 99 · 검색 265 · 격자 399 로 넉 줄이 되어 눈이 세 번 정렬을 다시 잡았고,
            그 900×178 섬이 좌우 두 열을 통째로 178px 아래로 밀어 「필터가 한참 아래에서 시작」했다.
            엔카·케이카·티카 셋 다 검색을 목록 열 폭에 맞춰 축을 «둘»로 유지한다
            (엔카는 정렬바까지 목록 폭에 1px 안 틀리게 맞춘다).
        */}
        <div style={{ display: mobile ? 'block' : 'flex', gap: 40, alignItems: 'flex-start' }}>

          {/* 왼쪽 기둥 = 「전체차량 N대」 + 조건. 헤더 바로 밑에서 출발한다. */}
          {!mobile ? (
            <aside style={{ width: 260, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, paddingBottom: 16 }}>
                <span style={{ fontSize: FS.body, fontWeight: FW.meta, color: C.mute }}>전체차량</span>
                <span style={{ fontSize: 26, fontWeight: FW.head, color: C.brand, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{countText}</span>
                <span style={{ fontSize: FS.body, fontWeight: FW.title }}>대</span>
              </div>
              {conditions}
            </aside>
          ) : null}

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* 검색 — 목록 열과 «같은 폭·같은 축». 페이지 중앙에 걸치지 않는다. */}
            <SearchInput hero full value={qInput} onChange={setQInput} placeholder="차종, 차량번호로 검색해 보세요" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
              <span style={{ fontSize: FS.sub, color: C.faint, marginRight: 2 }}>많이 찾는 조건</span>
              <FilterChips
                value={rent}
                onChange={setRent}
                options={RENT_BANDS.filter((b) => (QUICK_RENT as readonly string[]).includes(b.k)).map((b) => ({ key: b.k, label: b.label }))}
                clearKey=""
              />
            </div>

            {/* 목록 머리 = 격자의 어깨. 대수와 정렬이 카드 열 위에 선다. */}
            <div style={{
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10,
              margin: mobile ? '16px 0 12px' : '28px 0 18px',
            }}>
              {mobile ? (
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: FS.sub, fontWeight: FW.meta, color: C.mute }}>전체차량</span>
                  <span style={{ fontSize: 22, fontWeight: FW.head, color: C.brand, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{countText}</span>
                  <span style={{ fontSize: FS.sub, fontWeight: FW.title }}>대</span>
                </span>
              ) : (
                <span style={{ fontSize: FS.body, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>{countText}대</span>
              )}
              <div style={{ flex: 1 }} />
              {sortRow}
            </div>

            {mobile ? <div style={{ marginBottom: 14 }}>{conditions}</div> : null}
            {cards}
          </div>
        </div>

        <Message variant="info">표시 가격은 참고용이며 심사·재고에 따라 변동될 수 있습니다.</Message>
      </main>,
    );
  }

  // ── 브랜드 X = 지금 프리패스 화면 그대로. 손대지 않는다. ─────────────────
  if (rows === null) return <ProductCardSkeleton count={6} />;

  return (
    <main style={{ maxWidth: GUEST_W, margin: '0 auto', padding: '18px 16px 28px' }}>
      {/* 화이트라벨 — ?p= 로 공급사를 지정하면 그 회사 이름이 머리글이 된다. */}
      <div style={{ fontSize: FS.sub, color: C.mute, letterSpacing: '0.04em' }}>{brand || '차량 렌탈'}</div>
      <h1 style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', margin: '4px 0 12px' }}>조건별 차량 찾기</h1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <SearchInput value={qInput} onChange={setQInput} placeholder="차번·차명·연료·옵션…" style={{ flex: '1 1 200px', minWidth: 180 }} />
        <Select value={rent} onChange={setRent} placeholder="월대여료 전체" options={RENT_BANDS.map((b) => ({ value: b.k, label: b.label }))} />
      </div>
      <FilterGroup title="정렬" count={sort !== 'asc' ? 1 : 0} defaultOpen first onClear={() => setSort('asc')}>
        <FilterChips
          value={sort}
          onChange={setSort}
          options={[{ key: 'asc', label: '낮은 대여료순' }, { key: 'desc', label: '높은 대여료순' }]}
          clearKey="asc"
        />
      </FilterGroup>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <ToggleChips selected={credit} onToggle={(k) => setCredit((p) => toggleInSet(p, k))} options={CREDITS.map((c) => ({ key: c, label: c }))} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <ToggleChips selected={perks} onToggle={(k) => setPerks((p) => toggleInSet(p, k))} options={CATALOG_PERKS.map((pk) => ({ key: pk, label: pk }))} />
        <span style={{ fontSize: FS.sub, color: C.mute }}>{list.length}대</span>
      </div>

      {cards}
      <Message variant="info">표시 가격은 참고용이며 심사·재고에 따라 변동될 수 있습니다.</Message>
    </main>
  );
}
