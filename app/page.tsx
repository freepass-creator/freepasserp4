'use client';
import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGrid, List, Table, Download, SlidersHorizontal, Search, ArrowUpDown, History, Star } from 'lucide-react';
import { getStore, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { type EntityRecord } from '@/lib/intake/entities';
import { priceList, rentForSort, depositForSort, creditDisplay, vehicleTone, excelCondSignals, isHiddenFromCatalog, canonProductType, noDeposit } from '@/lib/domain/product';
import { fuelDisplay, yearDisplay, makerDisplay, parseYear } from '@/lib/domain/vehicle-master-match';
import { withProviderNames } from '@/lib/domain/identity';
import { DYN, CAR_DYN_KEYS, EXTRA_DYN_KEYS, aggregateDyn, matchProduct, activeCount, activeFilterHints, presentFilterOptions, excelMonths, operatingMonths, EMPTY_VEHICLE_FILTER, vehicleFilterCount, sortProviderOptions, type FState, type VehicleFilter } from '@/lib/domain/product-filters';
import { VehicleMasterFilter } from '@/components/VehicleMasterFilter';
import { ProductCard } from '@/components/ProductCard';
import { ProductRowCard } from '@/components/ProductRowCard';
import { productOptions, OptionChips } from '@/components/product-card-atoms';
import { InterestTriggers, InterestPanel, InterestSummaryCard, useInterestLists, useInterestTab, useInterestTabGuard } from '@/components/InterestRail';
import { clearRecent, clearFavs } from '@/lib/product-interest';
import { C, R, NUM, FW, FS, Loading, CenterNote, SearchInput, Select, FilterGroup, FilterChips, ToggleChips, Btn, IconBtn, IconSeg, Badge, CountPill, productTypeStyle, CREDIT_TONE, thX, thXR, thXPin, tdX, tdXR, tdXPin, colLock, colLockChars, colChars, colOpts, clipN, pinRight, EXCEL_W, EXCEL_MAX, EXCEL_CELL_BODY_H, EXCEL_BADGE_GAP_X, EXCEL_PRICE_COL, excelColMode, excelShowFilterCols, excelMakerChars, excelSubChars, excelNameChars, ContextMenu, useContextMenu } from '@/components/ui';
import type { BadgeTone } from '@/components/ui/badges';
import { man, kmDisplay } from '@/lib/format';
import { downloadProductsExcel } from '@/lib/excel-export';
import { useAuthReady, useSession } from '@/lib/auth-context';
import { firebaseReady } from '@/lib/firebase/client';
import { toggleInSet } from '@/lib/set';
import { toast } from '@/components/Toaster';
import { actor, getRole, ensureRoom, ROLE_LABEL } from '@/lib/domain/deal';
import { getSession, isGuest } from '@/lib/auth-session';
import { guestShareUrl, formatProductForCopy } from '@/lib/domain/product-share';
import type { CtxItem } from '@/components/ui/ContextMenu';
import { useAppBar } from '@/lib/appbar';
import { FILTER_SS, FINDER_RESET_LIMIT } from '@/lib/finder-session';
import { FinderStatus } from '@/components/FinderStatus';
import { BottomSheet } from '@/components/BottomSheet';
import { PageToolBar } from '@/components/PageToolBar';
import { listHiddenCodes, subscribeHidden } from '@/lib/product-hide';
import { listPassedCodes, subscribePassed } from '@/lib/product-pass';

/** 홈 모바일 툴 — 상단 툴바 버튼 → 아래에서 시트. */
type HomeTool = 'search' | 'sort' | 'filter' | 'recent' | 'fav';

const SORTS = [
  { k: 'asc', label: '대여료 낮은순', short: '대여↓' },
  { k: 'desc', label: '대여료 높은순', short: '대여↑' },
  { k: 'dep_asc', label: '보증금 낮은순', short: '보증↓' },
  { k: 'dep_desc', label: '보증금 높은순', short: '보증↑' },
  { k: 'mile_asc', label: '주행 짧은순', short: '주행↓' },
  { k: 'mile_desc', label: '주행 많은순', short: '주행↑' },
  { k: 'new', label: '연식 최신순', short: '연식↓' },
  { k: 'old', label: '연식 오래된순', short: '연식↑' },
];
// 카드 2종 = 밀도축. 웹 간단=ProductCard(격자·기간칩) / 웹·모바일 상세·모바일피드=ProductRowCard.
// 모바일 = 기간칩 나열 금지(앵커 1개만). 전기간은 /m.
const VIEWS = [{ k: 'card', label: '간단', Icon: LayoutGrid }, { k: 'list', label: '상세', Icon: List }, { k: 'excel', label: '엑셀', Icon: Table }];
const PAGE = 100; // 첫 화면·더보기 단위
const PAGE_HARD = 500; // 전체 보기 상한(가상스크롤 전 안전장치)
/** 필터·검색·정렬만 유지. limit(더보기/전체보기)는 절대 저장하지 않음. */

type SavedFinderFilters = {
  q: string;
  periods: number[];
  rent: string[]; dep: string[]; mile: string[]; fuel: string[];
  ptype: string[]; credit: string[]; perks: string[]; promo: string[];
  dyn: Record<string, string[]>;
  vehicle: VehicleFilter;
  sort: string;
};

function readSavedFilters(): SavedFinderFilters | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(FILTER_SS);
    if (!raw) return null;
    return JSON.parse(raw) as SavedFinderFilters;
  } catch { return null; }
}

function writeSavedFilters(s: SavedFinderFilters) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(FILTER_SS, JSON.stringify(s)); } catch { /* quota */ }
}

function clearSavedFilters() {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(FILTER_SS); } catch { /* */ }
}

function setFromArr(arr?: string[]) { return new Set(Array.isArray(arr) ? arr : []); }

function numOr(v: unknown, fallback: number) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

const DASH = <span style={{ color: C.faint }}>—</span>;

// 엑셀 헤더 필터·정렬 SSOT — 셀 표시값과 동일. 옵션·조건은 다중값(OR).
type ColSort = { field: string; dir: 'asc' | 'desc' } | null;

/** 필터 체크리스트·표시 문자열. */
function exColVal(p: EntityRecord, key: string): string {
  if (key === 'credit') return creditDisplay(p);
  if (key === 'fuel_type') return fuelDisplay(p.fuel_type) || '';
  if (key === 'maker') return makerDisplay(p.maker) || String(p.maker || '');
  if (key === 'year') return yearDisplay(p.year);
  if (key === 'mileage') return kmDisplay(p.mileage);
  if (key === 'options') return productOptions(p).join(' · ');
  if (key === 'cond') {
    const c = excelCondSignals(p);
    return c.length ? c.map((x) => x.label).join('·') : '조건없음';
  }
  if (key === 'provider_name') return String(p.provider_name || p.provider_company_code || '').trim();
  if (key === 'product_type') return canonProductType(p.product_type);
  if (key.startsWith('price:')) {
    const m = Number(key.slice(6));
    const e = priceList(p).find((x) => x.m === m);
    return e && e.rent > 0 ? man(e.rent) : '';
  }
  const v = (p as Record<string, unknown>)[key];
  if (v == null) return '';
  return String(v).trim();
}

/** 필터 매칭용 — 옵션·조건은 개별 뱃지/옵션 OR. */
function exColVals(p: EntityRecord, key: string): string[] {
  if (key === 'options') return productOptions(p);
  if (key === 'cond') {
    const c = excelCondSignals(p);
    return c.length ? c.map((x) => x.label) : ['조건없음'];
  }
  const v = exColVal(p, key);
  return v ? [v] : [];
}

function exColMatch(p: EntityRecord, key: string, set: Set<string>): boolean {
  if (!set.size) return true;
  return exColVals(p, key).some((v) => set.has(v));
}

/** 정렬용 — 숫자칸은 원값. */
function exColSortVal(p: EntityRecord, key: string): number | string {
  if (key.startsWith('price:')) {
    const m = Number(key.slice(6));
    return priceList(p).find((x) => x.m === m)?.rent ?? 0;
  }
  if (key === 'mileage') return Number(p.mileage) || 0;
  if (key === 'year') return parseYear(p.year);
  return exColVal(p, key);
}

function exColSortNum(key: string): boolean {
  return key.startsWith('price:') || key === 'mileage' || key === 'year';
}

function FilterPop({ field, x, y, rows, colFilter, setColFilter, colSort, setColSort, onClose }: {
  field: string; x: number; y: number; rows: EntityRecord[];
  colFilter: Record<string, Set<string>>; setColFilter: (f: Record<string, Set<string>>) => void;
  colSort: ColSort; setColSort: (s: ColSort) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const entries = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((p) => {
      for (const v of exColVals(p, field)) m.set(v, (m.get(v) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  }, [rows, field]);
  const sel = colFilter[field] || new Set<string>();
  const toggleV = (v: string) => { const n = new Set(sel); n.has(v) ? n.delete(v) : n.add(v); const nf = { ...colFilter }; if (n.size) nf[field] = n; else delete nf[field]; setColFilter(nf); };
  const setSort = (dir: 'asc' | 'desc') => setColSort(colSort && colSort.field === field && colSort.dir === dir ? null : { field, dir });
  const isS = (dir: string) => !!colSort && colSort.field === field && colSort.dir === dir;
  const shown = entries.filter(([k]) => !q || k.toLowerCase().includes(q.toLowerCase()));
  const canSort = exColSortNum(field); // 오름·내림 = 숫자칸만(연식·주행·대여료)
  const rowPad = { padding: '6px 10px', fontSize: FS.sub, cursor: 'pointer' as const, display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', width: '100%', boxSizing: 'border-box' as const, textAlign: 'left' as const, fontFamily: 'inherit' };
  return (<>
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
    <div style={{
      position: 'fixed', top: y + 2,
      left: Math.max(6, Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 226)),
      width: 220, background: C.taupeBg, border: `1px solid ${C.line}`, borderRadius: R,
      boxShadow: '0 8px 24px rgba(15,23,42,0.14)', zIndex: 91, textAlign: 'left', fontWeight: FW.body,
    }}>
      {canSort && (
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.line2}` }}>
          {(['asc', 'desc'] as const).map((dir) => (
            <Btn
              key={dir}
              variant="bare"
              onClick={() => setSort(dir)}
              style={{
                ...rowPad, flex: 1, justifyContent: 'center',
                fontWeight: isS(dir) ? FW.head : FW.meta,
                color: isS(dir) ? C.brand : C.mute,
                background: isS(dir) ? C.selected : 'transparent',
              }}
            >{dir === 'asc' ? '↑ 오름' : '↓ 내림'}</Btn>
          ))}
        </div>
      )}
      <div style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line2}` }}>
        <SearchInput value={q} onChange={setQ} placeholder="검색…" full />
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
        {shown.length === 0 ? (
          <div style={{ ...rowPad, color: C.faint, cursor: 'default' }}>값 없음</div>
        ) : shown.map(([k, cnt]) => {
          const on = sel.has(k);
          return (
            <Btn
              key={k}
              variant="bare"
              onClick={() => toggleV(k)}
              style={{
                ...rowPad,
                background: on ? C.selected : 'transparent',
                color: C.ink,
                fontWeight: on ? FW.head : FW.meta,
              }}
            >
              <span style={{ flex: '0 0 14px', fontFamily: NUM, color: on ? C.brand : C.faint, fontSize: FS.sub }}>{on ? '✓' : ''}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{k}</span>
              <span style={{ flex: '0 0 auto', fontFamily: NUM, color: C.faint, fontSize: FS.cap }}>{cnt}</span>
            </Btn>
          );
        })}
      </div>
      <div style={{ display: 'flex', borderTop: `1px solid ${C.line2}` }}>
        <Btn
          variant="bare"
          onClick={() => { const nf = { ...colFilter }; delete nf[field]; setColFilter(nf); }}
          style={{ ...rowPad, flex: 1, justifyContent: 'center', color: C.mute }}
        >초기화</Btn>
        <Btn
          variant="bare"
          onClick={onClose}
          style={{ ...rowPad, flex: 1, justifyContent: 'center', color: C.brand, fontWeight: FW.strong, borderLeft: `1px solid ${C.line2}` }}
        >닫기</Btn>
      </div>
    </div>
  </>);
}

export default function Finder() {
  const [rows, setRows] = useState<EntityRecord[] | null>(() => peekList('product', getCompanyId()));
  const [qInput, setQInput] = useState(''); // 검색창 즉시 반영
  const [q, setQ] = useState(''); // 디바운스된 검색(필터)
  const [periods, setPeriods] = useState<Set<number>>(new Set()); // 운영개월 복수선택(빈=전체)
  const [rent, setRent] = useState<Set<string>>(new Set());
  const [dep, setDep] = useState<Set<string>>(new Set());
  const [mile, setMile] = useState<Set<string>>(new Set());
  const [fuel, setFuel] = useState<Set<string>>(new Set());
  const [ptype, setPtype] = useState<Set<string>>(new Set());
  const [credit, setCredit] = useState<Set<string>>(new Set());
  const [perks, setPerks] = useState<Set<string>>(new Set());
  const [promo, setPromo] = useState<Set<string>>(new Set());
  const [dyn, setDyn] = useState<Record<string, Set<string>>>({});
  const [vehicle, setVehicle] = useState<VehicleFilter>({ ...EMPTY_VEHICLE_FILTER });
  const [models, setModels] = useState<Set<string>>(() => new Set()); // 인기차종 빠른필터(모델명)
  const [sort, setSort] = useState('');
  const [view, setViewState] = useState('card');
  const [homeTool, setHomeTool] = useState<HomeTool | null>(null); // 모바일 하단 시트
  const [hiddenCodes, setHiddenCodes] = useState<Set<string>>(() => new Set());
  const [passedCodes, setPassedCodes] = useState<Set<string>>(() => new Set());
  const [filterOpen, setFilterOpenState] = useState(true); // 웹 사이드바 필터 표시
  const setFilterOpen = (v: boolean) => {
    setFilterOpenState(v);
    if (typeof window !== 'undefined') localStorage.setItem('fp4_finder_filter', v ? '1' : '0');
  };
  const [colFilter, setColFilter] = useState<Record<string, Set<string>>>({}); // 엑셀 헤더 필터
  const [colSort, setColSort] = useState<ColSort>(null);
  const [openCol, setOpenCol] = useState<{ field: string; x: number; y: number } | null>(null);
  const [limit, setLimit] = useState(PAGE); // 목록·엑셀 공통 페이징(더보기)
  const [interestTab, setInterestTab] = useInterestTab();
  const { recent: interestRecent, favs: interestFavs } = useInterestLists();
  useInterestTabGuard(interestTab, setInterestTab, interestRecent.length, interestFavs.length);

  useEffect(() => {
    const refreshH = () => setHiddenCodes(new Set(listHiddenCodes()));
    const refreshP = () => setPassedCodes(new Set(listPassedCodes()));
    refreshH();
    refreshP();
    const offH = subscribeHidden(refreshH);
    const offP = subscribePassed(refreshP);
    return () => { offH(); offP(); };
  }, []);

  const toggleHomeTool = useCallback((t: HomeTool) => {
    haptic.select();
    setHomeTool((cur) => (cur === t ? null : t));
  }, []);

  const closeHomeTool = useCallback(() => setHomeTool(null), []);

  // 상단바 탭 = 시트 닫고 목록 맨 위(새로 온 느낌)
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail !== '/') return;
      setHomeTool(null);
      setInterestTab(null);
    };
    window.addEventListener('fp:page-refresh', on);
    return () => window.removeEventListener('fp:page-refresh', on);
  }, [setInterestTab]);

  const finderMainRef = useRef<HTMLElement>(null);
  const finderBodyRef = useRef<HTMLDivElement>(null);
  const productCtx = useContextMenu<EntityRecord>();
  const co = getCompanyId();
  const router = useRouter();
  const mobile = useIsMobile();
  const authReady = useAuthReady();
  const session = useSession(); // 로그인 순간 매물 재조회 트리거(uid 변화 → 아래 로드 effect 재실행)
  // 보기모드 = 새로고침해도 유지(localStorage). 서버·최초렌더는 'card' → effect에서 복원(하이드레이션 mismatch 방지).
  const setView = (v: string) => { setViewState(v); if (typeof window !== 'undefined') localStorage.setItem('fp4_finder_view', v); };
  // 엑셀보기 = 넓은 화면 전용 배열. 모바일은 미제공(뷰에서 숨김) → 같은 원자를 카드 배열로. 엑셀 '다운로드'는 유지.
  const views = mobile ? VIEWS.filter((v) => v.k === 'card') : VIEWS; // 모바일=카드 단일뷰(v3 규격) — 토글 대신 정렬·본거·찜
  const effView = mobile ? 'card' : view;

  // 필터·정렬 복원(세션). 상세 다녀오면 limit만 PAGE(필터 유지).
  useEffect(() => {
    const saved = readSavedFilters();
    if (saved) {
      setQInput(saved.q || '');
      setQ(saved.q || '');
      setPeriods(new Set((saved.periods || []).map(Number).filter((n) => Number.isFinite(n))));
      setRent(setFromArr(saved.rent));
      setDep(setFromArr(saved.dep));
      setMile(setFromArr(saved.mile));
      setFuel(setFromArr(saved.fuel));
      setPtype(setFromArr(saved.ptype));
      setCredit(setFromArr(saved.credit));
      setPerks(setFromArr(saved.perks));
      setPromo(setFromArr(saved.promo));
      const dynNext: Record<string, Set<string>> = {};
      for (const [k, arr] of Object.entries(saved.dyn || {})) dynNext[k] = setFromArr(arr);
      setDyn(dynNext);
      setVehicle({ ...EMPTY_VEHICLE_FILTER, ...(saved.vehicle || {}) });
      setSort(saved.sort || '');
    }
  }, []);

  // 상세→홈 복귀 시 더보기/전체보기만 리셋(마운트·소프트백·포커스)
  useEffect(() => {
    const apply = () => {
      try {
        if (!sessionStorage.getItem(FINDER_RESET_LIMIT)) return;
        sessionStorage.removeItem(FINDER_RESET_LIMIT);
        setLimit(PAGE);
      } catch { /* */ }
    };
    apply();
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) apply(); };
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', apply);
    window.addEventListener('fp:finder-reset-limit', apply);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', apply);
      window.removeEventListener('fp:finder-reset-limit', apply);
    };
  }, []);

  // 필터 저장 — 마운트 직후 빈값으로 세션을 덮지 않음(첫 effect skip)
  const filterSaveSkip = useRef(true);
  useEffect(() => {
    if (filterSaveSkip.current) { filterSaveSkip.current = false; return; }
    writeSavedFilters({
      q, periods: [...periods],
      rent: [...rent], dep: [...dep], mile: [...mile], fuel: [...fuel],
      ptype: [...ptype], credit: [...credit], perks: [...perks], promo: [...promo],
      dyn: Object.fromEntries(Object.entries(dyn).map(([k, set]) => [k, [...set]])),
      vehicle, sort,
    });
  }, [q, periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle, sort]);

  // 검색 디바운스 — 타이핑마다 전량 filter/sort 방지
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 180);
    return () => clearTimeout(t);
  }, [qInput]);

  // RTDB는 인증 토큰 attach 전에 get()하면 영구 pending → "불러오는 중" 고정.
  // firebase 활성 시 authReady 이후에만 list. 15s 타임아웃으로 절대 스피너에 안 갇힘.
  useEffect(() => {
    if (firebaseReady() && !authReady) return;
    let alive = true;
    (async () => {
      try { await seedIfEmpty(co); } catch (e) { console.warn('[finder] 시드 실패(계속):', e); }
      try {
        const timed = <T,>(p: Promise<T>) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('finder list timeout')), 15000))]);
        const [prods, partners] = await timed(Promise.all([getStore().list('product', co), getStore().list('partner', co)]));
        if (!alive) return;
        setRows(withProviderNames(prods, partners));
      } catch (e) { console.warn('[finder] 매물 로드 실패:', e); if (alive) setRows([]); }
    })();
    const v = typeof window !== 'undefined' ? localStorage.getItem('fp4_finder_view') : null; if (v) setViewState(v);
    const f = typeof window !== 'undefined' ? localStorage.getItem('fp4_finder_filter') : null;
    if (f === '0') setFilterOpenState(false);
    return () => { alive = false; };
  }, [authReady, co, session?.uid]);

  const s: FState = { q, periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle };
  const agg = useMemo(() => aggregateDyn(rows || []), [rows]);
  const months = useMemo(() => excelMonths(rows || []), [rows]);
  const present = useMemo(() => presentFilterOptions(rows || []), [rows]);
  // 제조사스펙 집계 모수 = 스펙 필터만 뺀 나머지 조건(다른 필터 반영한 매물수).
  const cascadeProducts = useMemo(() => {
    const base: FState = { q, periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle: { ...EMPTY_VEHICLE_FILTER } };
    return (rows || []).filter((p) => matchProduct(p, base));
    // eslint-disable-next-line
  }, [rows, q, periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn]);
  // 인기차종 = 카탈로그 노출 매물의 모델(세부모델) 상위 10개.
  const popModels = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const p of rows || []) {
      if (isHiddenFromCatalog(p)) continue;
      const m = String(p.sub_model || p.model || '').trim();
      if (m) cnt.set(m, (cnt.get(m) || 0) + 1);
    }
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([m, c]) => ({ key: m, label: m, count: c }));
  }, [rows]);

  const list = useMemo(() => {
    // 정렬·표시 = 최저 대여료. 숨김 제외. 관심없음=맨 뒤.
    const l = (rows || []).filter((p) => {
      const code = String(p.product_code || p._key || '');
      if (code && hiddenCodes.has(code)) return false;
      if (models.size && !models.has(String(p.sub_model || p.model || '').trim())) return false;
      return matchProduct(p, s);
    });
    // 기본 정렬 = 무보증 가능 차량 우선(그 외 원순서). 명시 정렬 선택 시엔 그 기준 그대로.
    if (sort) {
      l.sort((a, b) => {
        const mile = (p: EntityRecord) => numOr(p.mileage, sort === 'mile_asc' ? Infinity : -1);
        const year = (p: EntityRecord) => numOr(p.year, 0);
        switch (sort) {
          case 'desc': return rentForSort(b) - rentForSort(a);
          case 'dep_asc': return depositForSort(a) - depositForSort(b);
          case 'dep_desc': return depositForSort(b) - depositForSort(a);
          case 'mile_asc': return mile(a) - mile(b);
          case 'mile_desc': return mile(b) - mile(a);
          case 'new': return year(b) - year(a);
          case 'old': return year(a) - year(b);
          case 'asc': return rentForSort(a) - rentForSort(b);
          default: return 0;
        }
      });
    } else {
      l.sort((a, b) => (noDeposit(a) ? 0 : 1) - (noDeposit(b) ? 0 : 1)); // 무보증 먼저
    }
    if (!passedCodes.size) return l;
    const front: EntityRecord[] = [];
    const back: EntityRecord[] = [];
    for (const p of l) {
      const code = String(p.product_code || p._key || '');
      if (code && passedCodes.has(code)) back.push(p);
      else front.push(p);
    }
    return [...front, ...back];
    // eslint-disable-next-line
  }, [rows, q, periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle, sort, hiddenCodes, passedCodes, models]);

  const totalVisible = useMemo(() => {
    const all = (rows || []).filter((p) => !isHiddenFromCatalog(p));
    if (!hiddenCodes.size) return all.length;
    return all.filter((p) => !hiddenCodes.has(String(p.product_code || p._key || ''))).length;
  }, [rows, hiddenCodes]);

  const narrowed = !!(q || activeCount(s) > 0);

  // 상단바 상태창 = PageStatus SSOT (웹·모바일 동일)
  useAppBar({
    title: <FinderStatus />,
  }, []);

  // 기간 필터 1개만 = 카드 앵커 가격. 복수/전체 = 최저가.
  const focusMonth = periods.size === 1 ? [...periods][0] : undefined;

  // 필터·정렬·관심탭 바뀌면 더보기 리셋
  useEffect(() => { setLimit(PAGE); }, [q, periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle, sort, colFilter, colSort, interestTab, models]);

  // 엑셀 헤더 필터·정렬 적용(사이드바 필터 위에 추가). 정렬=숫자칸만(연식·주행·대여료).
  const excelRows = useMemo(() => {
    let r = list.filter((p) => Object.entries(colFilter).every(([k, set]) => exColMatch(p, k, set)));
    if (colSort && exColSortNum(colSort.field)) {
      const { field, dir } = colSort;
      r = [...r].sort((a, b) => {
        const c = (exColSortVal(a, field) as number) - (exColSortVal(b, field) as number);
        return dir === 'asc' ? c : -c;
      });
    }
    return r;
  }, [list, colFilter, colSort]);

  // 본문/엑셀시트 세로막대 폭 → 툴바·관심바 오른쪽 패딩(--fp-pane-sb). 헤더·본문 끝선 맞춤.
  useEffect(() => {
    const main = finderMainRef.current;
    const body = finderBodyRef.current;
    if (!main || !body) return;
    const apply = () => {
      if (mobile) {
        main.style.setProperty('--fp-pane-sb', '0px');
        return;
      }
      // 엑셀 = 시트 스크롤 · 카드/리스트 = 본문 스크롤
      const port = (effView === 'excel'
        ? body.querySelector('.fp-excel-sheet')
        : body) as HTMLElement | null;
      if (!port) {
        main.style.setProperty('--fp-pane-sb', '0px');
        return;
      }
      main.style.setProperty('--fp-pane-sb', `${Math.max(0, port.offsetWidth - port.clientWidth)}px`);
    };
    apply();
    requestAnimationFrame(apply);
    const ro = new ResizeObserver(() => { apply(); requestAnimationFrame(apply); });
    ro.observe(body);
    const sheet = body.querySelector('.fp-excel-sheet');
    if (sheet) ro.observe(sheet);
    return () => ro.disconnect();
  }, [effView, mobile, list.length, filterOpen, limit, months.length, excelRows.length]);

  if (!rows) return <Loading />;

  const toggleDyn = (key: string, v: string) => setDyn((p) => { const cur = new Set(p[key] || []); cur.has(v) ? cur.delete(v) : cur.add(v); return { ...p, [key]: cur }; });
  const reset = () => {
    clearSavedFilters();
    setQInput(''); setQ(''); setPeriods(new Set()); setRent(new Set()); setDep(new Set()); setMile(new Set()); setFuel(new Set()); setPtype(new Set()); setCredit(new Set()); setPerks(new Set()); setPromo(new Set()); setDyn({}); setVehicle({ ...EMPTY_VEHICLE_FILTER }); setSort('');
  };
  const ac = activeCount(s);
  // 더보기 = 지금 보고 있는 목록 기준. 100개 미만이면 버튼 없음.
  const activeList = list;
  const shown = activeList.slice(0, limit);
  const exShown = excelRows;
  const hasOpts = exShown.some((p) => productOptions(p).length > 0);
  /** 엑셀 열 모드 — filter=사이드 열림(공급사·심사·조건 숨김) / full=닫힘(공급사·심사·조건 표시). */
  const exMode = excelColMode(filterOpen);
  const exFilterCols = excelShowFilterCols(exMode);
  const makerChars = excelMakerChars(exMode);
  const subChars = excelSubChars(exMode);
  const nameChars = excelNameChars(exMode);
  const modelW = hasOpts ? EXCEL_MAX.modelSlim : EXCEL_MAX.model;
  const moreN = effView === 'excel' ? 0 : Math.max(0, activeList.length - shown.length);
  const go = (p: EntityRecord) => router.push(`/m/${encodeURIComponent(String(p.product_code))}`);
  // 웹 우클릭 — erp3 상품찾기: 계약문의·손님공유·내용복사 (+상세·관심).
  const productCtxItems = (p: EntityRecord): CtxItem[] => {
    const role = getRole();
    const canDeal = role === 'agent' || role === 'admin';
    const me = getSession();
    const a = actor(role);
    const items: CtxItem[] = [];
    if (canDeal) {
      items.push({
        label: '계약문의',
        onClick: async () => {
          try {
            const room = await ensureRoom(p, a);
            router.push(`/chat?room=${encodeURIComponent(room)}`);
          } catch (e) {
            toast(e instanceof Error ? e.message : '계약문의 실패', 'error');
          }
        },
      });
      items.push({
        label: '손님공유',
        onClick: () => {
          const url = guestShareUrl(p, a.code || a.uid);
          navigator.clipboard?.writeText(url).then(
            () => toast('손님용 매물 링크 복사됨', 'ok'),
            () => prompt('링크', url),
          );
        },
      });
      items.push({ divider: true });
    }
    items.push({
      label: '상품 내용 복사',
      onClick: () => {
        const text = formatProductForCopy(p, {
          name: me?.name || a.name,
          company: me?.company_code,
          roleLabel: ROLE_LABEL[role],
        });
        navigator.clipboard?.writeText(text).then(
          () => toast(`상품 내용 복사됨 — ${p.car_number || p.product_code}`, 'ok'),
          () => prompt('내용', text),
        );
      },
    });
    items.push({ label: '상세 보기', onClick: () => go(p) });
    return items;
  };
  const onProductCtx = (e: MouseEvent, p: EntityRecord) => {
    if (mobile) return;
    productCtx.open(e, p);
  };
  /** 엑셀 헤더 칸 전체 클릭 = 필터 팝(텍스트만이 아니라 th 영역). */
  const hdrTh = (field: string, label: string, style: CSSProperties, className?: string) => {
    const filtered = !!colFilter[field]?.size;
    const sorted = !!colSort && colSort.field === field && exColSortNum(field);
    const on = filtered || sorted;
    return (
      <th
        key={field}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          const rc = e.currentTarget.getBoundingClientRect();
          setOpenCol(openCol?.field === field ? null : { field, x: rc.left, y: rc.bottom });
        }}
        style={{
          ...style,
          cursor: 'pointer',
          color: on ? C.brand : style.color,
          userSelect: 'none',
        }}
        title={`${label} 필터`}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontWeight: FW.strong }}>
          {label}{sorted && <span style={{ fontSize: FS.micro }}>{colSort!.dir === 'asc' ? '↑' : '↓'}</span>}
        </span>
      </th>
    );
  };

  const renderSidebar = () => (
    <>
      <div className="fp-sidebar-head">
        {mobile ? (
          <span style={{ fontSize: FS.title, fontWeight: FW.title, display: 'inline-flex', alignItems: 'center', gap: 6, color: C.ink }}>
            조건 검색{ac > 0 ? <CountPill n={ac} /> : null}
          </span>
        ) : (
          <>
            {/* 총계 = 손님에게 보이는 매물(출고불가 제외) — 상단바 '상품 N대'(totalVisible)와 동일 기준. rows.length는 출고불가까지 세어 어긋남. */}
            <span style={{ fontSize: FS.body, color: C.mute }}>총 <b style={{ color: C.ink, fontSize: FS.title }}>{totalVisible.toLocaleString()}</b>대</span>
            <span style={{ fontSize: FS.title, fontWeight: FW.title, display: 'inline-flex', alignItems: 'center', gap: 6, color: C.ink }}>
              조건 검색{ac > 0 ? <CountPill n={ac} /> : null}
            </span>
            <span style={{ flex: 1 }} />
            {ac > 0 && <Btn size="sm" variant="ghost" onClick={() => { haptic.select(); reset(); }}>초기화</Btn>}
          </>
        )}
      </div>
      <div className="fp-sidebar-body">
        {/*
          필터 사이드바 SSOT (웹·모바일 동일 순서 · 묶지 않음)
          펼침 = 기간·월대여·차종. 나머지 접음(선택 있으면 펼침).
          딜: 기간 → 월대여 → 보증
          차: 차종 → 색상(외·내) → 연식 → 연료 → 주행
          상품: 출고 → 상품구분 → 심사 → 우대 → 이벤트 → 차급·약정 → 공급사
        */}
        {present.months.length > 0 && (
          <FilterGroup title="기간" count={periods.size} defaultOpen first onClear={() => setPeriods(new Set())}>
            <ToggleChips
              selected={new Set([...periods].map(String))}
              onToggle={(k) => setPeriods((p) => toggleInSet(p, Number(k)))}
              options={operatingMonths(rows || []).map((m) => {
                const hit = present.months.find((o) => o.key === String(m));
                return { key: String(m), label: hit?.label || `${m}개월` };
              })}
            />
          </FilterGroup>
        )}
        {popModels.length > 0 && (
          <FilterGroup title="인기차종" count={models.size} defaultOpen onClear={() => setModels(new Set())}>
            <ToggleChips selected={models} onToggle={(k) => setModels((p) => toggleInSet(p, k))} options={popModels} />
          </FilterGroup>
        )}
        {present.rent.length > 0 && (
          <FilterGroup title="월대여료" count={rent.size} defaultOpen onClear={() => setRent(new Set())}>
            <ToggleChips selected={rent} onToggle={(k) => setRent((p) => toggleInSet(p, k))} options={present.rent} />
          </FilterGroup>
        )}
        {present.dep.length > 0 && (
          <FilterGroup title="보증금" count={dep.size} defaultOpen={dep.size > 0} onClear={() => setDep(new Set())}>
            <ToggleChips selected={dep} onToggle={(k) => setDep((p) => toggleInSet(p, k))} options={present.dep} />
          </FilterGroup>
        )}
        {/* 차 — 차종 → 색상 → 연식 → 연료 → 주행 */}
        {present.hasVehicle && (
          <FilterGroup title="차종(제조사, 모델, 트림 등)" count={vehicleFilterCount(vehicle)} defaultOpen onClear={() => setVehicle({ ...EMPTY_VEHICLE_FILTER })}>
            <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
              <VehicleMasterFilter products={cascadeProducts} value={vehicle} onChange={setVehicle} />
            </div>
          </FilterGroup>
        )}
        {CAR_DYN_KEYS.map((key) => {
          const d = DYN.find((x) => x.key === key);
          if (!d) return null;
          const opts = (agg[d.key] || []).map(([v, c]) => ({ key: v, label: v, count: c }));
          if (!opts.length) return null;
          const n = dyn[d.key]?.size || 0;
          return (
            <FilterGroup key={d.key} title={d.label} count={n} defaultOpen={n > 0} onClear={() => setDyn((p) => ({ ...p, [d.key]: new Set() }))}>
              <ToggleChips selected={dyn[d.key] || new Set()} onToggle={(k) => toggleDyn(d.key, k)} options={opts} />
            </FilterGroup>
          );
        })}
        {present.fuel.length > 0 && (
          <FilterGroup title="연료" count={fuel.size} defaultOpen={fuel.size > 0} onClear={() => setFuel(new Set())}>
            <ToggleChips selected={fuel} onToggle={(k) => setFuel((p) => toggleInSet(p, k))} options={present.fuel} />
          </FilterGroup>
        )}
        {present.mile.length > 0 && (
          <FilterGroup title="주행거리" count={mile.size} defaultOpen={mile.size > 0} onClear={() => setMile(new Set())}>
            <ToggleChips selected={mile} onToggle={(k) => setMile((p) => toggleInSet(p, k))} options={present.mile} />
          </FilterGroup>
        )}
        {/* 상품·조건 — 출고상태는 사이드 필터 없음(계약중 뱃지로만) */}
        {present.ptype.length > 0 && (
          <FilterGroup title="상품구분" count={ptype.size} defaultOpen={ptype.size > 0} onClear={() => setPtype(new Set())}>
            <ToggleChips selected={ptype} onToggle={(k) => setPtype((p) => toggleInSet(p, k))} options={present.ptype} />
          </FilterGroup>
        )}
        {present.credit.length > 0 && (
          <FilterGroup title="심사" count={credit.size} defaultOpen={credit.size > 0} onClear={() => setCredit(new Set())}>
            <ToggleChips selected={credit} onToggle={(k) => setCredit((p) => toggleInSet(p, k))} options={present.credit} />
          </FilterGroup>
        )}
        {present.perks.length > 0 && (
          <FilterGroup title="우대조건" count={perks.size} defaultOpen={perks.size > 0} onClear={() => setPerks(new Set())}>
            <ToggleChips selected={perks} onToggle={(k) => setPerks((p) => toggleInSet(p, k))} options={present.perks} />
          </FilterGroup>
        )}
        {present.promo.length > 0 && (
          <FilterGroup title="이벤트" count={promo.size} defaultOpen={promo.size > 0} onClear={() => setPromo(new Set())}>
            <ToggleChips selected={promo} onToggle={(k) => setPromo((p) => toggleInSet(p, k))} options={present.promo} />
          </FilterGroup>
        )}
        {EXTRA_DYN_KEYS.map((key) => {
          const d = DYN.find((x) => x.key === key);
          if (!d) return null;
          const opts = (agg[d.key] || []).map(([v, c]) => ({ key: v, label: v, count: c }));
          if (!opts.length) return null;
          const n = dyn[d.key]?.size || 0;
          return (
            <FilterGroup key={d.key} title={d.label} count={n} defaultOpen={n > 0} onClear={() => setDyn((p) => ({ ...p, [d.key]: new Set() }))}>
              <ToggleChips selected={dyn[d.key] || new Set()} onToggle={(k) => toggleDyn(d.key, k)} options={opts} />
            </FilterGroup>
          );
        })}
        {(() => {
          const entries = agg.provider || [];
          if (!entries.length) return null;
          const opts = sortProviderOptions(entries);
          const sel = [...(dyn.provider || [])][0] || '';
          return (
            <FilterGroup
              title="공급사"
              count={sel ? 1 : 0}
              defaultOpen={!!sel}
              onClear={() => setDyn((p) => ({ ...p, provider: new Set() }))}
            >
              <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
                <Select
                  full
                  value={sel}
                  placeholder="전체"
                  onChange={(v) => setDyn((p) => ({ ...p, provider: v ? new Set([v]) : new Set() }))}
                  options={opts}
                />
              </div>
            </FilterGroup>
          );
        })()}
      </div>
    </>
  );

  return (
    <div className={`fp-finder${filterOpen ? '' : ' is-nofilter'}${mobile && homeTool ? ` is-tool-${homeTool}` : ''}`}>
      <aside
        className="fp-sidebar"
        onWheel={(e) => {
          // 헤더 등 body 밖에서도 휠이 목록으로 새지 않게 — body로 흡수.
          const body = e.currentTarget.querySelector('.fp-sidebar-body') as HTMLElement | null;
          if (!body) return;
          if (body.contains(e.target as Node)) return; // body는 자체 스크롤
          body.scrollTop += e.deltaY;
          e.preventDefault();
        }}
      >{renderSidebar()}</aside>

      <section className="fp-finder-main" ref={finderMainRef}>
        {/* 툴바: 웹=검색·필터 한 줄 / 모바일=PageToolBar SSOT → 시트 */}
        {mobile ? (() => {
          const sortLabel = SORTS.find((o) => o.k === sort)?.short || '';
          const searchOn = !!q.trim();
          const sortOn = !!sort;
          const filterOn = ac > 0;
          const hintParts: string[] = [];
          if (searchOn) hintParts.push(q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim());
          if (sortOn) hintParts.push(sortLabel);
          if (filterOn) {
            const fh = activeFilterHints(s);
            hintParts.push(...fh.slice(0, 3));
            if (fh.length > 3) hintParts.push(`외 ${fh.length - 3}`);
          }
          return (
            <PageToolBar
              tools={[
                { key: 'search', label: '검색', icon: Search, badge: searchOn ? 1 : undefined, active: searchOn, pressed: homeTool === 'search', onClick: () => toggleHomeTool('search') },
                { key: 'sort', label: '정렬', icon: ArrowUpDown, badge: sortOn ? 1 : undefined, active: sortOn, pressed: homeTool === 'sort', onClick: () => toggleHomeTool('sort') },
                { key: 'filter', label: '필터', icon: SlidersHorizontal, badge: ac || undefined, active: filterOn, pressed: homeTool === 'filter', onClick: () => toggleHomeTool('filter') },
                { key: 'recent', label: '최근', icon: History, badge: interestRecent.length || undefined, active: interestRecent.length > 0, pressed: homeTool === 'recent', onClick: () => toggleHomeTool('recent') },
                { key: 'fav', label: '관심', icon: Star, badge: interestFavs.length || undefined, active: interestFavs.length > 0, pressed: homeTool === 'fav', onClick: () => toggleHomeTool('fav') },
              ]}
              hints={hintParts}
              onClearHints={hintParts.length ? () => reset() : undefined}
            />
          );
        })() : (
        <div className="fp-finder-toolbar">
          {(() => {
            const hints = activeFilterHints(s);
            const hintShow = hints.slice(0, 2);
            const hintMore = hints.length - hintShow.length;
            const filterToggle = (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: filterOpen ? undefined : 420 }}>
                <IconBtn
                  title={filterOpen ? '필터 숨기기' : (ac ? `조건 ${ac}개 · 필터 보기` : '필터 보기')}
                  active={filterOpen}
                  onClick={() => setFilterOpen(!filterOpen)}
                >
                  <SlidersHorizontal size={16} />
                </IconBtn>
                {!filterOpen && ac > 0 && (
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => setFilterOpen(true)}
                  >
                    조건 {ac}개{hintShow.length ? ` · ${hintShow.join(' · ')}${hintMore > 0 ? ` 외 ${hintMore}` : ''}` : ''}
                  </Btn>
                )}
              </span>
            );
            const countEl = <span style={{ fontSize: FS.sub, color: C.mute, whiteSpace: 'nowrap' }}>상품 <b style={{ color: C.ink }}>{list.length.toLocaleString()}</b>대</span>;
            const sortSel = <Select value={sort} onChange={setSort} placeholder="정렬" width={118} options={SORTS.map((o) => ({ value: o.k, label: o.label }))} />;
            const searchEl = (
              <SearchInput
                value={qInput}
                onChange={setQInput}
                placeholder="차번·차명·옵션·코드·공급사…"
                style={{ flex: '1 1 0', minWidth: 200, maxWidth: 420 }}
              />
            );
            const excelBtn = effView === 'excel'
              ? <IconBtn title="엑셀 다운로드" onClick={() => downloadProductsExcel(excelRows, new Date().toISOString().slice(0, 10))}><Download size={16} /></IconBtn>
              : null;
            const viewToggle = (
              <IconSeg
                value={effView}
                onChange={setView}
                options={views.map((v) => ({ key: v.k, label: v.label, icon: <v.Icon size={16} /> }))}
              />
            );
            const interestChips = (
              <InterestTriggers
                recentN={interestRecent.length}
                favN={interestFavs.length}
                tab={interestTab}
                onTab={setInterestTab}
              />
            );
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0, flexWrap: 'nowrap' }}>
                {countEl}{sortSel}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 0', minWidth: 0, maxWidth: 360 }}>
                  {searchEl}
                  {interestChips}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flex: '0 0 auto' }}>
                  {excelBtn}{filterToggle}{viewToggle}
                </div>
              </div>
            );
          })()}
        </div>
        )}

        {/* pane = 관심함 틀고정 + 목록 스크롤(카드) / 엑셀은 본문 안 시트 스크롤 */}
        <div className="fp-finder-pane">
          {!mobile && (
            <div className="fp-finder-interest-bar">
              <InterestPanel
                rows={rows || []}
                tab={interestTab}
                recent={interestRecent}
                favs={interestFavs}
                onClose={() => setInterestTab(null)}
              />
            </div>
          )}
          <div ref={finderBodyRef} className={`fp-finder-body ${effView === 'excel' ? 'is-excel' : ''}`}>
          {list.length === 0
            ? (
              <CenterNote>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <span>
                    {(rows?.length ?? 0) === 0
                      ? '표시할 상품이 없습니다'
                      : '조건에 맞는 상품이 없습니다'}
                  </span>
                  {narrowed ? (
                    <Btn size="sm" variant="ghost" onClick={reset}>조건 해제</Btn>
                  ) : null}
                  {(rows?.length ?? 0) === 0 && isGuest() ? (
                    <Btn size="sm" href="/login">로그인</Btn>
                  ) : null}
                </div>
              </CenterNote>
            ) :
            effView === 'card' ? (
              // 웹 간단=ProductCard 격자 / 모바일=RowCard 피드(기간칩 없음)
              mobile ? (
                <div style={{ background: C.taupeBg, borderTop: `1px solid ${C.line2}` }}>
                  {shown.map((p) => <ProductRowCard key={String(p.product_code || p._key)} p={p} focusMonth={focusMonth} />)}
                </div>
              ) : (
                // 필터바 열린 웹 ≈ 가로 6→5열 (minmax 210→240)
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
                  {shown.map((p) => (
                    <div key={String(p.product_code || p._key)} onContextMenu={(e) => onProductCtx(e, p)}>
                      <ProductCard p={p} focusMonth={focusMonth} />
                    </div>
                  ))}
                </div>
              )
            ) : effView === 'list' ? (
              // 상세카드(가로) — 웹은 기간칩, 모바일은 앵커만
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 520px), 1fr))', gap: 6 }}>
                {shown.map((p) => (
                  <div key={String(p.product_code || p._key)} onContextMenu={(e) => onProductCtx(e, p)}>
                    <ProductRowCard p={p} focusMonth={focusMonth} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="fp-excel-sheet">
              {/* 엑셀 전용 스크롤포트 — 헤더 sticky · 가로·세로 시트가 담당 */}
              <table className={`fp-excel-table is-${exMode}${hasOpts ? ' has-opts' : ' no-opts'}`} data-excel-mode={exMode}>
                <thead><tr>
                  {/* 공통 열 — 모드와 무관 동일 순서·폭(연식·주행·연료가 필터 토글에 안 밀림). 칸 전체 클릭=필터. */}
                  {hdrTh('car_number', '차량번호', { ...thXPin, ...colLock(EXCEL_MAX.plate) })}
                  {hdrTh('vehicle_status', '상태', { ...thX, ...colLock(EXCEL_W.status) })}
                  {hdrTh('product_type', '상품', { ...thX, ...colLock(EXCEL_W.ptype) })}
                  {hdrTh('maker', '제조사', { ...thX, ...colLockChars(makerChars) })}
                  {hdrTh('model', '모델', { ...thX, ...(typeof modelW === 'number' ? colLockChars(modelW) : colLock(modelW)) })}
                  {hdrTh('sub_model', '세부모델', { ...thX, ...colChars(subChars, hasOpts) })}
                  {hdrTh('variant', '파워', { ...thX, ...colChars(nameChars, hasOpts) })}
                  {hdrTh('trim_name', '트림', { ...thX, ...colChars(nameChars, hasOpts) })}
                  {hdrTh('options', '옵션', { ...thX, ...colOpts(hasOpts) })}
                  {hdrTh('ext_color', '외장', { ...thX, ...colLockChars(EXCEL_MAX.color) })}
                  {hdrTh('int_color', '내장', { ...thX, ...colLockChars(EXCEL_MAX.color) })}
                  {hdrTh('year', '연식', { ...thX, ...colLock(EXCEL_MAX.year) })}
                  {hdrTh('mileage', '주행', { ...thXR, ...colLock(EXCEL_MAX.mile) })}
                  {hdrTh('fuel_type', '연료', { ...thX, ...colLockChars(EXCEL_MAX.fuel) })}
                  {/* full만 — 대여료 직전. 필터 열림 시 숨김(사이드에서 선택). */}
                  {exFilterCols && hdrTh('provider_name', '공급사', { ...thX, ...colLockChars(EXCEL_MAX.provider) })}
                  {exFilterCols && hdrTh('credit', '심사', { ...thX, ...colLock(EXCEL_W.credit) })}
                  {exFilterCols && hdrTh('cond', '조건', { ...thX, ...colLock(EXCEL_W.cond) })}
                  {months.map((m, mi) => (
                    hdrTh(`price:${m}`, `${m}개월`, { ...thXR, ...colLock(EXCEL_PRICE_COL), ...pinRight(mi, EXCEL_PRICE_COL, months.length, true) }, 'fp-excel-price')
                  ))}
                </tr></thead>
                <tbody>{exShown.map((p, i) => {
                  const pl = priceList(p); const bg = i % 2 ? C.zebra : C.taupeBg;
                  const st = String(p.vehicle_status || ''); const pt = String(p.product_type || '');
                  const opts = productOptions(p);
                  const fuel = fuelDisplay(p.fuel_type);
                  const conds = excelCondSignals(p);
                  const clip = (v: unknown) => {
                    const s = String(v || '');
                    if (!s) return DASH;
                    return <span title={s} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</span>;
                  };
                  const clipMax = (v: unknown, n: number) => {
                    const full = String(v || '').trim();
                    if (!full) return DASH;
                    const shown = clipN(full, n);
                    return <span title={full !== shown ? full : undefined}>{shown}</span>;
                  };
                  return (
                  <tr key={String(p.product_code || p._key || i)} className="fp-sheet-row" onClick={() => go(p)} onContextMenu={(e) => onProductCtx(e, p)} style={{ cursor: 'pointer', background: bg }}>
                    <td style={{ ...tdXPin, ...colLock(EXCEL_MAX.plate), background: bg, fontFamily: NUM, fontWeight: FW.strong }} title={String(p.car_number || '') || undefined}>{String(p.car_number || '') || DASH}</td>
                    <td style={{ ...tdX, ...colLock(EXCEL_W.status) }}>{st ? <Badge tone={vehicleTone(st)} variant={st === '계약중' ? 'solid' : 'line'} pulse={st === '계약중'}>{st}</Badge> : DASH}</td>
                    <td style={{ ...tdX, ...colLock(EXCEL_W.ptype) }}>{pt ? (() => { const c = canonProductType(pt) || pt; const s = productTypeStyle(c); return <Badge tone={s.tone} variant={s.variant}>{c}</Badge>; })() : DASH}</td>
                    <td style={{ ...tdX, ...colLockChars(makerChars) }}>{clipMax(makerDisplay(p.maker) || p.maker, makerChars)}</td>
                    <td style={{ ...tdX, ...(typeof modelW === 'number' ? colLockChars(modelW) : colLock(modelW)) }}>{typeof modelW === 'number' ? clipMax(p.model, modelW) : clip(p.model)}</td>
                    <td style={{ ...tdX, ...colChars(subChars, hasOpts) }}>{clipMax(p.sub_model, subChars)}</td>
                    <td style={{ ...tdX, ...colChars(nameChars, hasOpts) }}>{clipMax(p.variant, nameChars)}</td>
                    <td style={{ ...tdX, ...colChars(nameChars, hasOpts) }}>{clipMax(p.trim_name, nameChars)}</td>
                    <td style={{ ...tdX, ...colOpts(hasOpts), whiteSpace: 'normal', verticalAlign: 'middle', overflow: 'hidden' }} title={opts.join(' · ') || undefined}>
                      {opts.length ? <OptionChips p={p} lines={2} /> : DASH}
                    </td>
                    <td style={{ ...tdX, ...colLockChars(EXCEL_MAX.color) }}>{clipMax(p.ext_color, EXCEL_MAX.color)}</td>
                    <td style={{ ...tdX, ...colLockChars(EXCEL_MAX.color) }}>{clipMax(p.int_color, EXCEL_MAX.color)}</td>
                    <td style={{ ...tdX, ...colLock(EXCEL_MAX.year) }}>{yearDisplay(p.year) || DASH}</td>
                    <td style={{ ...tdXR, ...colLock(EXCEL_MAX.mile) }}>{kmDisplay(p.mileage) || DASH}</td>
                    <td style={{ ...tdX, ...colLockChars(EXCEL_MAX.fuel) }}>{fuel ? clipMax(fuel, EXCEL_MAX.fuel) : DASH}</td>
                    {exFilterCols && <td style={{ ...tdX, ...colLockChars(EXCEL_MAX.provider) }}>{clipMax(p.provider_name || p.provider_company_code, EXCEL_MAX.provider)}</td>}
                    {exFilterCols && <td style={{ ...tdX, ...colLock(EXCEL_W.credit) }}>{(() => { const c = creditDisplay(p); return c ? <Badge tone={CREDIT_TONE(c)}>{c}</Badge> : DASH; })()}</td>}
                    {exFilterCols && (
                    <td style={{ ...tdX, ...colLock(EXCEL_W.cond), whiteSpace: 'normal' }}>
                      {conds.length ? (
                        <span style={{
                          display: 'flex', flexWrap: 'wrap',
                          gap: EXCEL_BADGE_GAP_X, alignItems: 'center', alignContent: 'flex-start',
                          maxHeight: EXCEL_CELL_BODY_H, overflow: 'hidden',
                        }}>
                          {conds.map((c) => {
                            const tone: BadgeTone = c.key === 'age' ? 'blue' : 'purple';
                            // 박스 단위 — shrink 금지(텍스트끼리 붙어 보이지 않게).
                            return (
                              <span key={c.key} style={{ flex: '0 0 auto', display: 'inline-flex' }}>
                                <Badge tone={tone} variant="line">{c.label}</Badge>
                              </span>
                            );
                          })}
                        </span>
                      ) : (
                        <span style={{ color: C.faint, fontSize: FS.sub }}>조건없음</span>
                      )}
                    </td>
                    )}
                    {months.map((m, mi) => { const e = pl.find((x) => x.m === m); return (
                      <td key={m} className="fp-excel-price" style={{ ...tdXR, ...colLock(EXCEL_PRICE_COL), ...pinRight(mi, EXCEL_PRICE_COL, months.length), background: bg, lineHeight: 1.2 }}>
                            {e ? <><div style={{ color: C.brand, fontWeight: FW.head, whiteSpace: 'nowrap' }}>{man(e.rent)}</div><div style={{ color: C.faint, fontWeight: FW.body, whiteSpace: 'nowrap' }}>{e.deposit ? man(e.deposit) : '0'}</div></> : DASH}
                      </td>
                    ); })}
                  </tr>
                ); })}</tbody>
              </table>
              {openCol && (() => {
                const f = openCol.field;
                const popRows = list.filter((p) => Object.entries(colFilter).every(([k, set]) => k === f || exColMatch(p, k, set)));
                return (
                  <FilterPop
                    field={f}
                    x={openCol.x}
                    y={openCol.y}
                    rows={popRows}
                    colFilter={colFilter}
                    setColFilter={setColFilter}
                    colSort={colSort}
                    setColSort={setColSort}
                    onClose={() => setOpenCol(null)}
                  />
                );
              })()}
              </div>
            )}
          {moreN > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap',
              // 카드 격자 gap과 동일 리듬. 하단 여백은 body frame-pad에만 맡김
              ...(mobile
                ? { padding: '10px 12px', borderTop: `1px solid ${C.line2}` }
                : { marginTop: 14 }),
            }}>
              <span style={{ fontSize: mobile ? 13 : 12, color: C.mute }}>
                {shown.length.toLocaleString()} / {activeList.length.toLocaleString()}대
              </span>
              <Btn variant="ghost" onClick={() => setLimit((n) => n + PAGE)}>더보기 · {Math.min(PAGE, moreN).toLocaleString()}대</Btn>
              <Btn variant="ghost" onClick={() => {
                if (activeList.length > PAGE_HARD) {
                  setLimit(PAGE_HARD);
                  toast(`성능상 ${PAGE_HARD.toLocaleString()}대까지 표시합니다. 검색·필터로 좁혀주세요.`, 'info');
                } else setLimit(activeList.length);
              }}>전체 보기</Btn>
            </div>
          )}
          </div>
        </div>
      </section>
      {productCtx.state && (
        <ContextMenu
          x={productCtx.state.x}
          y={productCtx.state.y}
          items={productCtxItems(productCtx.state.data)}
          onClose={productCtx.close}
        />
      )}

      {/* 모바일: 상단 툴바 버튼 → 아래에서 시트 */}
      {mobile && (
        <>
          <BottomSheet
            open={homeTool === 'search'}
            onClose={closeHomeTool}
            title="검색"
            maxHeight="auto"
            pad={false}
            footer={
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn style={{ flex: 1 }} onClick={() => { haptic.success(); closeHomeTool(); }}>
                  결과 {list.length.toLocaleString()}대
                </Btn>
                {q ? <Btn variant="ghost" onClick={() => { setQInput(''); setQ(''); }}>지우기</Btn> : null}
              </div>
            }
          >
            <div style={{ padding: '4px 16px 8px' }}>
              <SearchInput
                value={qInput}
                onChange={setQInput}
                placeholder="차번·차명·옵션·코드·공급사…"
                style={{ width: '100%', minWidth: 0 }}
                autoFocus
              />
            </div>
          </BottomSheet>

          <BottomSheet
            open={homeTool === 'sort'}
            onClose={closeHomeTool}
            title="정렬"
            maxHeight="auto"
            footer={<Btn full onClick={() => { haptic.success(); closeHomeTool(); }}>적용</Btn>}
          >
            <FilterChips
              value={sort || ''}
              onChange={(k) => { setSort(k); haptic.select(); }}
              options={[{ key: '', label: '기본' }, ...SORTS.map((o) => ({ key: o.k, label: o.short }))]}
            />
          </BottomSheet>

          <BottomSheet
            open={homeTool === 'filter'}
            onClose={closeHomeTool}
            title="조건 검색"
            maxHeight="min(68vh, 560px)"
            footer="filter"
            applyLabel={`결과 ${list.length.toLocaleString()}대`}
            onClear={ac > 0 ? () => { haptic.select(); reset(); } : undefined}
            pad={false}
          >
            <div className="fp-bottom-sheet-body" style={{ padding: 0 }}>
              {homeTool === 'filter' ? renderSidebar() : null}
            </div>
          </BottomSheet>

          <BottomSheet
            open={homeTool === 'recent'}
            onClose={closeHomeTool}
            title={<>최근 <span style={{ fontFamily: NUM }}>{interestRecent.length}</span>건</>}
            maxHeight="min(58vh, 480px)"
          >
            <div style={{ padding: '0 12px 12px' }}>
              {interestRecent.length === 0
                ? <CenterNote minHeight={120}>최근 본 상품이 없습니다</CenterNote>
                : interestRecent.map((snp) => {
                  const live = (rows || []).find((p) => String(p.product_code) === snp.code || String(p._key) === snp.code);
                  return <InterestSummaryCard key={snp.code} live={live} snap={snp} tab="recent" />;
                })}
              {interestRecent.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <Btn full variant="ghost" onClick={() => { clearRecent(); haptic.select(); }}>전체 지우기</Btn>
                </div>
              )}
            </div>
          </BottomSheet>

          <BottomSheet
            open={homeTool === 'fav'}
            onClose={closeHomeTool}
            title={<>관심 <span style={{ fontFamily: NUM }}>{interestFavs.length}</span>건</>}
            maxHeight="min(58vh, 480px)"
          >
            <div style={{ padding: '0 12px 12px' }}>
              {interestFavs.length === 0
                ? <CenterNote minHeight={120}>관심 상품이 없습니다</CenterNote>
                : interestFavs.map((snp) => {
                  const live = (rows || []).find((p) => String(p.product_code) === snp.code || String(p._key) === snp.code);
                  return <InterestSummaryCard key={snp.code} live={live} snap={snp} tab="fav" />;
                })}
              {interestFavs.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <Btn full variant="ghost" onClick={() => { clearFavs(); haptic.select(); }}>전체 지우기</Btn>
                </div>
              )}
            </div>
          </BottomSheet>
        </>
      )}
    </div>
  );
}
