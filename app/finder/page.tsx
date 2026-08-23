'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, useDeferredValue, type CSSProperties, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet } from 'lucide-react';
import { getCompanyId } from '@/lib/tenant';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { type EntityRecord } from '@/lib/intake/entities';
import { activeCount, EMPTY_VEHICLE_FILTER, normalizeVehicleFilter, type VehicleFilter } from '@/lib/domain/product-filters';
import { isStockedProduct } from '@/lib/domain/product';
import { InterestPanel, useInterestLists, useInterestTab, useInterestTabGuard } from '@/components/InterestRail';
import { toast } from '@/components/Toaster';
import { StartGuide, useStartGuide } from '@/components/StartGuide';
import { C, R, FS, CenterNote, ContextMenu, useContextMenu, FW, ICON } from '@/components/ui';
import { useAuthReady, useSession } from '@/lib/auth-context';
import { useAppBar } from '@/lib/appbar';
import { FINDER_RESET_LIMIT } from '@/lib/finder-session';
import { FinderStatus } from '@/components/FinderStatus';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet';
import {
  clearSavedFilters,
  cloneBag,
  emptyBag,
  FINDER_DEFAULT_SORT,
  readSavedFilters,
  sameBag,
  setFromArr,
  writeSavedFilters,
  type FilterBag,
  type InterestKey,
  type SavedFinderFilters,
} from '@/features/finder/filter-state';
import type { ColSort } from '@/features/finder/excel-columns';
import { FinderFilterPanel, type FinderFilterPanelModel } from '@/features/finder/FinderFilterPanel';
import { useFinderData } from '@/features/finder/useFinderData';
import { finderDataScope } from '@/features/finder/finder-data-store';
import { useFinderResults } from '@/features/finder/useFinderResults';
import { buildProductContextItems } from '@/features/finder/product-context';
import { FinderToolbar } from '@/features/finder/FinderToolbar';
import { FinderQuickFilters } from '@/features/finder/FinderQuickFilters';
import { FinderResults } from '@/features/finder/FinderResults';
import { AgentWorkflowGuide } from '@/components/AgentWorkflowGuide';

/** 홈 모바일 툴 — 필터 시트만. */
type HomeTool = 'filter';
/** 드래프트 dirty 판정 — 최근·관심·정렬 포함(빠지면 취소해도 회귀 안 됨). */
const PAGE = 100; // 웹 첫 화면·더보기 단위
const MOBILE_PAGE = 40; // 모바일은 카드 100개 동시 mount를 피한다.
const PAGE_HARD = 500; // 전체 보기 상한(가상스크롤 전 안전장치)
// SSR 경고 없이 페인트 전 실행 — localStorage 복원처럼 첫 페인트에 맞아야 하는 상태용.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
/** 필터·검색·정렬만 유지. limit(더보기/전체보기)는 절대 저장하지 않음. */


/**
 * `excel` = **판매시트 그대로 보기**(SheetView). 이름만 옛 키를 쓴다 —
 * 저장된 세션·즐겨찾기가 그 값을 들고 있어 바꾸면 뷰가 초기화된다.
 * 원본 셀은 시트에서 읽고, 검색·필터는 서버가 확정한 ERP 상세 주소를 기준으로만 교집합한다.
 */
type FinderView = 'card' | 'list' | 'excel';
/** 판매시트 직접 보기로 전환한 뒤의 개인 보기 설정 키. 기존 카드/엑셀 설정은 한 번만 무시해 전원이 새 기본 화면을 본다. */
const FINDER_VIEW_STORAGE_KEY = 'fp4_finder_view_v2';
function isFinderView(value: unknown): value is FinderView {
  return value === 'card' || value === 'list' || value === 'excel';
}

export default function Finder() {
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
  const [sort, setSort] = useState(FINDER_DEFAULT_SORT);
  const [interestFlt, setInterestFlt] = useState<Set<InterestKey>>(new Set());
  // 상품 화면의 정본은 판매시트다. 첫 진입은 시트로 열고, 필요할 때만 카드/상세로 바꾼다.
  const [view, setViewState] = useState<FinderView>('excel');
  /** 판매시트가 실제로 표시 중인 행 수 — 상단 헤더의 시트 전용 대수다. */
  const [sheetVisibleCount, setSheetVisibleCount] = useState<number | null>(null);
  const [homeTool, setHomeTool] = useState<HomeTool | null>(null); // 모바일 필터 시트
  const [filterDraft, setFilterDraft] = useState<FilterBag | null>(null);
  /** 시트 연 순간의 라이브 스냅 — 취소/필터버튼 닫기 시 여기로 회귀(최근·관심·정렬 포함). */
  const [filterSnap, setFilterSnap] = useState<FilterBag | null>(null);
  const filterDraftRef = useRef<FilterBag | null>(null);
  filterDraftRef.current = filterDraft;
  const [filterOpen, setFilterOpen] = useState(false); // 세부 조건 메뉴(떠 있는 패널)
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  const [colFilter, setColFilter] = useState<Record<string, Set<string>>>({}); // 엑셀 헤더 필터(사이드와 분리)
  const [colSort, setColSort] = useState<ColSort>(null);
  const [openCol, setOpenCol] = useState<{ field: string; x: number; y: number } | null>(null);
  const [limit, setLimit] = useState(PAGE); // 목록·엑셀 공통 페이징(더보기)
  const [interestTab, setInterestTab] = useInterestTab();
  const { recent: storedInterestRecent, favs: storedInterestFavs } = useInterestLists();
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
    setVehicle(normalizeVehicleFilter(b.vehicle));
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
  }, [discardFilterDraft, setInterestTab]);

  const finderMainRef = useRef<HTMLElement>(null);
  const finderBodyRef = useRef<HTMLDivElement>(null);
  const productCtx = useContextMenu<EntityRecord>();
  const co = getCompanyId();
  const router = useRouter();
  const mobile = useIsMobile();
  const authReady = useAuthReady();
  const session = useSession(); // 로그인 순간 매물 재조회 트리거(uid 변화 → 아래 로드 effect 재실행)
  const { rows, hiddenCodes, passedCodes } = useFinderData({
    companyId: co,
    authReady,
    sessionUid: session?.uid,
    sessionScope: finderDataScope(session),
  });
  const interestProductIndex = useMemo(
    () => new Map((rows || []).map((product) => [String(product.product_code || product._key), product])),
    [rows],
  );
  const interestRecent = useMemo(() => {
    if (rows === null) return [];
    return storedInterestRecent.filter((snapshot) => {
      const live = interestProductIndex.get(snapshot.code);
      return !live || isStockedProduct(live);
    });
  }, [rows, storedInterestRecent, interestProductIndex]);
  const interestFavs = useMemo(() => {
    if (rows === null) return [];
    return storedInterestFavs.filter((snapshot) => {
      const live = interestProductIndex.get(snapshot.code);
      return !live || isStockedProduct(live);
    });
  }, [rows, storedInterestFavs, interestProductIndex]);
  useInterestTabGuard(interestTab, setInterestTab, interestRecent.length, interestFavs.length, !mobile, 0);
  // 보기모드 = 새로고침해도 유지(localStorage). 서버·최초렌더는 'card' → effect에서 복원(하이드레이션 mismatch 방지).
  // 선택(하이라이트)은 즉시(urgent), 무거운 목록 렌더만 useDeferredValue로 뒤로 → 토글 딱 반응, 논블로킹.
  const setView = (v: string) => {
    if (!isFinderView(v)) return;
    setViewState(v);
    // 이전 시트 탭의 대수가 카드/상세 헤더에 잠깐 남지 않게 즉시 비운다.
    setSheetVisibleCount(null);
    if (typeof window !== 'undefined') localStorage.setItem(FINDER_VIEW_STORAGE_KEY, v);
  };
  const deferredView = useDeferredValue(view);
  // effView = 툴바 하이라이트용(즉시) · renderView = 목록·데이터용(지연). 모바일은 카드만(뷰·다운로드 미제공).
  const effView = mobile ? 'card' : view;
  const renderView = mobile ? 'card' : deferredView;
  const pageSize = mobile ? MOBILE_PAGE : PAGE;
  const pageHard = mobile ? 200 : PAGE_HARD;

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
      setVehicle(normalizeVehicleFilter(saved.vehicle));
      setModels(setFromArr(saved.models));
      setSort(saved.sort || FINDER_DEFAULT_SORT);
    }
  }, []);

  // 상세→홈 복귀 시 더보기/전체보기만 리셋(마운트·소프트백·포커스)
  useEffect(() => {
    const apply = () => {
      try {
        if (!sessionStorage.getItem(FINDER_RESET_LIMIT)) return;
        sessionStorage.removeItem(FINDER_RESET_LIMIT);
        setLimit(pageSize);
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
  }, [pageSize]);

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

  // 보기 설정 복원 = 페인트 전(layout effect) → 새로고침 시 저장된 뷰 그대로.
  useIsoLayoutEffect(() => {
    const v = typeof window !== 'undefined' ? localStorage.getItem(FINDER_VIEW_STORAGE_KEY) : null;
    if (isFinderView(v)) setViewState(v);
    // 세부 메뉴는 떠 있는 패널 — 새로고침 때 자동으로 열지 않음. 사이드바 접힘 CSS 잔상 방지.
    if (typeof window !== 'undefined') {
      localStorage.setItem('fp4_finder_filter', '0');
      document.documentElement.dataset.fpFilter = '0';
    }
  }, []);

  // 로그인 후 최초 1회 — 이 화면(상품 목록) 보는 법.
  //  역할별 업무 흐름이었으나, 로그인 직후 처음 만나는 것은 이 목록이고 기본이 엑셀(표)이라
  //  «이게 뭔지·어떻게 바꾸는지»가 먼저다. 업무 흐름은 「자주 묻는 질문」이 다룬다.
  //  내용 SSOT = lib/domain/onboarding.ts
  const guideReady = authReady && !!session;
  const startGuide = useStartGuide(guideReady);

  const {
    state: s, aggregate: agg, months, present, cascadeProducts,
    popularModels: popModels, list, draftPreviewCount, totalVisible, narrowed, excelRows,
  } = useFinderResults({
    rows,
    query: q,
    periods,
    rent,
    deposit: dep,
    mileage: mile,
    fuel,
    productType: ptype,
    credit,
    perks,
    promo,
    dynamic: dyn,
    vehicle,
    models,
    sort,
    interest: interestFlt,
    recent: interestRecent,
    favorites: interestFavs,
    hiddenCodes,
    passedCodes,
    filterDraft,
    effectiveView: effView,
    columnFilter: colFilter,
    columnSort: colSort,
  });

  const foundCount = renderView === 'excel' ? excelRows.length : list.length;
  const sheetOnly = effView === 'excel';
  const colFilterN = Object.values(colFilter).reduce((n, set) => n + set.size, 0);
  const searching = !!(q || activeCount(s) > 0 || models.size > 0 || interestFlt.size > 0 || colFilterN > 0);
  // SheetView는 원본 문자열을 EntityRecord로 추측 변환하지 않는다. 이미 ERP 엔진이 판정한
  // list의 정확한 상세 주소만 전달해, 같은 검색·필터 결과를 원본 시트 순서 그대로 보여 준다.
  const sheetFinderFilterActive = !!(q || activeCount(s) > 0 || models.size > 0 || interestFlt.size > 0);
  const sheetFinderAllowedDetailHrefs = useMemo(() => list
    .map((product) => {
      const code = String(product.product_code || product._key || '');
      return code ? `/m/${encodeURIComponent(code)}` : '';
    })
    .filter((href): href is string => !!href), [list]);

  // 상단바 상태창 = PageStatus SSOT (웹·모바일 동일)
  const headerCount = sheetOnly ? sheetVisibleCount : (rows == null ? null : totalVisible);
  useAppBar({
    title: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {/*
          상단바 이름은 **어느 뷰에서나 「상품찾기 N대」로 같다**(사장님 2026-08-21
          「우측 상단에 동일하게 상품찾기 0000대 하고 그 뒤에다가 시트 아이콘 넣고 프리패스 상품리스트」).
          시트 뷰라고 이름을 통째로 바꿔 버리면 «다른 화면에 왔나» 싶고, 뒤로 갔을 때 이름이 또 바뀐다.
          «지금 무엇을 보고 있는지»는 이름을 갈아치우는 대신 **뒤에 딱지 하나**로 덧붙인다.
        */}
        <FinderStatus
          total={headerCount}
          found={sheetOnly ? undefined : foundCount}
          searching={sheetOnly ? false : searching}
        />
        {sheetOnly ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto',
            fontSize: FS.cap, fontWeight: FW.label, color: C.mute,
            border: `1px solid ${C.line}`, borderRadius: R, padding: '2px 8px', whiteSpace: 'nowrap',
          }}>
            <Sheet size={ICON.sm} aria-hidden />프리패스 상품리스트
          </span>
        ) : null}
      </span>
    ),
  }, [foundCount, headerCount, searching, sheetOnly]);

  // 기간 필터 1개만 = 카드 앵커 가격. 복수/전체 = 최저가.
  const focusMonth = periods.size === 1 ? [...periods][0] : undefined;

  // 필터·정렬·관심탭 바뀌면 더보기 리셋
  // interestTab(레일 뷰어 토글)은 목록 필터가 아님(list는 interestFlt로 필터) → 리셋 deps에서 제외(레일 열 때 페이지네이션 초기화 방지).
  useEffect(() => { setLimit(pageSize); }, [pageSize, q, periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle, sort, colFilter, colSort, models, interestFlt]);

  // 툴바·관심바 오른쪽 패딩(--fp-pane-sb) = 세로막대 폭. 카드·엑셀 둘 다 scrollbar-gutter:stable이라
  // 막대 폭은 OS 상수 → 뷰마다 재측정하면 값이 순간 튀어 버튼이 꿀렁임. 1회 측정 + resize만.
  useEffect(() => {
    const main = finderMainRef.current;
    if (!main) return;
    const apply = () => {
      if (mobile) { main.style.setProperty('--fp-pane-sb', '0px'); return; }
      const probe = document.createElement('div');
      probe.style.cssText = 'overflow-y:scroll;position:absolute;top:-9999px;width:60px;height:60px;visibility:hidden;';
      document.body.appendChild(probe);
      const sb = probe.offsetWidth - probe.clientWidth;
      document.body.removeChild(probe);
      main.style.setProperty('--fp-pane-sb', `${Math.max(0, sb)}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [mobile]);

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
    ? activeCount({ q: '', periods: v.periods, rent: v.rent, dep: v.dep, mile: v.mile, fuel: v.fuel, ptype: v.ptype, credit: v.credit, perks: v.perks, promo: v.promo, dyn: v.dyn, vehicle: v.vehicle }) + v.models.size + v.interest.size + (v.sort !== FINDER_DEFAULT_SORT ? 1 : 0) + colFilterN
    : activeCount(s) + models.size + colFilterN;

  const reset = useCallback(() => {
    // 사이드 초기화 = 엑셀 헤더 필터·정렬도 전부 해제
    setColFilter({});
    setColSort(null);
    setOpenCol(null);
    if (filterDraftRef.current != null) {
      setFilterDraft(emptyBag());
      return;
    }
    clearSavedFilters();
    setQInput(''); setQ(''); setPeriods(new Set()); setRent(new Set()); setDep(new Set()); setMile(new Set()); setFuel(new Set()); setPtype(new Set()); setCredit(new Set()); setPerks(new Set()); setPromo(new Set()); setDyn({}); setVehicle({ ...EMPTY_VEHICLE_FILTER }); setSort(FINDER_DEFAULT_SORT); setModels(new Set()); setInterestFlt(new Set());
  }, []);
  const filterBadge = activeCount(s) + models.size + interestFlt.size + (sort !== FINDER_DEFAULT_SORT ? 1 : 0) + colFilterN;
  // 더보기 = 지금 보고 있는 목록 기준(엑셀=헤더필터·정렬 반영분). 100개 미만이면 버튼 없음.
  const activeList = renderView === 'excel' ? excelRows : list;
  const shown = useMemo(() => activeList.slice(0, limit), [activeList, limit]);
  const moreN = Math.max(0, activeList.length - shown.length);
  const go = useCallback((p: EntityRecord) => router.push(`/m/${encodeURIComponent(String(p.product_code || p._key))}`), [router]);
  const productCtxItems = useCallback((p: EntityRecord) => buildProductContextItems(p, router.push), [router]);
  const onProductCtx = useCallback((e: MouseEvent, p: EntityRecord) => {
    if (mobile) return;
    productCtx.open(e, p);
  }, [mobile, productCtx]);
  const onMore = useCallback(() => setLimit((current) => current + pageSize), [pageSize]);
  const onShowAll = useCallback(() => {
    if (activeList.length > pageHard) {
      setLimit(pageHard);
      toast(`성능상 ${pageHard.toLocaleString()}대까지 표시합니다. 검색·필터로 좁혀주세요.`, 'info');
    } else {
      setLimit(activeList.length);
    }
  }, [activeList.length, pageHard]);

  /* 즐겨찾기(프리셋)·최근·관심 필터는 걷어냈다(사장님 2026-08-22 「요상한 거 다 빼자」 — lib/finder-filter-presets 는 미사용). */
  const filterPanelModel: FinderFilterPanelModel = {
    mobile,
    totalVisible,
    foundCount,
    searching,
    activeCount: sidebarAc,
    draftOpen: filterDraft != null,
    value: v,
    rows: rows || [],
    cascadeProducts,
    popularModels: popModels,
    present,
    aggregate: agg,
    update: bump,
    reset,
  };

  /* 시트 원본은 유지하고, 검색·퀵필터는 위의 exact href 교집합으로 그대로 적용한다. */

  return (
    <div className={`fp-finder is-nofilter${mobile && homeTool ? ` is-tool-${homeTool}` : ''}`}>
      <section className={`fp-finder-main${sheetOnly ? ' is-sheet-view' : ''}`} ref={finderMainRef}>
        <FinderToolbar
          mobile={mobile}
          query={qInput}
          onQuery={setQInput}
          filterBadge={filterBadge}
          filterSheetOpen={homeTool === 'filter'}
          onToggleFilterSheet={toggleFilterSheet}
          sort={sort}
          onSort={setSort}
          view={effView}
          onView={setView}
          recentCount={interestRecent.length}
          favoriteCount={interestFavs.length}
          interestTab={interestTab}
          onInterestTab={setInterestTab}
        />
        {/* 퀵필터 한 줄 — 웹만. 모바일은 검색창+필터 버튼만 깔끔하게(사장님 2026-08-22 「모바일은 퀵필터 넣지 말자」). */}
        {!mobile ? (
          <FinderQuickFilters
            value={v}
            present={present}
            products={rows || []}
            update={bump}
            onReset={reset}
            filterOpen={filterOpen}
            onToggleFilter={() => setFilterOpen((open) => !open)}
            onCloseFilter={closeFilter}
            sidebarActiveCount={sidebarAc}
            detailPanel={filterPanelModel}
          />
        ) : null}
        {/* pane = 관심함 틀고정 + 목록 스크롤(카드) / 엑셀은 본문 안 시트 스크롤 */}
        <div className="fp-finder-pane">
          {/* 안내 배너 = 웹만 — 버튼 둘(엑셀 상품리스트·전자계약) 다 모바일에 없는 동선이고 목록 한 줄 반을 먹는다(사장님 2026-08-22 「모바일은 불필요한 거 다 걷어내자」). */}
          {!sheetOnly && !mobile && <AgentWorkflowGuide />}
          {!mobile && (
            <div className="fp-finder-interest-bar">
              <InterestPanel
                rows={rows || []}
                tab={interestTab}
                recent={interestRecent}
                favs={interestFavs}
                inquiries={[]}
                onClose={() => setInterestTab(null)}
              />
            </div>
          )}
          <FinderResults
            bodyRef={finderBodyRef}
            rows={rows}
            list={list}
            shown={shown}
            excelRows={excelRows}
            months={months}
            view={renderView}
            mobile={mobile}
            focusMonth={focusMonth}
            filterOpen={false}
            narrowed={narrowed}
            onReset={reset}
            onOpenProduct={go}
            onProductContext={onProductCtx}
            colFilter={colFilter}
            setColFilter={setColFilter}
            colSort={colSort}
            setColSort={setColSort}
            openCol={openCol}
            setOpenCol={setOpenCol}
            moreCount={moreN}
            onMore={onMore}
            onShowAll={onShowAll}
            sheetFinderFilterActive={sheetFinderFilterActive}
            sheetFinderFilterReady={rows !== null}
            sheetFinderAllowedDetailHrefs={sheetFinderAllowedDetailHrefs}
            sheetFinderSortActive={Boolean(sort)}
            onSheetVisibleCountChange={sheetOnly ? setSheetVisibleCount : undefined}
          />
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
            {homeTool === 'filter' ? <FinderFilterPanel model={filterPanelModel} /> : null}
          </div>
        </BottomSheet>
      )}

      {/* 시작안내 — 웹·모바일 같은 내용(Modal 이 모바일에서 시트로 뜬다). */}
      <StartGuide open={startGuide.open} onClose={startGuide.close} />
    </div>
  );
}
