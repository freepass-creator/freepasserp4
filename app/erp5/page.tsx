'use client';

import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowUpRight, CarFront, Check, ChevronDown, ChevronRight, ClipboardCheck,
  FileSignature, Gauge, LayoutDashboard, Menu, Rows3, SlidersHorizontal, WalletCards, X,
} from 'lucide-react';
import { useAuthReady, useSession } from '@/lib/auth-context';
import { getCompanyId } from '@/lib/tenant';
import type { EntityRecord } from '@/lib/intake/entities';
import { organizationRole } from '@/lib/domain/authorization';
import {
  benefitSignals, canonProductType, cheapest, creditDisplay, isOfferableProduct,
  isStockedProduct, priceList, vehicleName,
} from '@/lib/domain/product';
import {
  DEP_BANDS, MILE_BANDS, RENT_BANDS, hasPerk, type Band,
} from '@/lib/domain/product-filters';
import { matchHay } from '@/lib/domain/search';
import { useFinderData } from '@/features/finder/useFinderData';
import { useProductPhotoState } from '@/components/use-product-photos';
import { PRODUCT_SHEET_URL } from '@/lib/product-sheet';
import { Btn, FS, FW, ICON, NUM, SearchInput } from '@/components/ui';
import styles from './workspace.module.css';

const PAGE_SIZE = 30;
const QUICK_DEFAULT = ['age21', 'noDeposit', 'installment', 'rent', 'deposit', 'year', 'mileage', 'maker', 'model'] as const;
type QuickKey = typeof QUICK_DEFAULT[number];
type Filters = {
  status: string; period: number; rent: string; deposit: string; year: string; mileage: string;
  maker: string; model: string; productType: string; fuel: string; vehicleClass: string;
  age21: boolean; noDeposit: boolean; installment: boolean;
};

const EMPTY_FILTERS: Filters = {
  status: '', period: 0, rent: '', deposit: '', year: '', mileage: '', maker: '', model: '',
  productType: '', fuel: '', vehicleClass: '', age21: false, noDeposit: false, installment: false,
};
const QUICK_LABEL: Record<QuickKey, string> = {
  age21: '만21세', noDeposit: '무보증', installment: '보증금분납', rent: '대여료', deposit: '보증금',
  year: '연식', mileage: '주행거리', maker: '제조사', model: '모델',
};
const YEAR_OPTIONS = [
  { key: 'new', label: '신차급' }, { key: '3', label: '3년 이내' }, { key: '5', label: '5년 이내' }, { key: '7', label: '7년 이내' },
];

const keyOf = (row: EntityRecord, fallback = 'product_code') => String(row._key || row[fallback] || '');
const S = (value: unknown, fallback = '—') => String(value || '').trim() || fallback;
const won = (value: unknown) => `${(Number(value) || 0).toLocaleString('ko-KR')}원`;
const km = (value: unknown) => {
  const raw = String(value || '').trim();
  const n = Number(raw.replace(/[^0-9.-]/g, ''));
  return raw && Number.isFinite(n) ? `${n.toLocaleString('ko-KR')}km` : raw || '주행 미입력';
};
const bandByKey = (bands: Band[], key: string) => bands.find((band) => band.k === key);
const withinBand = (value: number, band?: Band) => !band || (value > band.lo && value <= band.hi);

function NavItem({ href, icon, children, active = false }: { href: string; icon: React.ReactNode; children: React.ReactNode; active?: boolean }) {
  return <a href={href} className={`${styles.navItem} ${active ? styles.navActive : ''}`}>{icon}<span>{children}</span></a>;
}

function FilterChoices({ title, options, value, onChange }: {
  title: string; options: { key: string; label: string }[]; value: string; onChange: (value: string) => void;
}) {
  return <div className={styles.choiceGroup}><span>{title}</span><div>{options.map((option) => <Btn key={option.key} variant="bare" data-active={value === option.key ? 'true' : 'false'} onClick={() => onChange(value === option.key ? '' : option.key)}>{option.label}</Btn>)}</div></div>;
}

function QuickPopover({ kind, filters, setFilter, makers, models, onClose }: {
  kind: QuickKey; filters: Filters; setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  makers: string[]; models: string[]; onClose: () => void;
}) {
  const booleanKey = kind === 'age21' || kind === 'noDeposit' || kind === 'installment' ? kind : null;
  if (booleanKey) return <div className={styles.quickPopover}><div className={styles.quickPopoverHead}><strong>{QUICK_LABEL[kind]}</strong><Btn variant="bare" aria-label="닫기" onClick={onClose}><X size={ICON.sm} /></Btn></div><Btn full variant="bare" className={styles.binaryChoice} data-active={filters[booleanKey] ? 'true' : 'false'} onClick={() => { setFilter(booleanKey, !filters[booleanKey]); onClose(); }}><Check size={ICON.sm} /> 가능한 차량만 보기</Btn></div>;
  const options = kind === 'rent' ? RENT_BANDS : kind === 'deposit' ? DEP_BANDS : kind === 'mileage' ? MILE_BANDS : [];
  return <div className={styles.quickPopover}>
    <div className={styles.quickPopoverHead}><strong>{QUICK_LABEL[kind]}</strong><Btn variant="bare" aria-label="닫기" onClick={onClose}><X size={ICON.sm} /></Btn></div>
    {kind === 'rent' || kind === 'deposit' ? <FilterChoices title="계약기간" options={[0, 12, 24, 36, 48, 60].map((m) => ({ key: String(m), label: m ? `${m}개월` : '전체' }))} value={String(filters.period)} onChange={(value) => setFilter('period', Number(value))} /> : null}
    {options.length ? <FilterChoices title={QUICK_LABEL[kind]} options={options.map((band) => ({ key: band.k, label: band.label }))} value={String(filters[kind])} onChange={(value) => { setFilter(kind, value); onClose(); }} /> : null}
    {kind === 'year' ? <FilterChoices title="연식" options={YEAR_OPTIONS} value={filters.year} onChange={(value) => { setFilter('year', value); onClose(); }} /> : null}
    {kind === 'maker' ? <FilterChoices title="제조사" options={makers.map((name) => ({ key: name, label: name }))} value={filters.maker} onChange={(value) => { setFilter('maker', value); setFilter('model', ''); onClose(); }} /> : null}
    {kind === 'model' ? <FilterChoices title="모델" options={models.map((name) => ({ key: name, label: name }))} value={filters.model} onChange={(value) => { setFilter('model', value); onClose(); }} /> : null}
  </div>;
}

function ProductPhoto({ product }: { product: EntityRecord }) {
  const { photos, pending } = useProductPhotoState(product, 720);
  return <div className={styles.productPhoto} role="img" aria-label={`${vehicleName(product) || '차량'} 대표 사진`} style={photos[0] ? { backgroundImage: `url("${photos[0].replace(/"/g, '%22')}")` } : undefined}>
    {!photos[0] ? <span><CarFront size={32} /><small>{pending ? '사진 불러오는 중' : '사진 없음'}</small></span> : null}
    {photos.length > 1 ? <em>{photos.length}장</em> : null}
  </div>;
}

function ProductCard({ product, selected, onSelect }: { product: EntityRecord; selected: boolean; onSelect: () => void }) {
  const code = keyOf(product);
  const prices = priceList(product).sort((a, b) => a.m - b.m);
  const lowest = cheapest(product);
  const benefits = benefitSignals(product).map((item) => item.label);
  const conditions = [canonProductType(product.product_type), creditDisplay(product), ...benefits].filter((value) => value && value !== '미입력').slice(0, 7);
  return <article className={`${styles.productCard} ${selected ? styles.productCardSelected : ''}`}>
    <Btn variant="bare" className={styles.selectVehicle} aria-label={selected ? '비교 선택 해제' : '비교 차량 선택'} onClick={onSelect}>{selected ? <Check size={ICON.sm} /> : null}</Btn>
    <ProductPhoto product={product} />
    <div className={styles.productCardBody}>
      <section className={styles.vehicleBand}>
        <div className={styles.vehicleBandTop}><span className={styles.vehicleStatus}>{S(product.vehicle_status, '출고협의')}</span><strong>{vehicleName(product) || '차명 확인 필요'}</strong><span className={styles.provider}>{S(product.car_number, '번호 미정')} · {S(product.provider_name || product.provider_company_code, '공급사 미확인')}</span></div>
        <div className={styles.vehicleAtoms}>
          <span><b>제조사</b>{S(product.maker, '미입력')}</span><span><b>세부모델</b>{S(product.sub_model || product.model, '미입력')}</span><span><b>파워트레인</b>{S(product.variant || product.powertrain, '미입력')}</span><span><b>세부트림</b>{S(product.trim_name, '미입력')}</span><span><b>차종분류</b>{S(product.vehicle_class, '미입력')}</span><span><b>색상</b>{S(product.ext_color, '미입력')} / {S(product.int_color, '미입력')}</span><span><b>연식·주행</b>{S(product.year, '미입력')} · {km(product.mileage)}</span>
        </div>
      </section>
      <section className={styles.conditionBand}><span className={styles.bandLabel}>조건</span><div>{conditions.length ? conditions.map((condition) => <span key={condition}>{condition}</span>) : <span>조건 정보 없음</span>}</div></section>
      <section className={styles.priceBand}><span className={styles.bandLabel}>기간별 대여료</span><div className={styles.priceCells}>{prices.map((price) => <div key={price.m} data-lowest={lowest?.m === price.m && lowest.rent === price.rent ? 'true' : 'false'}><b>{price.m}개월</b><strong>월 {won(price.rent)}</strong><small>보증금 {won(price.deposit)}</small></div>)}</div></section>
      <footer className={styles.productActions}><a href={`/erp5/products/${encodeURIComponent(code)}`}>차량 상세 <ChevronRight size={ICON.sm} /></a><a href={`/erp5/esign?product=${encodeURIComponent(code)}`} className={styles.contractAction}>이 차량으로 계약 <ArrowUpRight size={ICON.sm} /></a></footer>
    </div>
  </article>;
}

export default function Erp5ProductFinder() {
  const companyId = getCompanyId();
  const authReady = useAuthReady();
  const session = useSession();
  const role = organizationRole(session);
  const { rows, hiddenCodes } = useFinderData({ companyId, authReady, sessionUid: session?.uid });
  const isProvider = role === 'admin' || role?.startsWith('provider');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openQuick, setOpenQuick] = useState<QuickKey | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [quickKeys, setQuickKeys] = useState<QuickKey[]>(() => [...QUICK_DEFAULT]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('erp5.quick-filters.v1') || 'null') as QuickKey[] | null;
      if (saved?.length) setQuickKeys(QUICK_DEFAULT.filter((key) => saved.includes(key)));
    } catch { /* personal preference is optional */ }
  }, []);
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  useEffect(() => { setLimit(PAGE_SIZE); }, [query, filters]);

  const stock = useMemo(() => (rows || []).filter((row) => {
    const code = keyOf(row);
    const visible = isProvider ? isStockedProduct(row) : isOfferableProduct(row);
    return visible && !(code && hiddenCodes.has(code));
  }), [hiddenCodes, isProvider, rows]);
  const makers = useMemo(() => [...new Set(stock.map((row) => String(row.maker || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')).slice(0, 20), [stock]);
  const models = useMemo(() => [...new Set(stock.filter((row) => !filters.maker || String(row.maker || '') === filters.maker).map((row) => String(row.sub_model || row.model || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')).slice(0, 30), [filters.maker, stock]);
  const productTypes = useMemo(() => [...new Set(stock.map((row) => canonProductType(row.product_type)).filter(Boolean))], [stock]);
  const fuels = useMemo(() => [...new Set(stock.map((row) => String(row.fuel_type || '').trim()).filter(Boolean))].slice(0, 12), [stock]);
  const classes = useMemo(() => [...new Set(stock.map((row) => String(row.vehicle_class || '').trim()).filter(Boolean))].slice(0, 16), [stock]);

  const products = useMemo(() => stock.filter((product) => {
    if (deferredQuery && !matchHay([vehicleName(product), product.car_number, product.maker, product.model, product.sub_model, product.variant, product.trim_name, product.options, product.provider_name].join(' '), deferredQuery)) return false;
    if (filters.status && String(product.vehicle_status || '') !== filters.status) return false;
    if (filters.maker && String(product.maker || '') !== filters.maker) return false;
    if (filters.model && String(product.sub_model || product.model || '') !== filters.model) return false;
    if (filters.productType && canonProductType(product.product_type) !== filters.productType) return false;
    if (filters.fuel && String(product.fuel_type || '') !== filters.fuel) return false;
    if (filters.vehicleClass && String(product.vehicle_class || '') !== filters.vehicleClass) return false;
    if (filters.age21 && !hasPerk(product, '만21세')) return false;
    if (filters.noDeposit && !hasPerk(product, '무보증')) return false;
    if (filters.installment && !hasPerk(product, '분납가능')) return false;
    const prices = priceList(product).filter((price) => !filters.period || price.m === filters.period);
    if (filters.period && !prices.length) return false;
    if (filters.rent && !prices.some((price) => withinBand(price.rent, bandByKey(RENT_BANDS, filters.rent)))) return false;
    if (filters.deposit && !prices.some((price) => withinBand(price.deposit, bandByKey(DEP_BANDS, filters.deposit)))) return false;
    if (filters.mileage && !withinBand(Number(product.mileage) || 0, bandByKey(MILE_BANDS, filters.mileage))) return false;
    if (filters.year) {
      const year = Number(String(product.year || '').match(/\d{4}/)?.[0] || 0);
      const current = new Date().getFullYear();
      if (!year || (filters.year === 'new' ? year < current : year < current - Number(filters.year))) return false;
    }
    return true;
  }), [deferredQuery, filters, stock]);

  const activeCount = Object.entries(filters).filter(([, value]) => value !== '' && value !== 0 && value !== false).length;
  const toggleSelected = (code: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(code)) next.delete(code); else if (next.size < 5) next.add(code);
    return next;
  });
  const toggleQuickKey = (key: QuickKey) => {
    setQuickKeys((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      try { localStorage.setItem('erp5.quick-filters.v1', JSON.stringify(next)); } catch { /* personal preference is optional */ }
      return next;
    });
  };
  const quickValue = (key: QuickKey) => {
    if (key === 'age21' || key === 'noDeposit' || key === 'installment') return filters[key] ? '가능' : '';
    const value = filters[key];
    if (!value) return '';
    if (key === 'rent') return bandByKey(RENT_BANDS, value)?.label || '';
    if (key === 'deposit') return bandByKey(DEP_BANDS, value)?.label || '';
    if (key === 'mileage') return bandByKey(MILE_BANDS, value)?.label || '';
    if (key === 'year') return YEAR_OPTIONS.find((option) => option.key === value)?.label || '';
    return String(value);
  };
  const rootStyle = {
    '--e5-fs-page': `${FS.page}px`, '--e5-fs-title': `${FS.title}px`, '--e5-fs-body': `${FS.body}px`, '--e5-fs-sub': `${FS.sub}px`, '--e5-fs-cap': `${FS.cap}px`, '--e5-fw-head': FW.head, '--e5-fw-title': FW.title, '--e5-fw-strong': FW.strong, '--e5-num': NUM,
  } as CSSProperties;

  return <div className={styles.workspace} style={rootStyle}>
    <main className={styles.main}>
      <header className={styles.finderHeader}><div className={styles.finderTitle}><Btn variant="bare" className={styles.menuButton} aria-label={menuOpen ? '업무 메뉴 닫기' : '업무 메뉴 열기'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={ICON.md} /> : <Menu size={ICON.md} />}</Btn><span className={styles.headerBrand}>T5</span><div><span>PRODUCT FINDER</span><h1>상품찾기</h1></div></div><div className={styles.finderSearch}><SearchInput value={query} onChange={setQuery} placeholder="차명, 차량번호, 옵션, 공급사 검색" full /></div><a href={PRODUCT_SHEET_URL} target="_blank" rel="noreferrer">구글 시트 <ArrowUpRight size={ICON.sm} /></a></header>
      <section className={styles.filterDock}>
        <div className={styles.quickFilters}>{quickKeys.map((key) => <div className={styles.quickFilterWrap} key={key}><Btn variant="bare" className={styles.quickFilter} data-active={quickValue(key) ? 'true' : 'false'} onClick={() => setOpenQuick(openQuick === key ? null : key)}>{QUICK_LABEL[key]}{quickValue(key) ? <b>{quickValue(key)}</b> : null}<ChevronDown size={ICON.sm} /></Btn>{openQuick === key ? <QuickPopover kind={key} filters={filters} setFilter={setFilter} makers={makers} models={models} onClose={() => setOpenQuick(null)} /> : null}</div>)}</div>
        <Btn variant="bare" className={styles.detailFilterButton} onClick={() => setDrawerOpen(true)}><SlidersHorizontal size={ICON.sm} /> 세부필터{activeCount ? <b>{activeCount}</b> : null}</Btn>
      </section>
      <div className={styles.finderContent}>
        <div className={styles.resultBar}><span><Rows3 size={ICON.sm} /> 조건에 맞는 차량 <b>{products.length.toLocaleString('ko-KR')}대</b></span>{activeCount ? <Btn variant="bare" onClick={() => setFilters(EMPTY_FILTERS)}>조건 초기화</Btn> : null}</div>
        <div className={styles.productList}>{rows == null ? <div className={styles.empty}>공급사 차량을 불러오는 중입니다.</div> : products.length ? products.slice(0, limit).map((product) => { const code = keyOf(product); return <ProductCard key={code} product={product} selected={selected.has(code)} onSelect={() => toggleSelected(code)} />; }) : <div className={styles.empty}>선택한 조건에 맞는 차량이 없습니다.</div>}</div>
        {limit < products.length ? <Btn full variant="bare" className={styles.loadMore} onClick={() => setLimit((value) => value + PAGE_SIZE)}>차량 더 보기</Btn> : null}
      </div>
      {drawerOpen ? <><Btn variant="bare" className={styles.drawerScrim} aria-label="세부필터 닫기" onClick={() => setDrawerOpen(false)}><span aria-hidden /></Btn><aside className={styles.filterDrawer} aria-label="세부필터"><header><div><span>FILTERS</span><h2>세부필터</h2></div><Btn variant="bare" aria-label="닫기" onClick={() => setDrawerOpen(false)}><X /></Btn></header><div className={styles.drawerBody}>
        <section><h3>빠른필터 구성</h3><div className={styles.filterCheckGrid}>{QUICK_DEFAULT.map((key) => <Btn key={key} variant="bare" data-active={quickKeys.includes(key) ? 'true' : 'false'} onClick={() => toggleQuickKey(key)}>{quickKeys.includes(key) ? <Check size={ICON.sm} /> : null}{QUICK_LABEL[key]}</Btn>)}</div></section>
        <section><h3>판매 상태</h3><FilterChoices title="출고상태" options={['즉시출고', '출고가능', '출고협의'].map((value) => ({ key: value, label: value }))} value={filters.status} onChange={(value) => setFilter('status', value)} /><FilterChoices title="상품구분" options={productTypes.map((value) => ({ key: value, label: value }))} value={filters.productType} onChange={(value) => setFilter('productType', value)} /></section>
        <section><h3>가격과 기간</h3><FilterChoices title="기간" options={[12, 24, 36, 48, 60].map((value) => ({ key: String(value), label: `${value}개월` }))} value={String(filters.period || '')} onChange={(value) => setFilter('period', Number(value))} /><FilterChoices title="대여료" options={RENT_BANDS.map((band) => ({ key: band.k, label: band.label }))} value={filters.rent} onChange={(value) => setFilter('rent', value)} /><FilterChoices title="보증금" options={DEP_BANDS.map((band) => ({ key: band.k, label: band.label }))} value={filters.deposit} onChange={(value) => setFilter('deposit', value)} /></section>
        <section><h3>차량</h3><FilterChoices title="제조사" options={makers.map((value) => ({ key: value, label: value }))} value={filters.maker} onChange={(value) => { setFilter('maker', value); setFilter('model', ''); }} /><FilterChoices title="모델" options={models.map((value) => ({ key: value, label: value }))} value={filters.model} onChange={(value) => setFilter('model', value)} /><FilterChoices title="연료" options={fuels.map((value) => ({ key: value, label: value }))} value={filters.fuel} onChange={(value) => setFilter('fuel', value)} /><FilterChoices title="차종분류" options={classes.map((value) => ({ key: value, label: value }))} value={filters.vehicleClass} onChange={(value) => setFilter('vehicleClass', value)} /><FilterChoices title="연식" options={YEAR_OPTIONS} value={filters.year} onChange={(value) => setFilter('year', value)} /><FilterChoices title="주행거리" options={MILE_BANDS.map((band) => ({ key: band.k, label: band.label }))} value={filters.mileage} onChange={(value) => setFilter('mileage', value)} /></section>
        <section><h3>우대조건</h3><div className={styles.filterCheckGrid}>{([['age21', '만21세'], ['noDeposit', '무보증'], ['installment', '보증금분납']] as const).map(([key, label]) => <Btn key={key} variant="bare" data-active={filters[key] ? 'true' : 'false'} onClick={() => setFilter(key, !filters[key])}>{filters[key] ? <Check size={ICON.sm} /> : null}{label}</Btn>)}</div></section>
      </div><footer><Btn variant="bare" onClick={() => setFilters(EMPTY_FILTERS)}>전체 초기화</Btn><Btn onClick={() => setDrawerOpen(false)}>{products.length.toLocaleString('ko-KR')}대 상품 보기</Btn></footer></aside></> : null}
      {menuOpen ? <><Btn variant="bare" className={styles.menuScrim} aria-label="메뉴 밖쪽 영역" onClick={() => setMenuOpen(false)}><span aria-hidden /></Btn><aside className={styles.menuDrawer} aria-label="ERP5 주요 메뉴"><nav className={styles.menuNav}><NavItem href="/erp5" active icon={<LayoutDashboard size={ICON.md} />}>상품찾기</NavItem><NavItem href="/erp5/contracts" icon={<ClipboardCheck size={ICON.md} />}>계약진행</NavItem><NavItem href="/erp5/settlements" icon={<WalletCards size={ICON.md} />}>정산확인</NavItem>{isProvider ? <NavItem href="/erp5/inventory" icon={<Gauge size={ICON.md} />}>재고관리</NavItem> : null}</nav><div className={styles.menuUser}><span className={styles.userAvatar}>{S(session?.name, '사').slice(0, 1)}</span><span><strong>{S(session?.name, '영업자')}</strong><small>{isProvider ? '관리 워크스페이스' : '영업 워크스페이스'}</small></span></div></aside></> : null}
      {selected.size ? <div className={styles.selectionBar}><span><b>{selected.size}대</b> 선택됨</span><Btn variant="bare" onClick={() => setSelected(new Set())}>선택 해제</Btn><a href={`/erp5/compare?products=${encodeURIComponent([...selected].join(','))}`}>비교하기</a><a href={`/erp5/proposal?products=${encodeURIComponent([...selected].join(','))}`}>고객에게 보내기 <ArrowUpRight size={ICON.sm} /></a></div> : null}
    </main>
  </div>;
}
