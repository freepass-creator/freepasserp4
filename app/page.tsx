'use client';
import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { priceList, cheapestRent } from '@/lib/domain/product';
import { RENT_BANDS, DEP_BANDS, MILE_BANDS, FUELS, PTYPES, CREDITS, DYN, aggregateDyn, matchProduct, activeCount, operatingMonths, type FState } from '@/lib/domain/product-filters';
import { ProductCard } from '@/components/ProductCard';
import { ProductRowCard } from '@/components/ProductRowCard';
import { won, C } from '@/components/ui';

const SORTS = [{ k: 'asc', label: '대여료 낮은순' }, { k: 'desc', label: '대여료 높은순' }, { k: 'new', label: '최신 연식순' }];
const VIEWS = [{ k: 'card', label: '카드' }, { k: 'list', label: '리스트' }, { k: 'excel', label: '엑셀' }];
const R = 4;

function chip(on: boolean): CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 9px', fontSize: 11.5, fontWeight: on ? 700 : 500, cursor: 'pointer', borderRadius: R, border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brand : '#fff', color: on ? '#fff' : C.mute, whiteSpace: 'nowrap' };
}
const toggle = (set: Dispatch<SetStateAction<Set<string>>>) => (k: string) => set((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

// 접이식 필터 그룹 + 섹션별 적용 개수 뱃지
function Group({ title, count, defaultOpen = true, first = false, children }: { title: string; count: number; defaultOpen?: boolean; first?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${C.line2}` }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '9px 0', background: 'none', border: 'none', cursor: 'pointer' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.mute, letterSpacing: '0.03em' }}>{title}</span>
        {count > 0 && <span style={{ fontSize: 9.5, fontWeight: 800, color: '#fff', background: C.brand, borderRadius: 999, padding: '0 5px', height: 14, display: 'inline-flex', alignItems: 'center' }}>{count}</span>}
        <span style={{ flex: 1 }} />
        <ChevronDown size={15} color={C.faint} style={{ flex: '0 0 auto', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .12s' }} />
      </button>
      {open && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingBottom: 10 }}>{children}</div>}
    </div>
  );
}

// 원자화 — 세로 구분선 없이 헤더 밑줄 1줄 + 제브라로만 구분(라인 최소화).
const th: CSSProperties = { padding: '7px 10px', textAlign: 'left', fontSize: 11.5, color: '#33415a', fontWeight: 700, background: C.head, borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 };
const td: CSSProperties = { padding: '6px 10px', fontSize: 12, whiteSpace: 'nowrap', color: C.ink };
const tdR: CSSProperties = { ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 };

export default function Finder() {
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState(0); // 0 = 전체
  const [rent, setRent] = useState<Set<string>>(new Set());
  const [dep, setDep] = useState<Set<string>>(new Set());
  const [mile, setMile] = useState<Set<string>>(new Set());
  const [fuel, setFuel] = useState<Set<string>>(new Set());
  const [ptype, setPtype] = useState<Set<string>>(new Set());
  const [credit, setCredit] = useState<Set<string>>(new Set());
  const [dyn, setDyn] = useState<Record<string, Set<string>>>({});
  const [sort, setSort] = useState('asc');
  const [view, setViewState] = useState('card');
  const [fopen, setFopen] = useState(false);
  const co = getCompanyId();
  const router = useRouter();
  // 보기모드 = 새로고침해도 유지(localStorage). 서버·최초렌더는 'card' → effect에서 복원(하이드레이션 mismatch 방지).
  const setView = (v: string) => { setViewState(v); if (typeof window !== 'undefined') localStorage.setItem('fp4_finder_view', v); };

  useEffect(() => { (async () => { await seedIfEmpty(co); setRows(await getStore().list('product', co)); })(); const v = typeof window !== 'undefined' ? localStorage.getItem('fp4_finder_view') : null; if (v) setViewState(v); /* eslint-disable-next-line */ }, []);

  const s: FState = { q, period, rent, dep, mile, fuel, ptype, credit, dyn };
  const agg = useMemo(() => aggregateDyn(rows || []), [rows]);
  const months = useMemo(() => operatingMonths(rows || []), [rows]);
  const list = useMemo(() => {
    const l = (rows || []).filter((p) => matchProduct(p, s));
    l.sort((a, b) => sort === 'new' ? Number(b.year || 0) - Number(a.year || 0) : (sort === 'asc' ? 1 : -1) * (cheapestRent(a) - cheapestRent(b)));
    return l;
    // eslint-disable-next-line
  }, [rows, q, period, rent, dep, mile, fuel, ptype, credit, dyn, sort]);

  if (!rows) return <div style={{ padding: 40, color: C.faint }}>불러오는 중…</div>;

  const toggleDyn = (key: string, v: string) => setDyn((p) => { const cur = new Set(p[key] || []); cur.has(v) ? cur.delete(v) : cur.add(v); return { ...p, [key]: cur }; });
  const reset = () => { setPeriod(0); setRent(new Set()); setDep(new Set()); setMile(new Set()); setFuel(new Set()); setPtype(new Set()); setCredit(new Set()); setDyn({}); };
  const ac = activeCount(s) + (period ? 1 : 0);
  const shown = list.slice(0, 300);
  const go = (p: EntityRecord) => router.push(`/m/${encodeURIComponent(String(p.product_code))}`);

  const Sidebar = (
    <div style={{ padding: '12px 14px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>조건 검색{ac ? ` · ${ac}` : ''}</span>
        <span style={{ fontSize: 12, color: C.mute }}>총 <b style={{ color: C.ink, fontSize: 14 }}>{list.length.toLocaleString()}</b>대</span>
        <span style={{ flex: 1 }} />
        {ac > 0 && <button onClick={reset} style={{ border: 'none', background: 'none', color: C.accent, fontSize: 12, cursor: 'pointer' }}>초기화</button>}
        <button className="fp-filter-btn" onClick={() => setFopen(false)} style={{ height: 26, padding: '0 10px', border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', fontSize: 12, cursor: 'pointer' }}>닫기</button>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="차량명·차번·제조사" inputMode="search"
        style={{ width: '100%', height: 34, boxSizing: 'border-box', padding: '0 12px', fontSize: 13, borderRadius: R, border: `1px solid ${C.line}`, background: '#fff', marginBottom: 2 }} />
      <Group title="기간 (운영)" count={period ? 1 : 0} defaultOpen first>
        <button onClick={() => setPeriod(0)} style={chip(period === 0)}>전체</button>
        {months.map((m) => <button key={m} onClick={() => setPeriod(m)} style={chip(period === m)}>{m}개월</button>)}
      </Group>
      <Group title="월대여료" count={rent.size} defaultOpen>{RENT_BANDS.map((b) => <button key={b.k} onClick={() => toggle(setRent)(b.k)} style={chip(rent.has(b.k))}>{b.label}</button>)}</Group>
      <Group title="보증금" count={dep.size} defaultOpen>{DEP_BANDS.map((b) => <button key={b.k} onClick={() => toggle(setDep)(b.k)} style={chip(dep.has(b.k))}>{b.label}</button>)}</Group>
      <Group title="심사" count={credit.size} defaultOpen>{CREDITS.map((c) => <button key={c} onClick={() => toggle(setCredit)(c)} style={chip(credit.has(c))}>{c}</button>)}</Group>
      <Group title="상품구분" count={ptype.size} defaultOpen>{PTYPES.map((t) => <button key={t} onClick={() => toggle(setPtype)(t)} style={chip(ptype.has(t))}>{t}</button>)}</Group>
      <Group title="연료" count={fuel.size} defaultOpen={false}>{FUELS.map((t) => <button key={t} onClick={() => toggle(setFuel)(t)} style={chip(fuel.has(t))}>{t}</button>)}</Group>
      <Group title="주행거리" count={mile.size} defaultOpen={false}>{MILE_BANDS.map((b) => <button key={b.k} onClick={() => toggle(setMile)(b.k)} style={chip(mile.has(b.k))}>{b.label}</button>)}</Group>
      {DYN.map((d) => (
        <Group key={d.key} title={d.label} count={dyn[d.key]?.size || 0} defaultOpen={false}>
          {(agg[d.key] || []).map(([v, c]) => <button key={v} onClick={() => toggleDyn(d.key, v)} style={chip(dyn[d.key]?.has(v) || false)}>{v} {c}</button>)}
        </Group>
      ))}
    </div>
  );

  return (
    <div className="fp-finder">
      <aside className={`fp-sidebar${fopen ? ' is-open' : ''}`}>{Sidebar}</aside>

      <section style={{ padding: '12px 16px 40px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="fp-filter-btn" onClick={() => setFopen(true)} style={{ height: 32, padding: '0 12px', borderRadius: R, border: `1px solid ${C.line}`, background: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>필터{ac ? ` ${ac}` : ''}</button>
          <div style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden' }}>
            {VIEWS.map((v) => <button key={v.k} onClick={() => setView(v.k)} style={{ height: 32, padding: '0 14px', fontSize: 12.5, fontWeight: view === v.k ? 700 : 500, cursor: 'pointer', border: 'none', borderLeft: v.k !== 'card' ? `1px solid ${C.line}` : 'none', background: view === v.k ? C.brand : '#fff', color: view === v.k ? '#fff' : C.mute }}>{v.label}</button>)}
          </div>
          <span style={{ fontSize: 12.5, color: C.mute }}><b style={{ color: C.ink }}>{list.length.toLocaleString()}대</b></span>
          <span style={{ flex: 1 }} />
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ height: 32, borderRadius: R, border: `1px solid ${C.line}`, padding: '0 10px', fontSize: 12.5, background: '#fff', color: C.ink }}>
            {SORTS.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
          </select>
        </div>

        {list.length === 0 ? <div style={{ padding: 48, textAlign: 'center', color: C.faint, marginTop: 14 }}>조건에 맞는 차량이 없습니다</div> :
          view === 'card' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14, marginTop: 14 }}>
              {shown.map((p, i) => <ProductCard key={i} p={p} />)}
            </div>
          ) : view === 'list' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              {shown.map((p, i) => <ProductRowCard key={i} p={p} period={period} />)}
            </div>
          ) : (
            <div style={{ marginTop: 12, overflow: 'auto', background: '#fff' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5 }}>
                <thead><tr>{['차량상태', '상품분류', '차량번호', '제조사', '모델', '파워트레인', '세부트림', '연료', ...months.map((m) => `${m}개월`)].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
                <tbody>{shown.map((p, i) => { const pl = priceList(p); return (
                  <tr key={i} onClick={() => go(p)} style={{ cursor: 'pointer', background: i % 2 ? C.zebra : '#fff' }}>
                    <td style={td}>{String(p.vehicle_status || '')}</td>
                    <td style={td}>{String(p.product_type || '')}</td>
                    <td style={td}>{String(p.car_number || '')}</td>
                    <td style={td}>{String(p.maker || '')}</td>
                    <td style={td}>{String(p.model || '')}</td>
                    <td style={td}>{String(p.variant || '')}</td>
                    <td style={td}>{String(p.trim_name || '')}</td>
                    <td style={td}>{String(p.fuel_type || '')}</td>
                    {months.map((m) => { const e = pl.find((x) => x.m === m); return (
                      <td key={m} style={{ ...tdR, lineHeight: 1.25 }}>
                        {e ? <><div style={{ color: C.brand, fontWeight: 800 }}>{won(e.rent)}</div><div style={{ fontSize: 10, color: C.faint, fontWeight: 400 }}>보증 {e.deposit ? won(e.deposit) : '0'}</div></> : <span style={{ color: C.faint }}>—</span>}
                      </td>
                    ); })}
                  </tr>
                ); })}</tbody>
              </table>
            </div>
          )}
        {list.length > shown.length && <div style={{ marginTop: 12, fontSize: 12, color: C.faint }}>외 {(list.length - shown.length).toLocaleString()}대 — 조건을 좁혀주세요</div>}
      </section>
    </div>
  );
}
