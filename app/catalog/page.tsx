'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { cheapestRent, creditDisplay, noDeposit } from '@/lib/domain/product';
import { useFirstPhoto } from '@/components/use-product-photos';
import { badges, Identity, SpecLine, PriceHero, CarGlyph } from '@/components/product-card-atoms';
import { RENT_BANDS } from '@/lib/domain/product-filters';
import { C, R, Loading, CenterNote, SearchInput, Select, ToggleChips } from '@/components/ui';
import { toggleInSet } from '@/lib/set';

// 카탈로그 카드 — 자체 href(/q 견적)라 ProductCard 대신 로컬. 훅으로 드라이브폴더 사진까지 해석.
function CatalogCard({ p, href }: { p: EntityRecord; href: string }) {
  const photo = useFirstPhoto(p);
  return (
    <Link href={href} style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', overflow: 'hidden', textDecoration: 'none', color: 'inherit', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: C.placeholder, overflow: 'hidden' }}>
        {photo
          ? <img src={photo} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
          : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CarGlyph size={46} /></span>}
        <span style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', gap: 4, flexWrap: 'wrap', zIndex: 1 }}>{badges(p, true)}</span>
      </div>
      <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <Identity p={p} size={14} />
        <SpecLine p={p} />
        <div style={{ marginTop: 'auto', borderTop: `1px solid ${C.line2}`, paddingTop: 8 }}><PriceHero p={p} /></div>
      </div>
    </Link>
  );
}

// 손님 공개 카탈로그(화이트라벨) — 영업 공유의 착지점. ERP 크롬 없음, 원가·수수료·코드 비공개.
// ?a={영업코드} = 영업 귀속 추적(첫 진입 시 지속 저장), 카드 → /q/{code}?a= 견적으로.
const PERKS = ['무보증', '무심사'] as const;

export default function Catalog() {
  const co = getCompanyId();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [attr, setAttr] = useState('');
  const [q, setQ] = useState('');
  const [rent, setRent] = useState('');
  const [perk, setPerk] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState('asc');

  useEffect(() => { (async () => {
    await seedIfEmpty(co);
    const a = typeof window !== 'undefined' ? (new URLSearchParams(location.search).get('a') || localStorage.getItem('fp4_attr') || '') : '';
    if (a && typeof window !== 'undefined') localStorage.setItem('fp4_attr', a);
    setAttr(a);
    const all = await getStore().list('product', co);
    // 공개 = 삭제·출고불가 제외 + 대여료 있는 매물만
    setRows(all.filter((p) => p._deleted !== true && String(p.vehicle_status) !== '출고불가' && cheapestRent(p) < Infinity));
  })(); /* eslint-disable-next-line */ }, []);

  const list = useMemo(() => {
    const l = (rows || []).filter((p) => {
      if (q && ![p.maker, p.model, p.sub_model, p.trim_name, p.fuel_type, p.vehicle_class].some((v) => v && String(v).toLowerCase().includes(q.toLowerCase()))) return false;
      if (rent) { const b = RENT_BANDS.find((x) => x.k === rent); const cr = cheapestRent(p); if (b && !(cr > b.lo && cr <= b.hi)) return false; }
      if (perk.has('무보증') && !noDeposit(p)) return false;
      if (perk.has('무심사') && creditDisplay(p) !== '무심사') return false;
      return true;
    });
    l.sort((a, b) => (sort === 'asc' ? 1 : -1) * (cheapestRent(a) - cheapestRent(b)));
    return l;
  }, [rows, q, rent, perk, sort]);

  const href = (p: EntityRecord) => `/q/${encodeURIComponent(String(p.product_code))}${attr ? `?a=${encodeURIComponent(attr)}` : ''}`;

  if (rows === null) return <Loading />;

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '18px 16px 28px' }}>
      <div style={{ fontSize: 12, color: C.mute, letterSpacing: '0.04em' }}>차량 렌탈</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '4px 0 12px' }}>조건별 차량 찾기</h1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <SearchInput value={q} onChange={setQ} placeholder="차량·제조사·연료" style={{ flex: '1 1 200px', minWidth: 180 }} />
        <Select value={rent} onChange={setRent} placeholder="월대여료 전체" options={RENT_BANDS.map((b) => ({ value: b.k, label: b.label }))} />
        <Select value={sort} onChange={setSort} options={[{ value: 'asc', label: '낮은 대여료순' }, { value: 'desc', label: '높은 대여료순' }]} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <ToggleChips selected={perk} onToggle={(k) => setPerk((p) => toggleInSet(p, k))} options={PERKS.map((pk) => ({ key: pk, label: pk }))} />
        <span style={{ fontSize: 12.5, color: C.mute }}>{list.length}대</span>
      </div>

      {list.length === 0 ? <CenterNote>조건에 맞는 차량이 없습니다.</CenterNote> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
          {list.map((p) => <CatalogCard key={String(p.product_code)} p={p} href={href(p)} />)}
        </div>
      )}
      <div style={{ marginTop: 20, fontSize: 11, color: C.faint, textAlign: 'center' }}>표시 가격은 참고용이며 심사·재고에 따라 변동될 수 있습니다.</div>
    </main>
  );
}
