'use client';
import { useDeferredValue, useEffect, useMemo, useRef, useState, useCallback, type CSSProperties, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGrid, List, Table, Download, SlidersHorizontal } from 'lucide-react';
import { getStore, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { type EntityRecord } from '@/lib/intake/entities';
import { priceList, rentForSort, depositForSort, creditDisplay, vehicleTone, excelCondSignals, isHiddenFromCatalog, canonProductType, noDeposit, installmentOk, minAge } from '@/lib/domain/product';
import { fuelDisplay, yearDisplay, makerDisplay, parseYear } from '@/lib/domain/vehicle-master-match';
import { withProviderNames } from '@/lib/domain/identity';
import { DYN, CAR_DYN_KEYS, EXTRA_DYN_KEYS, aggregateDyn, matchProduct, activeCount, presentFilterOptions, excelMonths, operatingMonths, EMPTY_VEHICLE_FILTER, vehicleFilterCount, sortProviderOptions, type FState, type VehicleFilter } from '@/lib/domain/product-filters';
import { VehicleMasterFilter } from '@/components/VehicleMasterFilter';
import { ProductCard } from '@/components/ProductCard';
import { ProductRowCard } from '@/components/ProductRowCard';
import { productOptions, OptionChips } from '@/components/product-card-atoms';
import { InterestTriggers, InterestPanel, useInterestLists, useInterestTab, useInterestTabGuard } from '@/components/InterestRail';
import { clearRecent, clearFavs } from '@/lib/product-interest';
import { toast } from '@/components/Toaster';
import { C, R, NUM, FW, FS, ctrlH, Loading, CenterNote, SearchInput, Select, FilterGroup, FilterChips, ToggleChips, Btn, IconBtn, IconSeg, Badge, CountPill, productTypeStyle, CREDIT_TONE, thX, thXR, thXPin, tdX, tdXR, tdXPin, colLock, colLockChars, colChars, colOpts, clipN, pinRight, EXCEL_W, EXCEL_MAX, EXCEL_CELL_BODY_H, EXCEL_BADGE_GAP_X, EXCEL_PRICE_COL, excelColMode, excelShowFilterCols, excelMakerChars, excelSubChars, excelNameChars, ContextMenu, useContextMenu } from '@/components/ui';
import type { BadgeTone } from '@/components/ui/badges';
import { man, kmDisplay } from '@/lib/format';
import { downloadProductsExcel } from '@/lib/excel-export';
import { useAuthReady, useSession } from '@/lib/auth-context';
import { firebaseReady } from '@/lib/firebase/client';
import { toggleInSet } from '@/lib/set';
import { actor, getRole, ensureRoom, ROLE_LABEL } from '@/lib/domain/deal';
import { getSession, isGuest } from '@/lib/auth-session';
import { guestShareUrl, formatProductForCopy } from '@/lib/domain/product-share';
import type { CtxItem } from '@/components/ui/ContextMenu';
import { useAppBar } from '@/lib/appbar';
import { FILTER_SS, FINDER_RESET_LIMIT } from '@/lib/finder-session';
import { FinderStatus } from '@/components/FinderStatus';
import { BottomSheet } from '@/components/BottomSheet';
import { listHiddenCodes, subscribeHidden } from '@/lib/product-hide';
import { listPassedCodes, subscribePassed } from '@/lib/product-pass';

/** 홈 모바일 툴 — 필터 시트만. */
type HomeTool = 'filter';
type InterestKey = 'recent' | 'fav';
type FilterBag = {
  periods: Set<number>;
  rent: Set<string>; dep: Set<string>; mile: Set<string>; fuel: Set<string>;
  ptype: Set<string>; credit: Set<string>; perks: Set<string>; promo: Set<string>;
  dyn: Record<string, Set<string>>;
  vehicle: VehicleFilter;
  models: Set<string>;
  sort: string;
  interest: Set<InterestKey>;
};

function emptyBag(): FilterBag {
  return {
    periods: new Set(), rent: new Set(), dep: new Set(), mile: new Set(), fuel: new Set(),
    ptype: new Set(), credit: new Set(), perks: new Set(), promo: new Set(),
    dyn: {}, vehicle: { ...EMPTY_VEHICLE_FILTER }, models: new Set(), sort: '', interest: new Set(),
  };
}

function cloneBag(b: FilterBag): FilterBag {
  const dynNext: Record<string, Set<string>> = {};
  for (const [k, set] of Object.entries(b.dyn)) dynNext[k] = new Set(set);
  return {
    periods: new Set(b.periods), rent: new Set(b.rent), dep: new Set(b.dep), mile: new Set(b.mile), fuel: new Set(b.fuel),
    ptype: new Set(b.ptype), credit: new Set(b.credit), perks: new Set(b.perks), promo: new Set(b.promo),
    dyn: dynNext, vehicle: { ...EMPTY_VEHICLE_FILTER, ...b.vehicle }, models: new Set(b.models),
    sort: b.sort, interest: new Set(b.interest),
  };
}

/** 드래프트 dirty 판정 — 최근·관심·정렬 포함(빠지면 취소해도 회귀 안 됨). */
function arrKey(x: Iterable<unknown>) { return [...x].map(String).sort().join('\0'); }
function sameBag(a: FilterBag, b: FilterBag): boolean {
  if (a.sort !== b.sort) return false;
  if (arrKey(a.interest) !== arrKey(b.interest)) return false;
  if (arrKey(a.periods) !== arrKey(b.periods)) return false;
  if (arrKey(a.rent) !== arrKey(b.rent)) return false;
  if (arrKey(a.dep) !== arrKey(b.dep)) return false;
  if (arrKey(a.mile) !== arrKey(b.mile)) return false;
  if (arrKey(a.fuel) !== arrKey(b.fuel)) return false;
  if (arrKey(a.ptype) !== arrKey(b.ptype)) return false;
  if (arrKey(a.credit) !== arrKey(b.credit)) return false;
  if (arrKey(a.perks) !== arrKey(b.perks)) return false;
  if (arrKey(a.promo) !== arrKey(b.promo)) return false;
  if (arrKey(a.models) !== arrKey(b.models)) return false;
  const dynA = Object.keys(a.dyn).filter((k) => (a.dyn[k]?.size || 0) > 0).sort();
  const dynB = Object.keys(b.dyn).filter((k) => (b.dyn[k]?.size || 0) > 0).sort();
  if (dynA.length !== dynB.length || dynA.some((k, i) => k !== dynB[i] || arrKey(a.dyn[k] || []) !== arrKey(b.dyn[k] || []))) return false;
  const va = a.vehicle; const vb = b.vehicle;
  return va.maker === vb.maker && va.model === vb.model && va.sub_model === vb.sub_model
    && va.variant === vb.variant && va.trim_name === vb.trim_name;
}

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
  models: string[]; // 인기차종 빠른필터(모델명)
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
                fontWeight: FW.strong,
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
                fontWeight: FW.strong,
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

// 하단시트 제목 SSOT — 라벨 + 결과 건수(드래프트 미리보기).
function SheetTitle({ label, count, unit }: { label: string; count: number; unit: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
      <span>{label}</span>
      <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.head, color: C.brand }}>
        {count.toLocaleString()}{unit}
      </span>
    </span>
  );
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
  const [interestFlt, setInterestFlt] = useState<Set<InterestKey>>(new Set());
  const [view, setViewState] = useState('card');
  const [homeTool, setHomeTool] = useState<HomeTool | null>(null); // 모바일 필터 시트
  const [filterDraft, setFilterDraft] = useState<FilterBag | null>(null);
  /** 시트 연 순간의 라이브 스냅 — 취소/필터버튼 닫기 시 여기로 회귀(최근·관심·정렬 포함). */
  const [filterSnap, setFilterSnap] = useState<FilterBag | null>(null);
  const filterDraftRef = useRef<FilterBag | null>(null);
  filterDraftRef.current = filterDraft;
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

  useEffect(() => {
    const refreshH = () => setHiddenCodes(new Set(listHiddenCodes()));
    const refreshP = () => setPassedCodes(new Set(listPassedCodes()));
    refreshH();
    refreshP();
    const offH = subscribeHidden(refreshH);
    const offP = subscribePassed(refreshP);
    return () => { offH(); offP(); };
  }, []);

  const liveBag = useCallback((): FilterBag => ({
    periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle, models, sort, interest: interestFlt,
  }), [periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle, models, sort, interestFlt]);

  const applyBag = useCallback((b: FilterBag) => {
    setPeriods(new Set(b.periods));
    setRent(new Set(b.rent));
    setDep(new Set(b.dep));
    setMile(new Set(b.mile));
    setFuel(new Set(b.fuel));
    setPtype(new Set(b.ptype));
    setCredit(new Set(b.credit));
    setPerks(new Set(b.perks));
    setPromo(new Set(b.promo));
    const dynNext: Record<string, Set<string>> = {};
    for (const [k, set] of Object.entries(b.dyn)) dynNext[k] = new Set(set);
    setDyn(dynNext);
    setVehicle({ ...EMPTY_VEHICLE_FILTER, ...b.vehicle });
    setModels(new Set(b.models));
    setSort(b.sort);
    setInterestFlt(new Set(b.interest));
  }, []);

  const discardFilterDraft = useCallback(() => {
    // 라이브를 연 시점 스냅으로 강제 회귀 — 최근·관심·정렬이 드래프트 밖·라이브로 샌 경우도 되돌림
    if (filterSnap) applyBag(cloneBag(filterSnap));
    setFilterSnap(null);
    setFilterDraft(null);
    setHomeTool(null);
  }, [filterSnap, applyBag]);

  const openFilterDraft = useCallback(() => {
    const snap = cloneBag(liveBag());
    setFilterSnap(snap);
    setFilterDraft(cloneBag(snap));
    setHomeTool('filter');
  }, [liveBag]);

  const toggleFilterSheet = useCallback(() => {
    haptic.select();
    if (homeTool === 'filter') discardFilterDraft();
    else openFilterDraft();
  }, [homeTool, discardFilterDraft, openFilterDraft]);

  const applyFilterDraft = useCallback(() => {
    if (filterDraft) applyBag(filterDraft);
    setFilterSnap(null);
    setFilterDraft(null);
    setHomeTool(null);
  }, [filterDraft, applyBag]);

  const filterDirty = !!(filterDraft && filterSnap && !sameBag(filterDraft, filterSnap));

  // 상단바 탭 = 시트 닫고 목록 맨 위(새로 온 느낌)
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail !== '/') return;
      discardFilterDraft();
      setInterestTab(null);
    };
    window.addEventListener('fp:page-refresh', on);
    return () => window.removeEventListener('fp:page-refresh', on);
  }, [setInterestTab, discardFilterDraft]);

  const finderMainRef = useRef<HTMLElement>(null);
  const finderBodyRef = useRef<HTMLDivElement>(null);
  const productCtx = useContextMenu<EntityRecord>();
  const co = getCompanyId();
  const router = useRouter();
  const mobile = useIsMobile();
  useInterestTabGuard(interestTab, setInterestTab, interestRecent.length, interestFavs.length, !mobile);
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
      setModels(setFromArr(saved.models));
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
      vehicle, sort, models: [...models],
    });
  }, [q, periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle, sort, models]);

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
  // 필터 토글 = 칩 즉시 반영(immediate), 무거운 목록 재필터는 지연(deferred) — 수천 매물 matchProduct가 칩 리페인트를 막지 않게.
  const sDef = useDeferredValue(s);
  const modelsDef = useDeferredValue(models);
  const agg = useMemo(() => aggregateDyn(rows || []), [rows]);
  // 엑셀 전용 열 집계 — 카드/리스트 뷰에선 스킵(빈배열). effView==='excel'일 때만 전량 priceList 순회.
  const months = useMemo(() => (effView === 'excel' ? excelMonths(rows || []) : []), [rows, effView]);
  const present = useMemo(() => presentFilterOptions(rows || []), [rows]);
  // 제조사스펙 집계 모수 = 스펙 필터만 뺀 나머지 조건(다른 필터 반영한 매물수).
  const cascadeProducts = useMemo(() => {
    const base: FState = { ...sDef, vehicle: { ...EMPTY_VEHICLE_FILTER } };
    return (rows || []).filter((p) => matchProduct(p, base));
  }, [rows, sDef]);
  // 인기차종 = 카탈로그 노출 매물의 모델(제조사-모델-세부모델 중 모델) 상위 10개.
  const popModels = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const p of rows || []) {
      if (isHiddenFromCatalog(p)) continue;
      const m = String(p.model || '').trim(); // 모델 기준(세부모델 아님)
      if (m) cnt.set(m, (cnt.get(m) || 0) + 1);
    }
    // 칩 = 모델명만. 랭킹은 제목 BEST 뱃지 + 인기순 배열로 전달(금은동 제거).
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([m]) => ({ key: m, label: m }));
  }, [rows]);

  const list = useMemo(() => {
    // 정렬·표시 = 최저 대여료. 숨김 제외. 관심없음=맨 뒤.
    let l = (rows || []).filter((p) => {
      const code = String(p.product_code || p._key || '');
      if (code && hiddenCodes.has(code)) return false;
      if (modelsDef.size && !modelsDef.has(String(p.model || '').trim())) return false;
      return matchProduct(p, sDef);
    });
    if (interestFlt.size > 0) {
      const codes = new Set<string>();
      if (interestFlt.has('recent')) for (const snp of interestRecent) codes.add(snp.code);
      if (interestFlt.has('fav')) for (const snp of interestFavs) codes.add(snp.code);
      l = l.filter((p) => codes.has(String(p.product_code || p._key || '')));
    }
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
      // 기본 정렬 = 혜택 우선: 무보증(4) > 분납가능(2) > 21세가능(1). 점수는 1회 선계산(priceList 재호출 방지), 동점은 원순서 유지(안정 정렬).
      const sc = new Map<EntityRecord, number>();
      for (const p of l) { const age = minAge(p); sc.set(p, (noDeposit(p) ? 4 : 0) + (installmentOk(p) ? 2 : 0) + (age > 0 && age <= 21 ? 1 : 0)); }
      l.sort((a, b) => (sc.get(b) ?? 0) - (sc.get(a) ?? 0));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sDef, modelsDef, sort, hiddenCodes, passedCodes, interestFlt, interestRecent, interestFavs]);

  /** 필터 시트 드래프트 기준 미리보기 건수(제목 옆). */
  const draftPreviewCount = useMemo(() => {
    if (!filterDraft || !rows) return list.length;
    const sDraft: FState = {
      q,
      periods: filterDraft.periods,
      rent: filterDraft.rent,
      dep: filterDraft.dep,
      mile: filterDraft.mile,
      fuel: filterDraft.fuel,
      ptype: filterDraft.ptype,
      credit: filterDraft.credit,
      perks: filterDraft.perks,
      promo: filterDraft.promo,
      dyn: filterDraft.dyn,
      vehicle: filterDraft.vehicle,
    };
    let interestCodes: Set<string> | null = null;
    if (filterDraft.interest.size > 0) {
      interestCodes = new Set();
      if (filterDraft.interest.has('recent')) for (const snp of interestRecent) interestCodes.add(snp.code);
      if (filterDraft.interest.has('fav')) for (const snp of interestFavs) interestCodes.add(snp.code);
    }
    let n = 0;
    for (const p of rows) {
      const code = String(p.product_code || p._key || '');
      if (code && hiddenCodes.has(code)) continue;
      if (filterDraft.models.size && !filterDraft.models.has(String(p.model || '').trim())) continue;
      if (interestCodes && (!code || !interestCodes.has(code))) continue;
      if (matchProduct(p, sDraft)) n += 1;
    }
    return n;
  }, [filterDraft, rows, q, hiddenCodes, interestRecent, interestFavs, list.length]);

  const totalVisible = useMemo(() => {
    const all = (rows || []).filter((p) => !isHiddenFromCatalog(p));
    if (!hiddenCodes.size) return all.length;
    return all.filter((p) => !hiddenCodes.has(String(p.product_code || p._key || ''))).length;
  }, [rows, hiddenCodes]);

  const narrowed = !!(q || activeCount(s) > 0 || models.size > 0 || interestFlt.size > 0 || sort);

  // 상단바 상태창 = PageStatus SSOT (웹·모바일 동일)
  useAppBar({
    title: <FinderStatus count={list.length} />,
  }, [list.length]);

  // 기간 필터 1개만 = 카드 앵커 가격. 복수/전체 = 최저가.
  const focusMonth = periods.size === 1 ? [...periods][0] : undefined;

  // 필터·정렬·관심탭 바뀌면 더보기 리셋
  useEffect(() => { setLimit(PAGE); }, [q, periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle, sort, colFilter, colSort, interestTab, models, interestFlt]);

  // 엑셀 헤더 필터·정렬 — 엑셀 뷰에서만 계산(카드/리스트는 빈배열 안전값).
  const excelRows = useMemo(() => {
    if (effView !== 'excel') return [] as EntityRecord[];
    let r = list.filter((p) => Object.entries(colFilter).every(([k, set]) => exColMatch(p, k, set)));
    if (colSort && exColSortNum(colSort.field)) {
      const { field, dir } = colSort;
      r = [...r].sort((a, b) => {
        const c = (exColSortVal(a, field) as number) - (exColSortVal(b, field) as number);
        return dir === 'asc' ? c : -c;
      });
    }
    return r;
  }, [effView, list, colFilter, colSort]);

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

  const v: FilterBag = filterDraft ?? {
    periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle, models, sort, interest: interestFlt,
  };
  const bump = (patch: Partial<FilterBag> | ((prev: FilterBag) => FilterBag)) => {
    // ref로 판정 — 클로저 stale로 라이브에 직접 쓰는 사고 방지(최근·관심·정렬 회귀 깨짐 원인)
    if (filterDraftRef.current != null) {
      setFilterDraft((prev) => {
        const cur = prev ?? cloneBag(liveBag());
        return typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
      });
    } else {
      const cur = liveBag();
      applyBag(typeof patch === 'function' ? patch(cur) : { ...cur, ...patch });
    }
  };
  const sidebarAc = filterDraft
    ? activeCount({ q: '', periods: v.periods, rent: v.rent, dep: v.dep, mile: v.mile, fuel: v.fuel, ptype: v.ptype, credit: v.credit, perks: v.perks, promo: v.promo, dyn: v.dyn, vehicle: v.vehicle }) + v.models.size + v.interest.size + (v.sort ? 1 : 0)
    : activeCount(s) + models.size;

  const toggleDyn = (key: string, val: string) => bump((b) => {
    const cur = new Set(b.dyn[key] || []);
    cur.has(val) ? cur.delete(val) : cur.add(val);
    return { ...b, dyn: { ...b.dyn, [key]: cur } };
  });
  const reset = () => {
    if (filterDraftRef.current != null) {
      setFilterDraft(emptyBag());
      return;
    }
    clearSavedFilters();
    setQInput(''); setQ(''); setPeriods(new Set()); setRent(new Set()); setDep(new Set()); setMile(new Set()); setFuel(new Set()); setPtype(new Set()); setCredit(new Set()); setPerks(new Set()); setPromo(new Set()); setDyn({}); setVehicle({ ...EMPTY_VEHICLE_FILTER }); setSort(''); setModels(new Set()); setInterestFlt(new Set());
  };
  const filterBadge = activeCount(s) + models.size + interestFlt.size + (sort ? 1 : 0);
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
      {!mobile ? (
      <div className="fp-sidebar-head">
          <>
            {/* 총계 = 손님에게 보이는 매물(출고불가 제외) — 상단바 '상품 N대'(totalVisible)와 동일 기준. rows.length는 출고불가까지 세어 어긋남. */}
            <span style={{ fontSize: FS.body, color: C.mute }}>총 <b style={{ color: C.ink, fontSize: FS.title }}>{totalVisible.toLocaleString()}</b>대</span>
            <span style={{ fontSize: FS.title, fontWeight: FW.title, display: 'inline-flex', alignItems: 'center', gap: 6, color: C.ink }}>
              조건 검색{sidebarAc > 0 ? <CountPill n={sidebarAc} /> : null}
            </span>
            <span style={{ flex: 1 }} />
            {sidebarAc > 0 && <Btn variant="bare" onClick={() => { haptic.select(); reset(); }} style={{ color: C.accent, fontSize: FS.cap, fontWeight: FW.strong, padding: '4px 6px' }}>초기화</Btn>}
          </>
      </div>
      ) : null}
      <div className="fp-sidebar-body">
        {filterDraft != null && (
          <>
            <FilterGroup
              title="최근·관심"
              count={v.interest.size}
              defaultOpen
              first
              actions={(() => {
                const h = ctrlH(mobile);
                const base: CSSProperties = {
                  marginLeft: 4, flex: '0 0 auto',
                  fontSize: mobile ? FS.sub : FS.cap, fontWeight: FW.strong,
                  minHeight: h, minWidth: 40, padding: mobile ? '0 8px' : '0 6px',
                };
                if (v.interest.size > 0) {
                  return (
                    <Btn
                      variant="bare"
                      onClick={() => {
                        haptic.select();
                        bump({ interest: new Set() });
                      }}
                      style={{ ...base, color: C.accent }}
                    >해제</Btn>
                  );
                }
                return (
                  <>
                    <Btn
                      variant="bare"
                      disabled={interestRecent.length === 0}
                      onClick={() => {
                        haptic.impact();
                        clearRecent();
                        setInterestFlt((prev) => { const n = new Set(prev); n.delete('recent'); return n; });
                        setFilterSnap((snap) => {
                          if (!snap) return snap;
                          const n = new Set(snap.interest); n.delete('recent');
                          return { ...snap, interest: n };
                        });
                        toast('최근 본을 비웠습니다', 'info');
                      }}
                      style={{ ...base, color: C.mute }}
                    >최근 비우기</Btn>
                    <Btn
                      variant="bare"
                      disabled={interestFavs.length === 0}
                      onClick={() => {
                        haptic.impact();
                        clearFavs();
                        setInterestFlt((prev) => { const n = new Set(prev); n.delete('fav'); return n; });
                        setFilterSnap((snap) => {
                          if (!snap) return snap;
                          const n = new Set(snap.interest); n.delete('fav');
                          return { ...snap, interest: n };
                        });
                        toast('관심을 비웠습니다', 'info');
                      }}
                      style={{ ...base, color: C.mute }}
                    >관심 비우기</Btn>
                  </>
                );
              })()}
            >
              <ToggleChips
                selected={v.interest}
                onToggle={(k) => bump((b) => ({ ...b, interest: toggleInSet(b.interest, k as InterestKey) }))}
                options={[
                  { key: 'recent', label: interestRecent.length ? `최근 ${interestRecent.length}` : '최근' },
                  { key: 'fav', label: interestFavs.length ? `관심 ${interestFavs.length}` : '관심' },
                ]}
              />
            </FilterGroup>
            <FilterGroup title="정렬" count={v.sort ? 1 : 0} defaultOpen onClear={() => bump({ sort: '' })}>
              <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
                <Select
                  full
                  value={v.sort || ''}
                  onChange={(k) => bump({ sort: k })}
                  placeholder="기본"
                  options={SORTS.map((o) => ({ value: o.k, label: o.label }))}
                />
              </div>
            </FilterGroup>
          </>
        )}
        {popModels.length > 0 && (
          <FilterGroup title={<>인기차종 <Badge tone="amber" variant="solid">BEST</Badge></>} count={v.models.size} defaultOpen={filterDraft == null} first={filterDraft == null} onClear={() => bump({ models: new Set() })}>
            <ToggleChips selected={v.models} onToggle={(k) => bump((b) => ({ ...b, models: toggleInSet(b.models, k) }))} options={popModels} />
          </FilterGroup>
        )}
        {present.months.length > 0 && (
          <FilterGroup title="기간" count={v.periods.size} defaultOpen onClear={() => bump({ periods: new Set() })}>
            <ToggleChips
              selected={new Set([...v.periods].map(String))}
              onToggle={(k) => bump((b) => ({ ...b, periods: toggleInSet(b.periods, Number(k)) }))}
              options={operatingMonths(rows || []).map((m) => {
                const hit = present.months.find((o) => o.key === String(m));
                return { key: String(m), label: hit?.label || `${m}개월` };
              })}
            />
          </FilterGroup>
        )}
        {present.rent.length > 0 && (
          <FilterGroup title="월대여료" count={v.rent.size} defaultOpen onClear={() => bump({ rent: new Set() })}>
            <ToggleChips selected={v.rent} onToggle={(k) => bump((b) => ({ ...b, rent: toggleInSet(b.rent, k) }))} options={present.rent} />
          </FilterGroup>
        )}
        {present.dep.length > 0 && (
          <FilterGroup title="보증금" count={v.dep.size} defaultOpen={v.dep.size > 0} onClear={() => bump({ dep: new Set() })}>
            <ToggleChips selected={v.dep} onToggle={(k) => bump((b) => ({ ...b, dep: toggleInSet(b.dep, k) }))} options={present.dep} />
          </FilterGroup>
        )}
        {present.hasVehicle && (
          <FilterGroup title="차종(제조사, 모델, 트림 등)" count={vehicleFilterCount(v.vehicle)} defaultOpen onClear={() => bump({ vehicle: { ...EMPTY_VEHICLE_FILTER } })}>
            <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
              <VehicleMasterFilter products={cascadeProducts} value={v.vehicle} onChange={(veh) => bump({ vehicle: veh })} />
            </div>
          </FilterGroup>
        )}
        {CAR_DYN_KEYS.map((key) => {
          const d = DYN.find((x) => x.key === key);
          if (!d) return null;
          const opts = (agg[d.key] || []).map(([val, c]) => ({ key: val, label: val, count: c }));
          if (!opts.length) return null;
          const n = v.dyn[d.key]?.size || 0;
          return (
            <FilterGroup key={d.key} title={d.label} count={n} defaultOpen={n > 0} onClear={() => bump((b) => ({ ...b, dyn: { ...b.dyn, [d.key]: new Set() } }))}>
              <ToggleChips selected={v.dyn[d.key] || new Set()} onToggle={(k) => toggleDyn(d.key, k)} options={opts} />
            </FilterGroup>
          );
        })}
        {present.fuel.length > 0 && (
          <FilterGroup title="연료(동력)" count={v.fuel.size} defaultOpen={v.fuel.size > 0} onClear={() => bump({ fuel: new Set() })}>
            <ToggleChips selected={v.fuel} onToggle={(k) => bump((b) => ({ ...b, fuel: toggleInSet(b.fuel, k) }))} options={present.fuel} />
          </FilterGroup>
        )}
        {present.mile.length > 0 && (
          <FilterGroup title="주행거리" count={v.mile.size} defaultOpen={v.mile.size > 0} onClear={() => bump({ mile: new Set() })}>
            <ToggleChips selected={v.mile} onToggle={(k) => bump((b) => ({ ...b, mile: toggleInSet(b.mile, k) }))} options={present.mile} />
          </FilterGroup>
        )}
        {present.ptype.length > 0 && (
          <FilterGroup title="상품구분" count={v.ptype.size} defaultOpen={v.ptype.size > 0} onClear={() => bump({ ptype: new Set() })}>
            <ToggleChips selected={v.ptype} onToggle={(k) => bump((b) => ({ ...b, ptype: toggleInSet(b.ptype, k) }))} options={present.ptype} />
          </FilterGroup>
        )}
        {present.credit.length > 0 && (
          <FilterGroup title="심사" count={v.credit.size} defaultOpen={v.credit.size > 0} onClear={() => bump({ credit: new Set() })}>
            <ToggleChips selected={v.credit} onToggle={(k) => bump((b) => ({ ...b, credit: toggleInSet(b.credit, k) }))} options={present.credit} />
          </FilterGroup>
        )}
        {present.perks.length > 0 && (
          <FilterGroup title="우대조건" count={v.perks.size} defaultOpen={v.perks.size > 0} onClear={() => bump({ perks: new Set() })}>
            <ToggleChips selected={v.perks} onToggle={(k) => bump((b) => ({ ...b, perks: toggleInSet(b.perks, k) }))} options={present.perks} />
          </FilterGroup>
        )}
        {present.promo.length > 0 && (
          <FilterGroup title="이벤트" count={v.promo.size} defaultOpen={v.promo.size > 0} onClear={() => bump({ promo: new Set() })}>
            <ToggleChips selected={v.promo} onToggle={(k) => bump((b) => ({ ...b, promo: toggleInSet(b.promo, k) }))} options={present.promo} />
          </FilterGroup>
        )}
        {EXTRA_DYN_KEYS.map((key) => {
          const d = DYN.find((x) => x.key === key);
          if (!d) return null;
          const opts = (agg[d.key] || []).map(([val, c]) => ({ key: val, label: val, count: c }));
          if (!opts.length) return null;
          const n = v.dyn[d.key]?.size || 0;
          return (
            <FilterGroup key={d.key} title={d.label} count={n} defaultOpen={n > 0} onClear={() => bump((b) => ({ ...b, dyn: { ...b.dyn, [d.key]: new Set() } }))}>
              <ToggleChips selected={v.dyn[d.key] || new Set()} onToggle={(k) => toggleDyn(d.key, k)} options={opts} />
            </FilterGroup>
          );
        })}
        {(() => {
          const entries = agg.provider || [];
          if (!entries.length) return null;
          const opts = sortProviderOptions(entries);
          const sel = [...(v.dyn.provider || [])][0] || '';
          return (
            <FilterGroup
              title="공급사"
              count={sel ? 1 : 0}
              defaultOpen={!!sel}
              onClear={() => bump((b) => ({ ...b, dyn: { ...b.dyn, provider: new Set() } }))}
            >
              <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
                <Select
                  full
                  value={sel}
                  placeholder="전체"
                  onChange={(val) => bump((b) => ({ ...b, dyn: { ...b.dyn, provider: val ? new Set([val]) : new Set() } }))}
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
        {/* 툴바: 웹=검색·필터 한 줄 / 모바일=SearchInput+필터 */}
        {mobile ? (
          <div className="fp-finder-toolbar">
            <SearchInput
              value={qInput}
              onChange={setQInput}
              placeholder="차번·차명·옵션·코드·공급사…"
              style={{ flex: '1 1 0', minWidth: 0 }}
            />
            <span style={{ position: 'relative', display: 'inline-flex', flex: '0 0 auto' }}>
              <IconBtn
                title={filterBadge > 0 ? `조건 ${filterBadge}개 · 필터` : '필터'}
                active={homeTool === 'filter'}
                onClick={toggleFilterSheet}
              >
                <SlidersHorizontal size={16} />
              </IconBtn>
              {filterBadge > 0 && (
                <span className="fp-icon-count">
                  <CountPill n={filterBadge} tone="accent" />
                </span>
              )}
            </span>
          </div>
        ) : (
        <div className="fp-finder-toolbar">
          {(() => {
            // 필터 = 다른 아이콘 버튼과 동일 규격(정사각) + 총 조건수만 뱃지. 텍스트 힌트 제거.
            const filterToggle = (
              <span style={{ position: 'relative', display: 'inline-flex', flex: '0 0 auto' }}>
                <IconBtn
                  title={filterOpen ? '필터 숨기기' : (sidebarAc ? `조건 ${sidebarAc}개 · 필터 보기` : '필터 보기')}
                  active={filterOpen}
                  onClick={() => setFilterOpen(!filterOpen)}
                >
                  <SlidersHorizontal size={16} />
                </IconBtn>
                {sidebarAc > 0 && (
                  <span className="fp-icon-count">
                    <CountPill n={sidebarAc} tone="accent" />
                  </span>
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
              <span style={{ fontSize: mobile ? FS.body : FS.sub, color: C.mute }}>
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

      {/* 모바일: 필터 시트 — commit 푸터(draft·적용·취소) */}
      {mobile && (
        <BottomSheet
          open={homeTool === 'filter'}
          onClose={discardFilterDraft}
          onCancel={discardFilterDraft}
          onCommit={applyFilterDraft}
          dirty={filterDirty}
          footer="commit"
          fixedHeight
          topInset="calc(var(--topbar-h) + var(--fp-bar-h))"
          title={<SheetTitle label="조건 검색" count={draftPreviewCount} unit="대" />}
          maxHeight="min(68vh, 560px)"
          clearLabel="초기화"
          onClear={(filterDraft ? sidebarAc : filterBadge) > 0 ? () => { haptic.select(); reset(); } : undefined}
          pad={false}
        >
          <div className="fp-bottom-sheet-body" style={{ padding: 0 }}>
            {homeTool === 'filter' ? renderSidebar() : null}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
