'use client';
import { useEffect, useMemo, useState } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { cheapestRent, creditDisplay, isListableProduct, priceList } from '@/lib/domain/product';
import { matchProductQuery } from '@/lib/domain/search';
import { ProductCard } from '@/components/ProductCard';
import { RENT_BANDS, CREDITS, CATALOG_PERKS, hasPerk } from '@/lib/domain/product-filters';
import { Btn, C, FW, FS, CenterNote, SearchInput, Select, ToggleChips, ProductCardSkeleton } from '@/components/ui';
import { toggleInSet } from '@/lib/set';
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
 */

const PAGE = 100; // 파인더와 동일 — 첫 화면·더보기 단위

export default function Catalog() {
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [brand, setBrand] = useState('');
  const [attr, setAttr] = useState('');
  const [qInput, setQInput] = useState(''); // 검색창 즉시 반영
  const [q, setQ] = useState(''); // 디바운스된 검색
  const [rent, setRent] = useState('');
  const [credit, setCredit] = useState<Set<string>>(new Set());
  const [perks, setPerks] = useState<Set<string>>(new Set());
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
      const body = await res.json().catch(() => ({})) as { products?: EntityRecord[]; brand?: string };
      setRows(res.ok && body.products ? body.products : []);
      setBrand(String(body.brand || ''));
    } catch {
      setRows([]);
    }
  })(); /* eslint-disable-next-line */ }, []);

  // 검색 디바운스 — 타이핑마다 전량 filter/sort 방지(파인더 180ms와 동일)
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 180);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => { setLimit(PAGE); }, [q, rent, credit, perks, sort]);

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
      if (credit.size && !credit.has(creditDisplay(p))) return false;
      if (perks.size && ![...perks].every((pk) => hasPerk(p, pk))) return false;
      return true;
    });
    l.sort((a, b) => (sort === 'asc' ? 1 : -1) * (cheapestRent(a) - cheapestRent(b)));
    return l;
  }, [rows, q, rent, credit, perks, sort]);

  const shown = list.slice(0, limit);
  const moreCount = Math.max(0, list.length - shown.length);
  const href = (p: EntityRecord) => `/q/${encodeURIComponent(String(p.product_code))}${attr ? `?a=${encodeURIComponent(attr)}` : ''}`;

  if (rows === null) return <ProductCardSkeleton count={6} />;

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '18px 16px 28px' }}>
      {/* 화이트라벨 — ?p= 로 공급사를 지정하면 그 회사 이름이 머리글이 된다. */}
      <div style={{ fontSize: FS.sub, color: C.mute, letterSpacing: '0.04em' }}>{brand || '차량 렌탈'}</div>
      <h1 style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', margin: '4px 0 12px' }}>조건별 차량 찾기</h1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <SearchInput value={qInput} onChange={setQInput} placeholder="차번·차명·연료·옵션…" style={{ flex: '1 1 200px', minWidth: 180 }} />
        <Select value={rent} onChange={setRent} placeholder="월대여료 전체" options={RENT_BANDS.map((b) => ({ value: b.k, label: b.label }))} />
        <Select value={sort} onChange={setSort} options={[{ value: 'asc', label: '낮은 대여료순' }, { value: 'desc', label: '높은 대여료순' }]} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <ToggleChips selected={credit} onToggle={(k) => setCredit((p) => toggleInSet(p, k))} options={CREDITS.map((c) => ({ key: c, label: c }))} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <ToggleChips selected={perks} onToggle={(k) => setPerks((p) => toggleInSet(p, k))} options={CATALOG_PERKS.map((pk) => ({ key: pk, label: pk }))} />
        <span style={{ fontSize: FS.sub, color: C.mute }}>{list.length}대</span>
      </div>

      {list.length === 0 ? <CenterNote>조건에 맞는 차량이 없습니다.</CenterNote> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
            {shown.map((p) => <ProductCard key={String(p.product_code)} p={p} audience="customer" href={href(p)} />)}
          </div>
          {moreCount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <Btn
                title={`더보기 ${Math.min(PAGE, moreCount)}대`}
                variant="ghost"
                onClick={() => setLimit((n) => n + PAGE)}
              >
                {`더보기 · ${Math.min(PAGE, moreCount).toLocaleString()}대`}
              </Btn>
            </div>
          )}
        </>
      )}
      <div style={{ marginTop: 20, fontSize: FS.cap, color: C.faint, textAlign: 'center' }}>표시 가격은 참고용이며 심사·재고에 따라 변동될 수 있습니다.</div>
    </main>
  );
}
