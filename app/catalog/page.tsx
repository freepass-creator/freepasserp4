'use client';
import { useEffect, useMemo, useState } from 'react';
import { getStore, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { cheapestRent, creditDisplay, isHiddenFromCatalog, priceList } from '@/lib/domain/product';
import { matchProductQuery } from '@/lib/domain/search';
import { withProviderNames } from '@/lib/domain/identity';
import { ProductCard } from '@/components/ProductCard';
import { RENT_BANDS, CREDITS, CATALOG_PERKS, hasPerk } from '@/lib/domain/product-filters';
import { C, Loading, CenterNote, SearchInput, Select, ToggleChips } from '@/components/ui';
import { toggleInSet } from '@/lib/set';

// 손님 공개 카탈로그(화이트라벨) — 영업 공유의 착지점. ERP 크롬 없음.
// 필터 축 = 홈과 동일 SSOT (심사 CREDITS · 혜택 CATALOG_PERKS · 월대여료=matchProduct와 동일 밴드 판정).

export default function Catalog() {
  const co = getCompanyId();
  const [rows, setRows] = useState<EntityRecord[] | null>(() => peekList('product', co));
  const [attr, setAttr] = useState('');
  const [q, setQ] = useState('');
  const [rent, setRent] = useState('');
  const [credit, setCredit] = useState<Set<string>>(new Set());
  const [perks, setPerks] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState('asc');

  useEffect(() => { (async () => {
    await seedIfEmpty(co);
    const a = typeof window !== 'undefined' ? (new URLSearchParams(location.search).get('a') || localStorage.getItem('fp4_attr') || '') : '';
    if (a && typeof window !== 'undefined') localStorage.setItem('fp4_attr', a);
    setAttr(a);
    const all = await getStore().list('product', co);
    const partners = await getStore().list('partner', co);
    setRows(withProviderNames(
      all.filter((p) => !isHiddenFromCatalog(p) && cheapestRent(p) < Infinity),
      partners,
    ));
  })(); /* eslint-disable-next-line */ }, []);

  const list = useMemo(() => {
    const l = (rows || []).filter((p) => {
      if (!matchProductQuery(p, q)) return false;
      // 월대여료 = 홈 matchProduct SSOT (모든 기간 중 하나라도 밴드에 들면 통과)
      if (rent) {
        const b = RENT_BANDS.find((x) => x.k === rent);
        if (b && !priceList(p).some((x) => x.rent > b.lo && x.rent <= b.hi)) return false;
      }
      if (credit.size && !credit.has(creditDisplay(p))) return false;
      if (perks.size && ![...perks].every((pk) => hasPerk(p, pk))) return false;
      return true;
    });
    l.sort((a, b) => (sort === 'asc' ? 1 : -1) * (cheapestRent(a) - cheapestRent(b)));
    return l;
  }, [rows, q, rent, credit, perks, sort]);

  const href = (p: EntityRecord) => `/q/${encodeURIComponent(String(p.product_code))}${attr ? `?a=${encodeURIComponent(attr)}` : ''}`;

  if (rows === null) return <Loading />;

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '18px 16px 28px' }}>
      <div style={{ fontSize: 12, color: C.mute, letterSpacing: '0.04em' }}>차량 렌탈</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '4px 0 12px' }}>조건별 차량 찾기</h1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <SearchInput value={q} onChange={setQ} placeholder="차번·차명·연료·옵션…" style={{ flex: '1 1 200px', minWidth: 180 }} />
        <Select value={rent} onChange={setRent} placeholder="월대여료 전체" options={RENT_BANDS.map((b) => ({ value: b.k, label: b.label }))} />
        <Select value={sort} onChange={setSort} options={[{ value: 'asc', label: '낮은 대여료순' }, { value: 'desc', label: '높은 대여료순' }]} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <ToggleChips selected={credit} onToggle={(k) => setCredit((p) => toggleInSet(p, k))} options={CREDITS.map((c) => ({ key: c, label: c }))} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <ToggleChips selected={perks} onToggle={(k) => setPerks((p) => toggleInSet(p, k))} options={CATALOG_PERKS.map((pk) => ({ key: pk, label: pk }))} />
        <span style={{ fontSize: 12.5, color: C.mute }}>{list.length}대</span>
      </div>

      {list.length === 0 ? <CenterNote>조건에 맞는 차량이 없습니다.</CenterNote> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
          {list.map((p) => <ProductCard key={String(p.product_code)} p={p} audience="customer" href={href(p)} />)}
        </div>
      )}
      <div style={{ marginTop: 20, fontSize: 11, color: C.faint, textAlign: 'center' }}>표시 가격은 참고용이며 심사·재고에 따라 변동될 수 있습니다.</div>
    </main>
  );
}
