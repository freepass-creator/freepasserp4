'use client';
import { useEffect, useRef, useState, useCallback, useTransition, type CSSProperties, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getCompanyId } from '@/lib/tenant';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { type EntityRecord } from '@/lib/intake/entities';
import { activeCount, EMPTY_VEHICLE_FILTER, type VehicleFilter } from '@/lib/domain/product-filters';
import { InterestPanel, useInterestLists, useInterestTab, useInterestTabGuard } from '@/components/InterestRail';
import { clearRecent, clearFavs } from '@/lib/product-interest';
import { confirmDialog, toast } from '@/components/Toaster';
import { C, R, NUM, FW, FS, Loading, CenterNote, ContextMenu, useContextMenu } from '@/components/ui';
import { useAuthReady, useSession } from '@/lib/auth-context';
import { isGuest } from '@/lib/auth-session';
import { useAppBar } from '@/lib/appbar';
import { FINDER_RESET_LIMIT } from '@/lib/finder-session';
import { FinderStatus } from '@/components/FinderStatus';
import { BottomSheet } from '@/components/BottomSheet';
import {
  clearSavedFilters,
  cloneBag,
  emptyBag,
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
import { useFinderResults } from '@/features/finder/useFinderResults';
import { buildProductContextItems } from '@/features/finder/product-context';
import { FinderToolbar } from '@/features/finder/FinderToolbar';
import { FinderResults } from '@/features/finder/FinderResults';

/** 홈 모바일 툴 — 필터 시트만. */
type HomeTool = 'filter';
/** 드래프트 dirty 판정 — 최근·관심·정렬 포함(빠지면 취소해도 회귀 안 됨). */
const PAGE = 100; // 첫 화면·더보기 단위
const PAGE_HARD = 500; // 전체 보기 상한(가상스크롤 전 안전장치)
/** 필터·검색·정렬만 유지. limit(더보기/전체보기)는 절대 저장하지 않음. */

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
  const [view, setViewState] = useState('excel');
  const [homeTool, setHomeTool] = useState<HomeTool | null>(null); // 모바일 필터 시트
  const [filterDraft, setFilterDraft] = useState<FilterBag | null>(null);
  /** 시트 연 순간의 라이브 스냅 — 취소/필터버튼 닫기 시 여기로 회귀(최근·관심·정렬 포함). */
  const [filterSnap, setFilterSnap] = useState<FilterBag | null>(null);
  const filterDraftRef = useRef<FilterBag | null>(null);
  filterDraftRef.current = filterDraft;
  const [filterOpen, setFilterOpenState] = useState(true); // 웹 사이드바 필터 표시
  const setFilterOpen = (v: boolean) => {
    setFilterOpenState(v);
    if (typeof window !== 'undefined') localStorage.setItem('fp4_finder_filter', v ? '1' : '0');
  };
  const [colFilter, setColFilter] = useState<Record<string, Set<string>>>({}); // 엑셀 헤더 필터(사이드와 분리)
  const [colSort, setColSort] = useState<ColSort>(null);
  const [openCol, setOpenCol] = useState<{ field: string; x: number; y: number } | null>(null);
  const [limit, setLimit] = useState(PAGE); // 목록·엑셀 공통 페이징(더보기)
  const [interestTab, setInterestTab] = useInterestTab();
  const { recent: interestRecent, favs: interestFavs } = useInterestLists();

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
  const { rows, hiddenCodes, passedCodes } = useFinderData({
    companyId: co,
    authReady,
    sessionUid: session?.uid,
  });
  const [viewPending, startViewTransition] = useTransition();
  // 보기모드 = 새로고침해도 유지(localStorage). 서버·최초렌더는 'card' → effect에서 복원(하이드레이션 mismatch 방지).
  const setView = (v: string) => {
    startViewTransition(() => {
      setViewState(v);
      if (typeof window !== 'undefined') localStorage.setItem('fp4_finder_view', v);
    });
  };
  // 엑셀보기 = 넓은 화면 전용 배열. 모바일은 카드만(뷰·다운로드 미제공).
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

  // 보기 설정 복원은 데이터 로드와 독립적이다.
  useEffect(() => {
    const v = typeof window !== 'undefined' ? localStorage.getItem('fp4_finder_view') : null; if (v) setViewState(v);
    const f = typeof window !== 'undefined' ? localStorage.getItem('fp4_finder_filter') : null;
    if (f === '0') setFilterOpenState(false);
  }, []);

  // 로그인 후 최초 1회 — 우측 상단 보기(간단·상세·엑셀) 안내. 취소 없음 · 다음에 안보기만.
  const viewTipAsked = useRef(false);
  useEffect(() => {
    if (!authReady || !session || isGuest()) return;
    if (viewTipAsked.current) return;
    if (typeof window === 'undefined' || localStorage.getItem('fp4_finder_view_tip')) return;
    viewTipAsked.current = true;
    void (async () => {
      const ok = await confirmDialog({
        title: '웹 보기',
        message: '목록 보기(간단·상세·엑셀)는 화면 우측 상단에서 바꿀 수 있습니다.\n기본은 엑셀입니다.',
        okLabel: '다음에 안보기',
        hideCancel: true,
      });
      if (ok) localStorage.setItem('fp4_finder_view_tip', '1');
    })();
  }, [authReady, session?.uid]);

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

  // 상단바 상태창 = PageStatus SSOT (웹·모바일 동일)
  useAppBar({
    title: <FinderStatus count={list.length} />,
  }, [list.length]);

  // 기간 필터 1개만 = 카드 앵커 가격. 복수/전체 = 최저가.
  const focusMonth = periods.size === 1 ? [...periods][0] : undefined;

  // 필터·정렬·관심탭 바뀌면 더보기 리셋
  useEffect(() => { setLimit(PAGE); }, [q, periods, rent, dep, mile, fuel, ptype, credit, perks, promo, dyn, vehicle, sort, colFilter, colSort, interestTab, models, interestFlt]);

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
  const colFilterN = Object.values(colFilter).reduce((n, set) => n + set.size, 0);
  const sidebarAc = filterDraft
    ? activeCount({ q: '', periods: v.periods, rent: v.rent, dep: v.dep, mile: v.mile, fuel: v.fuel, ptype: v.ptype, credit: v.credit, perks: v.perks, promo: v.promo, dyn: v.dyn, vehicle: v.vehicle }) + v.models.size + v.interest.size + (v.sort ? 1 : 0) + colFilterN
    : activeCount(s) + models.size + colFilterN;

  const toggleDyn = (key: string, val: string) => bump((b) => {
    const cur = new Set(b.dyn[key] || []);
    cur.has(val) ? cur.delete(val) : cur.add(val);
    return { ...b, dyn: { ...b.dyn, [key]: cur } };
  });
  const reset = () => {
    // 사이드 초기화 = 엑셀 헤더 필터·정렬도 전부 해제
    setColFilter({});
    setColSort(null);
    setOpenCol(null);
    if (filterDraftRef.current != null) {
      setFilterDraft(emptyBag());
      return;
    }
    clearSavedFilters();
    setQInput(''); setQ(''); setPeriods(new Set()); setRent(new Set()); setDep(new Set()); setMile(new Set()); setFuel(new Set()); setPtype(new Set()); setCredit(new Set()); setPerks(new Set()); setPromo(new Set()); setDyn({}); setVehicle({ ...EMPTY_VEHICLE_FILTER }); setSort(''); setModels(new Set()); setInterestFlt(new Set());
  };
  const filterBadge = activeCount(s) + models.size + interestFlt.size + (sort ? 1 : 0) + colFilterN;
  // 더보기 = 지금 보고 있는 목록 기준(엑셀=헤더필터·정렬 반영분). 100개 미만이면 버튼 없음.
  const activeList = effView === 'excel' ? excelRows : list;
  const shown = activeList.slice(0, limit);
  const moreN = Math.max(0, activeList.length - shown.length);
  const go = (p: EntityRecord) => router.push(`/m/${encodeURIComponent(String(p.product_code))}`);
  const productCtxItems = (p: EntityRecord) => buildProductContextItems(p, router.push);
  const onProductCtx = (e: MouseEvent, p: EntityRecord) => {
    if (mobile) return;
    productCtx.open(e, p);
  };

  const clearInterestList = (kind: InterestKey) => {
    if (kind === 'recent') clearRecent();
    else clearFavs();
    setInterestFlt((previous) => {
      const next = new Set(previous);
      next.delete(kind);
      return next;
    });
    setFilterSnap((snapshot) => {
      if (!snapshot) return snapshot;
      const interest = new Set(snapshot.interest);
      interest.delete(kind);
      return { ...snapshot, interest };
    });
    toast(kind === 'recent' ? '최근 본을 비웠습니다' : '관심을 비웠습니다', 'info');
  };
  const filterPanelModel: FinderFilterPanelModel = {
    mobile,
    totalVisible,
    activeCount: sidebarAc,
    draftOpen: filterDraft != null,
    value: v,
    rows,
    cascadeProducts,
    popularModels: popModels,
    present,
    aggregate: agg,
    recentCount: interestRecent.length,
    favoriteCount: interestFavs.length,
    update: bump,
    reset,
    clearRecent: () => clearInterestList('recent'),
    clearFavorites: () => clearInterestList('fav'),
  };

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
      ><FinderFilterPanel model={filterPanelModel} /></aside>

      <section className="fp-finder-main" ref={finderMainRef}>
        <FinderToolbar
          mobile={mobile}
          query={qInput}
          onQuery={setQInput}
          filterBadge={filterBadge}
          filterSheetOpen={homeTool === 'filter'}
          onToggleFilterSheet={toggleFilterSheet}
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen(!filterOpen)}
          sidebarActiveCount={sidebarAc}
          resultCount={list.length}
          sort={sort}
          onSort={setSort}
          view={effView}
          onView={setView}
          excelRows={excelRows}
          recentCount={interestRecent.length}
          favoriteCount={interestFavs.length}
          interestTab={interestTab}
          onInterestTab={setInterestTab}
        />

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
          <FinderResults
            bodyRef={finderBodyRef}
            rows={rows}
            list={list}
            shown={shown}
            excelRows={excelRows}
            months={months}
            view={effView}
            mobile={mobile}
            focusMonth={focusMonth}
            filterOpen={filterOpen}
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
            onMore={() => setLimit((current) => current + PAGE)}
            pending={viewPending}
            onShowAll={() => {
              if (activeList.length > PAGE_HARD) {
                setLimit(PAGE_HARD);
                toast(`성능상 ${PAGE_HARD.toLocaleString()}대까지 표시합니다. 검색·필터로 좁혀주세요.`, 'info');
              } else {
                setLimit(activeList.length);
              }
            }}
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
    </div>
  );
}
