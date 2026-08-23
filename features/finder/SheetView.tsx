'use client';

import Link from 'next/link';
import { Check, ChevronDown, Copy, ExternalLink, Link2, Menu, RefreshCw, RotateCcw } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type ReactNode } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { getAuthClient } from '@/lib/firebase/client';
import type { EntityRecord } from '@/lib/intake/entities';
import { actor, getRole, type Role } from '@/lib/domain/deal';
import { getSession } from '@/lib/auth-session';
import { isOfferableProduct } from '@/lib/domain/product';
import { guestShareUrl, formatProductForCopy } from '@/lib/domain/product-share';
import { sanitizeProductForGuest } from '@/lib/domain/public-catalog';
import { copyText } from '@/lib/clipboard';
import { toast } from '@/components/Toaster';
import { Btn, C, CenterNote, FS, FW, ICON, IconBtn, Loading, R } from '@/components/ui';
import { COLOR_INK } from '@/lib/domain/color-master';
import { MASTER_CATEGORY_COLORS } from '@/lib/domain/category-colors';
import {
  CENTER_COLUMNS,
  COL_INK,
  FONT,
  GUBUN_INK,
  LEFT_COLUMNS,
  RIGHT_COLUMNS,
  SIZE,
  STATE_INK,
  colBgFor,
  columnWidths,
  isMoneyColumn,
  rowPx,
  salesTabColorFor,
} from '@/lib/domain/sales-sheet-format';
import {
  SheetColumnFilterPopover,
  filterLabel,
  filterValue,
  orderSheetFilterEntries,
  type SheetColumnFilter,
  type SheetFilterEntry,
  type SheetSort,
} from './SheetColumnFilterPopover';

/**
 * 판매시트 보기 — 서버가 읽은 실제 판매시트 값에 ERP 동작을 얹는 엑셀형 표.
 *
 * Google 편집기 UI를 가짜로 복제하지 않는다. A/B 열 문자·수식줄·편집 도구 대신 실제
 * 시트 머리글에 필터/정렬을 두고, 서버가 확정한 차량만 ERP 상세로 연다.
 */
type Grid = {
  tabs: string[];
  tab: string;
  header: string[];
  rows: string[][];
  /** rows와 같은 순서. 서버가 공급사+차번으로 확정한 상세 주소만 들어온다. */
  rowDetailHrefs?: Array<string | null>;
  /** 원본은 ERP 마스킹 대상이 아니므로 server가 admin에게만 내보낸다. */
  originalSheetHref?: string;
  readAt: string;
  maskedColumns: string[];
};
type SheetRow = { values: string[]; sourceIndex: number; detailHref: string | null };
type ActiveCell = { sourceIndex: number; column: number } | null;
type OpenColumn = { column: number; x: number; y: number } | null;
type SheetContextMenu = { sourceIndex: number; column: number; x: number; y: number } | null;
type GridLoadError = Error & { status?: number; detail?: string };

const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });
const ROW_INDEX_WIDTH = 48;
const SHEET_ROW_HEIGHT = rowPx(SIZE);
const SHEET_ROW_OVERSCAN = 14;
/**
 * 페이지 이동 뒤에도 같은 로그인 사용자가 곧바로 표를 다시 볼 수 있는 휘발성 캐시.
 * localStorage/HTTP cache는 역할별 마스킹 결과를 남길 수 있어 쓰지 않는다. UID가 바뀌거나
 * 현재 세션에서 토큰/역할이 바뀌면 반드시 전부 폐기한다.
 */
let sessionGridCacheUid: string | null = null;
const sessionGridCache = new Map<string, Grid>();
function clearSessionGridCache() {
  sessionGridCacheUid = null;
  sessionGridCache.clear();
}
function cachedSessionGrid(uid: string, key: string) {
  return sessionGridCacheUid === uid ? sessionGridCache.get(key) : undefined;
}
function storeSessionGrid(uid: string, key: string, grid: Grid) {
  if (sessionGridCacheUid !== uid) {
    sessionGridCacheUid = uid;
    sessionGridCache.clear();
  }
  sessionGridCache.set(key, grid);
}
const FOCUSABLE_TARGET = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
const TAB_MENU_ITEM_STYLE: CSSProperties = {
  display: 'grid', gridTemplateColumns: '16px 10px minmax(0, 1fr)', alignItems: 'center', gap: 8,
  justifyContent: 'normal', width: '100%', padding: '0 12px', textAlign: 'left',
  background: 'var(--fp-sheet-tab-menu-bg, transparent)', color: 'var(--fp-sheet-tab-menu-color, var(--text-main))',
};
const isNumeric = (value: string) => /^[₩$]?[\d,]+(?:\.\d+)?%?$/.test(value.trim()) && /\d/.test(value);
const sheetColor = (hex?: string) => hex ? (hex.startsWith('#') ? hex : `#${hex}`) : undefined;
/** 본문보다 큰 글자가 아니라, 한 단계 묵직한 면과 굵기로 헤더를 구분한다. */
const sheetHeaderBackground = (header: string) => {
  const source = sheetColor(colBgFor(header));
  return source ? `color-mix(in srgb, ${source} 88%, var(--text-sub))` : 'var(--fp-sheet-header-rail)';
};
const shouldRestoreControlFocus = (target: EventTarget | null) => !(target instanceof Element) || !target.closest(FOCUSABLE_TARGET);
const sheetCellId = (sourceIndex: number, column: number) => `fp-sheet-cell-${sourceIndex}-${column}`;
const detailHrefFor = (product: EntityRecord) => {
  const code = String(product.product_code || product._key || '').trim();
  return code ? `/m/${encodeURIComponent(code)}` : '';
};
/** 공개 공유주소에는 담당자 사람키만 넣는다. 세션 코드가 비어 `actor()`가 Firebase UID로
 * 폴백한 경우에는 귀속 파라미터를 생략해 내부 식별자를 외부 URL에 직렬화하지 않는다. */
const publicAgentShareCode = (currentActor: ReturnType<typeof actor>) => {
  const code = String(currentActor.code || '').trim();
  const uid = String(currentActor.uid || '').trim();
  return code && code !== uid ? code : '';
};
function sheetColumnLetter(index: number) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}
const MANUFACTURER_INK: Record<string, string | undefined> = {
  ...MASTER_CATEGORY_COLORS['제조사'],
  르노: MASTER_CATEGORY_COLORS['제조사']['르노코리아'],
  KGM: MASTER_CATEGORY_COLORS['제조사']['KG모빌리티'],
};

function valueColor(header: string, value: string) {
  if (/구분/.test(header)) return sheetColor(GUBUN_INK.find(([label]) => value.includes(label))?.[1]);
  if (/상태/.test(header)) return sheetColor(STATE_INK.find(([label]) => value.includes(label))?.[1]);
  if (header === '제조사') return sheetColor(MANUFACTURER_INK[value]);
  if (header === '연료') return sheetColor(MASTER_CATEGORY_COLORS['연료'][value]);
  if (['외장', '내장', '외장색상', '내장색상'].includes(header)) return sheetColor(COLOR_INK[value]);
  return sheetColor(COL_INK[header]);
}

/** 원본 판매시트 repeatCell 기본값은 가운데이고, 지정 열만 좌/우 정렬한다. */
function columnAlign(header: string, value: string): CSSProperties['textAlign'] {
  if (CENTER_COLUMNS.includes(header)) return 'center';
  if (RIGHT_COLUMNS.includes(header) || isMoneyColumn(header) || isNumeric(value)) return 'right';
  if (LEFT_COLUMNS.includes(header)) return 'left';
  return 'center';
}

function readTime(readAt: string) {
  const date = new Date(readAt);
  if (Number.isNaN(date.getTime())) return 'ERP에서 읽음';
  return `ERP 읽음 ${date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
}

function matchesFilters(values: string[], filters: SheetColumnFilter, exceptColumn?: number) {
  return Object.entries(filters).every(([rawColumn, selected]) => {
    const column = Number(rawColumn);
    if (column === exceptColumn) return true;
    return selected.has(filterValue(values[column]));
  });
}

function compareCell(a: string, b: string) {
  const aBlank = !a.trim();
  const bBlank = !b.trim();
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : (aBlank ? 1 : -1);
  if (isNumeric(a) && isNumeric(b)) {
    const numericA = Number(a.replace(/[₩$,]/g, '').replace(/%$/, ''));
    const numericB = Number(b.replace(/[₩$,]/g, '').replace(/%$/, ''));
    if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB;
  }
  return collator.compare(a, b);
}

/**
 * 방향키 이동은 데이터/필터를 다시 계산하지 않는 단순 선택 동작이다.
 * 300행×수십 열의 표 전체가 activeCell 변경마다 다시 그려지면 한 칸 이동에도
 * 브라우저가 버벅이므로, 선택이 바뀐 행(이전·현재)만 다시 렌더한다.
 */
const SheetGridRow = memo(function SheetGridRow({
  headers,
  values,
  sourceIndex,
  detailHref,
  plateColumn,
  activeColumn,
  initialRow,
  rowHeight,
  bodyFont,
  cellRefs,
  onActivate,
  onFocusCell,
  onCellKeyDown,
  onCellContextMenu,
}: {
  headers: string[];
  values: string[];
  sourceIndex: number;
  detailHref: string | null;
  plateColumn: number;
  activeColumn: number | null;
  initialRow: boolean;
  rowHeight: number;
  bodyFont: string;
  cellRefs: MutableRefObject<Map<string, HTMLTableCellElement>>;
  onActivate: (sourceIndex: number, column: number, moveFocus?: boolean) => void;
  onFocusCell: (sourceIndex: number, column: number) => void;
  onCellKeyDown: (event: ReactKeyboardEvent<HTMLTableCellElement>, sourceIndex: number, column: number, detailHref: string | null) => void;
  onCellContextMenu: (event: ReactMouseEvent<HTMLTableCellElement>, sourceIndex: number, column: number) => void;
}) {
  const selected = activeColumn !== null;
  return (
    <tr
      role="row"
      className="fp-sheet-view__row"
      data-source-index={sourceIndex}
      data-detail-ready={detailHref ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
    >
      <th scope="row" role="rowheader" className="fp-sheet-view__row-index">
        <Btn
          type="button"
          variant="bare"
          className="fp-sheet-view__row-select"
          title={`${sourceIndex + 2}번 행 선택 · 방향키로 셀 이동`}
          aria-label={`${sourceIndex + 2}번 행 선택 · 방향키로 셀 이동`}
          aria-pressed={selected}
          haptic={false}
          onClick={() => onActivate(sourceIndex, 0, true)}
          style={{ width: '100%', height: '100%' }}
        >{sourceIndex + 2}</Btn>
      </th>
      {headers.map((header, index) => {
        const value = values[index] || '';
        const ink = valueColor(header, value);
        const isPlateCell = index === plateColumn;
        const isDetailCell = isPlateCell && !!detailHref;
        const isActiveCell = activeColumn === index;
        return (
          <td
            key={index}
            id={sheetCellId(sourceIndex, index)}
            role="gridcell"
            className="fp-sheet-view__cell"
            title={isDetailCell ? 'ERP 상품 상세 열기' : (value || undefined)}
            tabIndex={isActiveCell || (initialRow && index === 0) ? 0 : -1}
            aria-selected={isActiveCell}
            data-active-cell={isActiveCell ? 'true' : undefined}
            ref={(element) => {
              const id = sheetCellId(sourceIndex, index);
              if (element) cellRefs.current.set(id, element);
              else cellRefs.current.delete(id);
            }}
            onFocus={() => onFocusCell(sourceIndex, index)}
            onClick={() => onActivate(sourceIndex, index)}
            onKeyDown={(event) => onCellKeyDown(event, sourceIndex, index, isDetailCell ? detailHref : null)}
            onContextMenu={(event) => onCellContextMenu(event, sourceIndex, index)}
            style={{
              height: rowHeight,
              background: sheetColor(colBgFor(header)) || C.taupeBg,
              color: ink || C.ink,
              fontSize: bodyFont,
              fontWeight: isMoneyColumn(header) || header === '차량번호' || ink ? FW.strong : FW.body,
              textAlign: columnAlign(header, value),
            }}
          >{isDetailCell ? (
            <Link
              href={detailHref!}
              className="fp-sheet-view__detail-link"
              tabIndex={-1}
              aria-label={`차량번호 ${value} · ERP 상품 상세 열기`}
              onClick={(event) => {
                event.stopPropagation();
                onActivate(sourceIndex, index);
              }}
            >{value}</Link>
          ) : isPlateCell ? <span className="fp-sheet-view__plate-plain" title="ERP 상세 미연결">{value}</span> : value}</td>
        );
      })}
    </tr>
  );
});

export function SheetView({
  mobile,
  finderFilterActive = false,
  finderFilterReady = true,
  finderAllowedDetailHrefs = [],
  finderSortActive = false,
  sheetProducts = [],
  onVisibleCountChange,
}: {
  mobile: boolean;
  /** 다른 보기에서 적용한 ERP 조건의 정확한 결과. 연결된 행만 같은 결과로 좁힌다. */
  finderFilterActive?: boolean;
  /** ERP 상품목록이 아직 도착하지 않았으면 원본 행을 잠시 숨겨 잘못된 결과를 보이지 않는다. */
  finderFilterReady?: boolean;
  /** 현재 ERP 조건을 통과한 상품의 서버 확정 상세 주소. ERP 정렬을 고르기 전에는 시트 원본 순서를 유지한다. */
  finderAllowedDetailHrefs?: string[];
  /** 공통 정렬을 사용자가 고르면 같은 ERP 결과 순서를 시트에도 적용한다. */
  finderSortActive?: boolean;
  /** rowDetailHrefs와 정확히 대조할 현재 ERP 상품. 손님용 복사는 이 정본만 쓴다. */
  sheetProducts?: EntityRecord[];
  /** 상단 헤더가 현재 탭·필터를 반영한 실제 시트 행 수를 표시하게 한다. */
  onVisibleCountChange?: (count: number | null) => void;
}) {
  const [grid, setGrid] = useState<Grid | null>(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState('');
  const [tab, setTab] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(() => getAuthClient()?.currentUser || null);
  const [viewerRole, setViewerRole] = useState<Role>('agent');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingTab, setLoadingTab] = useState<string | null>(null);
  const [filters, setFilters] = useState<SheetColumnFilter>({});
  const [sort, setSort] = useState<SheetSort>(null);
  const [openColumn, setOpenColumn] = useState<OpenColumn>(null);
  const [activeCell, setActiveCell] = useState<ActiveCell>(null);
  const [contextMenu, setContextMenu] = useState<SheetContextMenu>(null);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  /** 탭 전환은 네트워크가 아니라 이 메모리 캐시에서 즉시 한다. 민감한 표는 localStorage에 남기지 않는다. */
  const gridCache = useRef(new Map<string, Grid>());
  const inFlight = useRef(new Map<string, Promise<Grid>>());
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const gridScrollFrame = useRef<number | null>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const [gridScrollTop, setGridScrollTop] = useState(0);
  const [gridViewportHeight, setGridViewportHeight] = useState(0);
  const activeRequest = useRef(0);
  const cacheEpoch = useRef(0);
  const seenAuthSignal = useRef(false);
  const roleReady = useRef(false);
  const viewerRoleRef = useRef<Role>('agent');
  const [authVersion, setAuthVersion] = useState(0);

  const invalidateGridCache = useCallback((includeSessionCache = false) => {
    cacheEpoch.current += 1;
    gridCache.current.clear();
    inFlight.current.clear();
    if (includeSessionCache) clearSessionGridCache();
  }, []);

  useEffect(() => {
    const auth = getAuthClient();
    if (!auth) { setAuthReady(true); return; }
    return onIdTokenChanged(auth, (user) => {
      // 같은 UID라도 ID token custom claim/역할은 바뀔 수 있다. 이전 역할의 마스킹 결과를
      // 메모리에 남기지 않도록 토큰이 바뀔 때마다 전부 폐기한다.
      // 첫 listener signal은 페이지 재진입 때도 발생한다. 같은 UID의 휘발성 캐시는
      // 그대로 써서 즉시 표시하되, 실행 중 토큰 갱신·사용자 교체는 무조건 폐기한다.
      const mustDropSessionCache = seenAuthSignal.current || sessionGridCacheUid !== (user?.uid || null);
      if (mustDropSessionCache) clearSessionGridCache();
      seenAuthSignal.current = true;
      invalidateGridCache();
      activeRequest.current += 1;
      setGrid(null);
      setTab('');
      setError('');
      setDetail('');
      setRefreshing(false);
      setLoadingTab(null);
      setTabMenuOpen(false);
      setAuthUser(user);
      setAuthReady(true);
      setAuthVersion((version) => version + 1);
    });
  }, [invalidateGridCache]);

  useEffect(() => {
    const syncRole = () => {
      const nextRole = getRole();
      if (roleReady.current && nextRole !== viewerRoleRef.current) {
        // admin/non-admin 전환은 같은 UID여도 응답 열 구성이 달라질 수 있다.
        invalidateGridCache(true);
        activeRequest.current += 1;
        setGrid(null);
      }
      roleReady.current = true;
      viewerRoleRef.current = nextRole;
      setViewerRole(nextRole);
    };
    syncRole();
    window.addEventListener('fp:role', syncRole);
    window.addEventListener('fp:session', syncRole);
    return () => {
      window.removeEventListener('fp:role', syncRole);
      window.removeEventListener('fp:session', syncRole);
    };
  }, []);

  const fetchGrid = useCallback(async (want: string): Promise<Grid> => {
    const key = want || '__default__';
    const pending = inFlight.current.get(key);
    if (pending) return pending;
    const cached = gridCache.current.get(want) || (want ? undefined : gridCache.current.get('__default__'));
    if (cached) return cached;
    const user = authUser;
    if (!user) {
      const error = new Error('로그인이 필요합니다.') as GridLoadError;
      error.status = 401;
      throw error;
    }
    const sessionCached = cachedSessionGrid(user.uid, want) || (want ? undefined : cachedSessionGrid(user.uid, '__default__'));
    if (sessionCached) {
      gridCache.current.set(sessionCached.tab, sessionCached);
      if (!want) gridCache.current.set('__default__', sessionCached);
      return sessionCached;
    }
    const epoch = cacheEpoch.current;
    const task = (async () => {
      const res = await fetch(`/api/products/sheet${want ? `?tab=${encodeURIComponent(want)}` : ''}`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({})) as Partial<Grid> & { error?: string; detail?: string };
      if (!res.ok || !body.header) {
        const error = new Error('상품리스트를 불러오지 못했습니다.') as GridLoadError;
        error.status = res.status;
        error.detail = String(body.detail || body.error || '');
        throw error;
      }
      const loaded = body as Grid;
      if (epoch !== cacheEpoch.current) {
        const error = new Error('세션이 변경되었습니다.') as GridLoadError;
        error.status = 401;
        throw error;
      }
      gridCache.current.set(loaded.tab, loaded);
      if (!want) gridCache.current.set('__default__', loaded);
      storeSessionGrid(user.uid, loaded.tab, loaded);
      if (!want) storeSessionGrid(user.uid, '__default__', loaded);
      return loaded;
    })();
    inFlight.current.set(key, task);
    try {
      return await task;
    } finally {
      if (inFlight.current.get(key) === task) inFlight.current.delete(key);
    }
  }, [authUser]);

  const preloadTabs = useCallback((tabs: string[], currentTab: string) => {
    for (const title of tabs) {
      if (title === currentTab || gridCache.current.has(title)) continue;
      void fetchGrid(title).catch(() => {
        // 현재 보이는 탭은 정상이어야 한다. 백그라운드 탭 실패는 사용자가 누를 때만 안내한다.
      });
    }
  }, [fetchGrid]);

  const load = useCallback(async (want: string) => {
    const request = ++activeRequest.current;
    setError('');
    setDetail('');
    setRefreshing(true);
    if (want) setLoadingTab(want);
    try {
      const loaded = await fetchGrid(want);
      if (request !== activeRequest.current) return;
      setGrid(loaded);
      setTab(loaded.tab);
      preloadTabs(loaded.tabs, loaded.tab);
    } catch (caught) {
      if (request !== activeRequest.current) return;
      const failure = caught as GridLoadError;
      setError(failure.status === 502
        ? '시트를 읽지 못했습니다. 서비스계정에 시트 열람 권한이 있는지 확인해 주세요.'
        : failure.status === 401 || failure.status === 403 ? '상품리스트를 볼 권한이 없습니다. 다시 로그인해 주세요.' : `시트를 불러오지 못했습니다.${failure.status ? ` (${failure.status})` : ''}`);
      setDetail(failure.detail || '');
    } finally {
      if (request === activeRequest.current) {
        setRefreshing(false);
        setLoadingTab(null);
      }
    }
  }, [fetchGrid, preloadTabs]);

  useEffect(() => {
    if (authReady) void load('');
  }, [authReady, authVersion, load]);

  const refreshAllTabs = useCallback(() => {
    // 강제 새로고침은 현재 탭만 즉시 다시 읽고, 성공 뒤 나머지 공개 탭을 백그라운드에서
    // 채운다. 기존 preload 응답은 epoch가 달라 캐시에 되살아나지 않는다.
    invalidateGridCache(true);
    void load(tab);
  }, [invalidateGridCache, load, tab]);

  // 탭마다 열 구성이 다르므로 이전 탭의 필터/정렬이 새 탭을 숨기지 않게 한다.
  const gridTab = grid?.tab || '';
  useEffect(() => {
    setFilters({});
    setSort(null);
    setOpenColumn(null);
    setTabMenuOpen(false);
  }, [gridTab]);
  const gridReadAt = grid?.readAt || '';
  useEffect(() => {
    setActiveCell(null);
    setContextMenu(null);
  }, [gridTab, gridReadAt]);
  useEffect(() => {
    const scrollport = gridScrollRef.current;
    if (scrollport) scrollport.scrollTop = 0;
    setGridScrollTop(0);
  }, [gridTab, gridReadAt]);

  const sourceRows = useMemo<SheetRow[]>(() => grid?.rows.map((values, sourceIndex) => ({
    values,
    sourceIndex,
    detailHref: grid.rowDetailHrefs?.[sourceIndex] || null,
  })) || [], [grid]);
  const finderAllowed = useMemo(() => new Set(finderAllowedDetailHrefs), [finderAllowedDetailHrefs]);
  const finderSortRanks = useMemo(
    () => new Map(finderAllowedDetailHrefs.map((href, index) => [href, index])),
    [finderAllowedDetailHrefs],
  );
  const finderFilterPending = finderFilterActive && !finderFilterReady;
  const widths = useMemo(() => grid ? columnWidths(grid.header, grid.rows) : [], [grid]);
  const tableWidth = useMemo(() => ROW_INDEX_WIDTH + widths.reduce((sum, width) => sum + width, 0), [widths]);
  const visibleRows = useMemo(() => {
    if (finderFilterPending) return [];
    const matched = sourceRows.filter((row) => matchesFilters(row.values, filters)
      && (!finderFilterActive || (!!row.detailHref && finderAllowed.has(row.detailHref))));
    if (sort) return [...matched].sort((a, b) => {
      const compared = compareCell(a.values[sort.column] || '', b.values[sort.column] || '');
      return compared ? (sort.direction === 'asc' ? compared : -compared) : a.sourceIndex - b.sourceIndex;
    });
    if (finderSortActive) return [...matched].sort((a, b) => {
      const aRank = a.detailHref ? finderSortRanks.get(a.detailHref) : undefined;
      const bRank = b.detailHref ? finderSortRanks.get(b.detailHref) : undefined;
      if (aRank !== undefined || bRank !== undefined) {
        if (aRank === undefined) return 1;
        if (bRank === undefined) return -1;
        if (aRank !== bRank) return aRank - bRank;
      }
      return a.sourceIndex - b.sourceIndex;
    });
    return matched;
  }, [filters, finderAllowed, finderFilterActive, finderFilterPending, finderSortActive, finderSortRanks, sort, sourceRows]);
  const activeVisibleIndex = useMemo(
    () => activeCell ? visibleRows.findIndex((row) => row.sourceIndex === activeCell.sourceIndex) : -1,
    [activeCell, visibleRows],
  );
  const renderedRows = useMemo(() => {
    const count = visibleRows.length;
    if (!count) return { rows: [] as SheetRow[], start: 0, end: 0 };
    const viewport = Math.max(gridViewportHeight, 480);
    let start = Math.max(0, Math.floor(gridScrollTop / SHEET_ROW_HEIGHT) - SHEET_ROW_OVERSCAN);
    let end = Math.min(count, Math.ceil((gridScrollTop + viewport) / SHEET_ROW_HEIGHT) + SHEET_ROW_OVERSCAN);
    // 방향키로 overscan 밖의 행을 고르면, 새 셀이 mount된 뒤 focus/스크롤을 넘긴다.
    if (activeVisibleIndex >= 0) {
      start = Math.min(start, Math.max(0, activeVisibleIndex - SHEET_ROW_OVERSCAN));
      end = Math.max(end, Math.min(count, activeVisibleIndex + SHEET_ROW_OVERSCAN + 1));
    }
    return { rows: visibleRows.slice(start, end), start, end };
  }, [activeVisibleIndex, gridScrollTop, gridViewportHeight, visibleRows]);
  const selectedSourceIndex = activeCell?.sourceIndex ?? null;
  const selectedRow = useMemo(
    () => selectedSourceIndex === null ? null : visibleRows.find((row) => row.sourceIndex === selectedSourceIndex) || null,
    [selectedSourceIndex, visibleRows],
  );
  const productByDetailHref = useMemo(() => {
    const next = new Map<string, EntityRecord | null>();
    for (const product of sheetProducts) {
      const href = detailHrefFor(product);
      if (!href) continue;
      // product code가 겹치면 어느 record인지 확정할 수 없으므로 고객 전달도 막는다.
      next.set(href, next.has(href) ? null : product);
    }
    return next;
  }, [sheetProducts]);
  const selectedProduct = selectedRow?.detailHref ? productByDetailHref.get(selectedRow.detailHref) || null : null;
  const contextRow = useMemo(
    () => contextMenu ? visibleRows.find((row) => row.sourceIndex === contextMenu.sourceIndex) || null : null,
    [contextMenu, visibleRows],
  );
  const contextProduct = contextRow?.detailHref ? productByDetailHref.get(contextRow.detailHref) || null : null;
  const canCopyContextForCustomer = (viewerRole === 'agent' || viewerRole === 'admin')
    && !!contextProduct && isOfferableProduct(contextProduct);
  const canCopyForCustomer = (viewerRole === 'agent' || viewerRole === 'admin') && !!selectedProduct && isOfferableProduct(selectedProduct);
  const customerCopyTitle = !selectedRow
    ? '표에서 차량 행을 먼저 선택하세요'
    : !selectedRow.detailHref || !selectedProduct
      ? 'ERP 상세가 연결된 차량만 복사할 수 있습니다'
      : !isOfferableProduct(selectedProduct)
        ? '현재 고객 안내가 가능한 가격이 반영된 차량만 복사할 수 있습니다'
        : viewerRole !== 'agent' && viewerRole !== 'admin'
          ? '링크·텍스트 복사는 영업·관리자만 사용할 수 있습니다'
          : '선택한 차량의 링크 또는 텍스트를 복사합니다';
  const activateCell = useCallback((sourceIndex: number, column: number, moveFocus = false) => {
    setActiveCell({ sourceIndex, column });
    if (!moveFocus) return;
    window.requestAnimationFrame(() => {
      const cell = cellRefs.current.get(sheetCellId(sourceIndex, column));
      cell?.focus({ preventScroll: true });
      const scrollport = gridScrollRef.current;
      if (!cell || !scrollport) return;
      // scrollIntoView()는 화면 안의 옆 셀로 이동할 때도 상위 스크롤 체인을 모두 계산한다.
      // 시트식 키 반복은 그 비용이 눈에 띄므로, 현재 viewport 밖으로 나갈 때만 해당 축을 옮긴다.
      // sticky 행번호·열문자·헤더 아래는 실제로 셀을 볼 수 없는 영역이다. 이 inset을
      // 빼지 않으면 대상 셀이 scrollport 안에는 있어도 고정 레일 밑에 가려진다.
      const stickyGutter = 4;
      const topInset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fp-sheet-letter-h'))
        + Math.max(SHEET_ROW_HEIGHT + 6, 28) + stickyGutter;
      // table offsetTop은 virtual spacer·sticky header가 섞이면 scrollTop과 같은 좌표계가
      // 아니다. 실제 화면 좌표로 비교해야 아래/오른쪽 끝에서 정확히 한 번만 움직인다.
      const cellRect = cell.getBoundingClientRect();
      const portRect = scrollport.getBoundingClientRect();
      const visibleLeft = portRect.left + ROW_INDEX_WIDTH + stickyGutter;
      const visibleRight = portRect.right - stickyGutter;
      const visibleTop = portRect.top + topInset;
      const visibleBottom = portRect.bottom - stickyGutter;
      const edge = 0.5; // table 1px border·소수점 layout 오차를 같은 경계로 취급한다.
      let nextLeft = scrollport.scrollLeft;
      let nextTop = scrollport.scrollTop;
      // Google Sheets처럼 선택 셀이 현재 작업 viewport 안에 있는 동안에는 화면을 움직이지
      // 않는다. 고정 레일/끝 경계에 **닿는 순간**에만 정확히 필요한 거리만 민다.
      if (cellRect.left <= visibleLeft + edge) nextLeft -= visibleLeft - cellRect.left + edge;
      else if (cellRect.right >= visibleRight - edge) nextLeft += cellRect.right - visibleRight + edge;
      if (cellRect.top <= visibleTop + edge) nextTop -= visibleTop - cellRect.top + edge;
      else if (cellRect.bottom >= visibleBottom - edge) nextTop += cellRect.bottom - visibleBottom + edge;
      if (nextLeft !== scrollport.scrollLeft || nextTop !== scrollport.scrollTop) {
        scrollport.scrollTo({ left: Math.max(0, nextLeft), top: Math.max(0, nextTop), behavior: 'instant' });
      }
    });
  }, [invalidateGridCache]);
  const focusCell = useCallback((sourceIndex: number, column: number) => {
    setActiveCell((current) => current?.sourceIndex === sourceIndex && current.column === column
      ? current : { sourceIndex, column });
  }, []);
  const handleGridScroll = useCallback(() => {
    if (gridScrollFrame.current !== null) return;
    gridScrollFrame.current = window.requestAnimationFrame(() => {
      gridScrollFrame.current = null;
      const scrollport = gridScrollRef.current;
      if (scrollport) setGridScrollTop(scrollport.scrollTop);
    });
  }, []);
  useEffect(() => {
    const scrollport = gridScrollRef.current;
    if (!scrollport) return;
    const measure = () => setGridViewportHeight(scrollport.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollport);
    return () => observer.disconnect();
  }, [grid]);
  useEffect(() => () => {
    if (gridScrollFrame.current !== null) window.cancelAnimationFrame(gridScrollFrame.current);
  }, []);
  const handleCellKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTableCellElement>, sourceIndex: number, column: number, detailHref: string | null) => {
    const rowAt = visibleRows.findIndex((row) => row.sourceIndex === sourceIndex);
    const lastColumn = Math.max(0, (grid?.header.length || 1) - 1);
    if (event.key === 'Enter' && detailHref) {
      event.preventDefault();
      cellRefs.current.get(sheetCellId(sourceIndex, column))?.querySelector<HTMLAnchorElement>('a[href]')?.click();
      return;
    }
    let nextRow = rowAt;
    let nextColumn = column;
    if (event.key === 'ArrowLeft') nextColumn = Math.max(0, column - 1);
    else if (event.key === 'ArrowRight') nextColumn = Math.min(lastColumn, column + 1);
    else if (event.key === 'ArrowUp') nextRow = Math.max(0, rowAt - 1);
    else if (event.key === 'ArrowDown') nextRow = Math.min(visibleRows.length - 1, rowAt + 1);
    else if (event.key === 'Home') {
      nextRow = event.ctrlKey || event.metaKey ? 0 : rowAt;
      nextColumn = 0;
    } else if (event.key === 'End') {
      nextRow = event.ctrlKey || event.metaKey ? visibleRows.length - 1 : rowAt;
      nextColumn = lastColumn;
    } else return;
    if (rowAt < 0 || nextRow < 0 || !visibleRows[nextRow]) return;
    event.preventDefault();
    activateCell(visibleRows[nextRow].sourceIndex, nextColumn, true);
  }, [activateCell, grid?.header.length, visibleRows]);
  const copyCustomerProduct = useCallback(async (product: EntityRecord | null, kind: 'all' | 'text' | 'link' = 'all') => {
    if (!product || (viewerRole !== 'agent' && viewerRole !== 'admin') || !isOfferableProduct(product)) return;
    const code = String(product.product_code || product._key || '').trim();
    if (!code) return;
    const safeProduct = sanitizeProductForGuest(code, product);
    const currentActor = actor(viewerRole);
    const copyValue = kind === 'text'
      ? formatProductForCopy(safeProduct, { name: currentActor.name, phone: getSession()?.phone })
      : kind === 'link'
        ? guestShareUrl(safeProduct, publicAgentShareCode(currentActor))
        : [formatProductForCopy(safeProduct, { name: currentActor.name, phone: getSession()?.phone }), guestShareUrl(safeProduct, publicAgentShareCode(currentActor))].filter(Boolean).join('\n\n');
    const success = kind === 'text' ? '상품 텍스트가 복사되었습니다.'
      : kind === 'link' ? '손님용 매물 링크 복사됨'
        : '상품 텍스트와 손님용 매물 링크를 복사했습니다.';
    if (await copyText(copyValue)) toast(success, 'ok');
    else toast(kind === 'link' ? '링크를 복사하지 못했습니다' : '상품 텍스트를 복사하지 못했습니다', 'error');
  }, [viewerRole]);
  const openCellContextMenu = useCallback((event: ReactMouseEvent<HTMLTableCellElement>, sourceIndex: number, column: number) => {
    event.preventDefault();
    event.stopPropagation();
    activateCell(sourceIndex, column, false);
    const width = 292;
    const height = 162;
    const gutter = 8;
    setContextMenu({
      sourceIndex,
      column,
      x: Math.max(gutter, Math.min(event.clientX, window.innerWidth - width - gutter)),
      y: Math.max(gutter, Math.min(event.clientY, window.innerHeight - height - gutter)),
    });
  }, [activateCell]);
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismissWithEscape);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismissWithEscape);
    };
  }, [contextMenu]);
  useEffect(() => {
    if (activeCell && !visibleRows.some((row) => row.sourceIndex === activeCell.sourceIndex)) setActiveCell(null);
  }, [activeCell, visibleRows]);
  const filterEntries = useMemo<SheetFilterEntry[]>(() => {
    if (!grid || !openColumn || finderFilterPending) return [];
    const counts = new Map<string, number>();
    for (const row of sourceRows) {
      if (finderFilterActive && (!row.detailHref || !finderAllowed.has(row.detailHref))) continue;
      if (!matchesFilters(row.values, filters, openColumn.column)) continue;
      const value = filterValue(row.values[openColumn.column]);
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return orderSheetFilterEntries(
      grid.header[openColumn.column] || '',
      [...counts.entries()].map(([value, count]) => ({ value, label: filterLabel(value), count })),
    );
  }, [filters, finderAllowed, finderFilterActive, finderFilterPending, grid, openColumn, sourceRows]);
  const activeFilterCount = Object.keys(filters).length;
  const hasTableState = activeFilterCount > 0 || sort !== null;
  const visibleCount = !grid || error || finderFilterPending ? null : visibleRows.length;
  useEffect(() => {
    onVisibleCountChange?.(visibleCount);
  }, [onVisibleCountChange, visibleCount]);

  const applyFilter = (column: number, selection: Set<string> | null) => {
    setFilters((current) => {
      const next = { ...current };
      if (selection === null) delete next[column];
      else next[column] = selection;
      return next;
    });
  };
  const clearTableState = () => {
    setFilters({});
    setSort(null);
    setOpenColumn(null);
  };
  const closeColumn = useCallback((column: number) => {
    setOpenColumn(null);
    window.requestAnimationFrame(() => document.getElementById(`fp-sheet-filter-${column}`)?.focus());
  }, []);
  useEffect(() => {
    if (!openColumn) return;
    // header rect는 열릴 때의 좌표다. 표/창을 움직인 뒤에는 같은 위치에 두지 않고 닫아
    // 다른 열의 메뉴처럼 보이는 오해를 막는다.
    const dismiss = () => setOpenColumn(null);
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpenColumn(null);
      // 필터창의 자동포커스가 브라우저 확장/보조기술에 의해 이동한 경우에도, 닫은 뒤에는
      // 원래 열 버튼으로 돌아가 다음 열을 바로 조작할 수 있게 한다.
      window.requestAnimationFrame(() => document.getElementById(`fp-sheet-filter-${openColumn.column}`)?.focus());
    };
    const scrollport = gridScrollRef.current;
    window.addEventListener('resize', dismiss);
    document.addEventListener('keydown', dismissWithEscape);
    scrollport?.addEventListener('scroll', dismiss, { passive: true });
    return () => {
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('keydown', dismissWithEscape);
      scrollport?.removeEventListener('scroll', dismiss);
    };
  }, [openColumn]);

  useEffect(() => {
    if (!tabMenuOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && tabMenuRef.current?.contains(target)) return;
      setTabMenuOpen(false);
      if (shouldRestoreControlFocus(target)) {
        window.requestAnimationFrame(() => document.getElementById('fp-sheet-tab-menu')?.focus());
      }
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setTabMenuOpen(false);
      window.requestAnimationFrame(() => document.getElementById('fp-sheet-tab-menu')?.focus());
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('keydown', dismissWithEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('keydown', dismissWithEscape);
    };
  }, [tabMenuOpen]);

  // 카드·상세 보기의 빈/로딩 상태와 같은 CenterNote를 쓴다. 실제 표가 준비된 뒤에만
  // SheetView의 흰 작업면을 렌더해, 전환 순간 전체가 새하얘지는 일을 막는다.
  const pane = (state: 'loading' | 'error', children: ReactNode) => (
    <div className="fp-sheet-view__state" data-state={state}>
      <CenterNote>{children}</CenterNote>
    </div>
  );

  if (error) {
    return pane('error',
      <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 20, textAlign: 'center' }}>
        <span style={{ fontSize: FS.body, color: C.ink }}>{error}</span>
        {detail ? <span style={{ fontSize: FS.cap, color: C.faint, maxWidth: 560, wordBreak: 'break-word' }}>{detail}</span> : null}
        <Btn
          type="button"
          variant="ghost"
          onClick={() => { setGrid(null); refreshAllTabs(); }}
          style={{ height: 30, padding: '0 12px', borderRadius: R, border: `1px solid ${C.line}`, background: C.taupeBg, color: C.ink, fontSize: FS.cap, fontWeight: FW.label, cursor: 'pointer', fontFamily: 'inherit' }}
        >다시 불러오기</Btn>
      </div>,
    );
  }
  if (!grid) return pane('loading', <Loading label={authReady ? '시트를 불러오는 중…' : '로그인 상태를 확인하는 중…'} />);

  const selectSheetTab = (title: string, restoreTabFocus = false) => {
    setTabMenuOpen(false);
    const tabIndex = grid.tabs.indexOf(title);
    const restoreFocus = () => {
      if (!restoreTabFocus || tabIndex < 0) return;
      window.requestAnimationFrame(() => document.getElementById(`fp-sheet-tab-${tabIndex}`)?.focus());
    };
    if (title === grid.tab) {
      restoreFocus();
      return;
    }
    clearTableState();
    setActiveCell(null);
    // 미리 받은 탭은 같은 tick에 교체한다. 앞서 누른 느린 탭 응답이 나중에
    // 덮어쓰지 않도록 요청 번호도 끊는다.
    activeRequest.current += 1;
    const cached = gridCache.current.get(title);
    if (cached) {
      setLoadingTab(null);
      setGrid(cached);
      setTab(cached.tab);
      restoreFocus();
      return;
    }
    // preload가 아직 끝나지 않았을 때는 현재 표를 빈 상태로 지우지 않는다.
    // tab 자체에 로딩 표시만 두고, 새 grid가 도착한 순간 함께 교체한다.
    setLoadingTab(title);
    void load(title);
    restoreFocus();
  };

  const bodyFont = `${SIZE}pt`;
  const sourceRowHeight = SHEET_ROW_HEIGHT;
  // 데이터 행과 글자 크기는 같게 유지하고, 헤더는 굵기·면만 한 단계 묵직하게 한다.
  const headerRowHeight = Math.max(sourceRowHeight + 6, 28);
  const headerFont = bodyFont;
  const plateColumn = grid.header.findIndex((header) => /^(차량번호|차번|차량 번호)$/.test(header.trim()));

  return (
    <div className="fp-sheet-view" style={{ fontFamily: FONT }} data-mobile={mobile ? '1' : undefined}>
      {/* 가로·세로 스크롤은 이 한 곳에서만. table-layout:fixed + 명시 폭으로 원본 열폭을 지킨다. */}
      <div ref={gridScrollRef} className="fp-sheet-view__grid" onScroll={handleGridScroll}>
        <table className="fp-sheet-view__table" role="grid" aria-label={`${tab} 판매시트`} aria-rowcount={visibleRows.length + 2} style={{ width: `max(100%, ${tableWidth}px)` }}>
          <colgroup>
            <col style={{ width: ROW_INDEX_WIDTH }} />
            {widths.map((width, index) => <col key={grid.header[index] || index} style={{ width }} />)}
          </colgroup>
          <thead>
            <tr className="fp-sheet-view__letters" aria-hidden="true">
              <th className="fp-sheet-view__corner" />
              {grid.header.map((header, index) => (
                <th key={`${header}-${index}`} className="fp-sheet-view__letter">{sheetColumnLetter(index)}</th>
              ))}
            </tr>
            <tr role="row">
              <th scope="col" role="columnheader" className="fp-sheet-view__row-head" aria-label="행 번호">1</th>
              {grid.header.map((header, index) => {
                const selected = filters[index];
                const filtered = selected !== undefined;
                const sorted = sort?.column === index ? sort.direction : null;
                const triggerId = `fp-sheet-filter-${index}`;
                return (
                  <th
                    key={`${header}-${index}`}
                    scope="col"
                    role="columnheader"
                    className="fp-sheet-view__header"
                    data-filtered={filtered ? 'true' : undefined}
                    data-sorted={sorted || undefined}
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                    style={{
                      height: headerRowHeight,
                       background: sheetHeaderBackground(header),
                       color: C.ink,
                       fontSize: headerFont,
                       fontWeight: FW.strong,
                    }}
                  >
                    <Btn
                      id={triggerId}
                      type="button"
                      variant="bare"
                      className="fp-sheet-view__header-trigger"
                      title={`${header} 필터와 정렬`}
                      aria-label={`${header} 필터와 정렬`}
                      aria-haspopup="dialog"
                      aria-expanded={openColumn?.column === index}
                      aria-controls={openColumn?.column === index ? 'fp-sheet-column-filter' : undefined}
                      data-active={filtered || !!sorted ? 'true' : undefined}
                      haptic={false}
                      onClick={() => {
                        const rect = document.getElementById(triggerId)?.getBoundingClientRect();
                        if (!rect) return;
                        setOpenColumn((current) => current?.column === index ? null : { column: index, x: rect.left, y: rect.bottom });
                      }}
                    >
                      <span className="fp-sheet-view__header-label" title={header}>{header}</span>
                      <ChevronDown className="fp-sheet-view__header-chevron" size={13} strokeWidth={2.5} aria-hidden />
                    </Btn>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {visibleRows.length && renderedRows.start > 0 ? (
              <tr className="fp-sheet-view__spacer" aria-hidden="true"><td colSpan={grid.header.length + 1} style={{ height: renderedRows.start * sourceRowHeight }} /></tr>
            ) : null}
            {visibleRows.length ? renderedRows.rows.map(({ values, sourceIndex, detailHref }) => (
              <SheetGridRow
                key={sourceIndex}
                headers={grid.header}
                values={values}
                sourceIndex={sourceIndex}
                detailHref={detailHref}
                plateColumn={plateColumn}
                activeColumn={activeCell?.sourceIndex === sourceIndex ? activeCell.column : null}
                initialRow={!activeCell && visibleRows[0]?.sourceIndex === sourceIndex}
                rowHeight={sourceRowHeight}
                bodyFont={bodyFont}
                cellRefs={cellRefs}
                onActivate={activateCell}
                onFocusCell={focusCell}
                onCellKeyDown={handleCellKeyDown}
                onCellContextMenu={openCellContextMenu}
              />
            )) : (
            <tr><td className="fp-sheet-view__empty" colSpan={grid.header.length + 1}>{finderFilterPending
              ? <Loading label="ERP 상품 조건을 불러오는 중…" minHeight={94} delayedAfterMs={0} />
              : '필터 조건에 맞는 상품이 없습니다.'}</td></tr>
            )}
            {visibleRows.length && renderedRows.end < visibleRows.length ? (
              <tr className="fp-sheet-view__spacer" aria-hidden="true"><td colSpan={grid.header.length + 1} style={{ height: (visibleRows.length - renderedRows.end) * sourceRowHeight }} /></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {contextMenu ? (
        <div
          role="menu"
          aria-label="선택한 행 작업"
          className="fp-sheet-view__context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextRow?.detailHref ? (
            <Link
              role="menuitem"
              className="fp-sheet-view__context-action"
              href={contextRow.detailHref}
              onClick={() => setContextMenu(null)}
            ><ExternalLink size={16} strokeWidth={1.9} aria-hidden />상세 보기</Link>
          ) : (
            <span className="fp-sheet-view__context-action is-disabled" aria-disabled="true">ERP 상세 미연결</span>
          )}
          <span className="fp-sheet-view__context-divider" aria-hidden />
          <button
            type="button"
            role="menuitem"
            className="fp-sheet-view__context-action"
            disabled={!canCopyContextForCustomer}
            title={canCopyContextForCustomer ? '차명·대여료·보증금을 카톡에 붙여넣을 글로 복사합니다' : '고객 안내가 가능한 ERP 상품만 복사할 수 있습니다'}
            onClick={() => {
              void copyCustomerProduct(contextProduct, 'text');
              setContextMenu(null);
            }}
          ><Copy size={16} strokeWidth={1.9} aria-hidden />텍스트 복사</button>
          <button
            type="button"
            role="menuitem"
            className="fp-sheet-view__context-action"
            disabled={!canCopyContextForCustomer}
            title={canCopyContextForCustomer ? '손님용 매물 링크를 복사합니다' : '고객 안내가 가능한 ERP 상품만 복사할 수 있습니다'}
            onClick={() => {
              void copyCustomerProduct(contextProduct, 'link');
              setContextMenu(null);
            }}
          ><Link2 size={16} strokeWidth={1.9} aria-hidden />손님 전달</button>
        </div>
      ) : null}

      <div className="fp-sheet-view__tabs-wrap">
        <div ref={tabMenuRef} className="fp-sheet-view__tab-menu">
          <IconBtn
            id="fp-sheet-tab-menu"
            title="상품리스트 탭 목록"
            haptic={false}
            aria-expanded={tabMenuOpen}
            aria-controls="fp-sheet-tab-menu-list"
            onClick={() => setTabMenuOpen((open) => !open)}
            style={{ border: 'none', background: tabMenuOpen ? C.hover : 'transparent', color: C.mute, boxShadow: 'none' }}
          ><Menu size={ICON.md} /></IconBtn>
          {tabMenuOpen ? (
            <div id="fp-sheet-tab-menu-list" className="fp-sheet-view__tab-menu-list" role="group" aria-label="상품리스트 탭 목록">
              {grid.tabs.map((title) => {
                const on = title === tab;
                const tabColor = sheetColor(salesTabColorFor(title)) || C.brand;
                return (
                  <Btn
                    key={title}
                    type="button"
                    variant="bare"
                    aria-pressed={on}
                    data-active={on ? 'true' : undefined}
                    className="fp-sheet-view__tab-menu-item"
                    style={{ ...TAB_MENU_ITEM_STYLE, '--fp-sheet-tab-color': tabColor } as CSSProperties}
                    onClick={() => selectSheetTab(title, true)}
                  >
                    <span className="fp-sheet-view__tab-menu-check" aria-hidden>{on ? <Check size={ICON.sm} /> : null}</span>
                    <span className="fp-sheet-view__tab-menu-dot" style={{ background: tabColor }} aria-hidden />
                    <span>{title}</span>
                  </Btn>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="fp-sheet-view__tabs" role="group" aria-label="상품리스트 탭">
          {grid.tabs.map((title, index) => {
            const on = title === tab;
            const tabColor = sheetColor(salesTabColorFor(title)) || C.brand;
            return (
              <Btn
                key={title}
                id={`fp-sheet-tab-${index}`}
                type="button"
                variant="bare"
                aria-pressed={on}
                onClick={() => selectSheetTab(title)}
                title={loadingTab === title ? `${title} 불러오는 중` : title}
                className={`fp-sheet-view__tab${loadingTab === title ? ' is-loading' : ''}`}
                // Btn의 bare 기본값은 inline 12px/여백 0이다. 이 특수한 하단 탭만은
                // 실제 스프레드시트 레일 치수(37px/12px/12px 좌측 여백)를 명시해 CSS와 같은 값을 보장한다.
                style={{
                  '--fp-sheet-tab-color': tabColor,
                  height: 37,
                  minHeight: 37,
                  boxSizing: 'border-box',
                  padding: '0 10px 0 12px',
                  borderRadius: 0,
                  fontSize: 'var(--text-base)',
                  fontWeight: 'var(--fw-medium)',
                  lineHeight: '36px',
                  letterSpacing: 0,
                  color: on ? tabColor : C.mute,
                  background: on ? `color-mix(in srgb, ${tabColor} 12%, var(--fp-sheet-rail))` : 'transparent',
                } as CSSProperties}
              >{title}</Btn>
            );
          })}
        </div>
        <div className="fp-sheet-view__tab-tools">
          <IconBtn
            title="상품리스트 다시 읽기"
            haptic={false}
            onClick={refreshAllTabs}
            style={{ border: 'none', background: 'transparent', color: C.mute, boxShadow: 'none' }}
          ><RefreshCw size={ICON.md} className={refreshing ? 'fp-sheet-view__refreshing' : undefined} /></IconBtn>
          <Btn
            type="button"
            size="sm"
            variant="ghost"
            disabled={!canCopyForCustomer}
            title={customerCopyTitle}
            haptic={false}
            onClick={() => void copyCustomerProduct(selectedProduct, 'link')}
          ><Link2 size={ICON.sm} aria-hidden />링크 복사</Btn>
          <Btn
            type="button"
            size="sm"
            variant="ghost"
            disabled={!canCopyForCustomer}
            title={customerCopyTitle}
            haptic={false}
            onClick={() => void copyCustomerProduct(selectedProduct, 'text')}
          ><Copy size={ICON.sm} aria-hidden />텍스트 복사</Btn>
          {finderFilterActive ? <span className="fp-sheet-view__global-filter">{finderFilterPending ? 'ERP 조건 확인 중' : 'ERP 조건 적용'}</span> : null}
          {hasTableState ? (
            <Btn type="button" variant="bare" className="fp-sheet-view__clear" title="필터와 정렬 초기화" onClick={clearTableState} haptic={false}>
              <RotateCcw size={ICON.sm} />초기화
            </Btn>
          ) : null}
          {grid.originalSheetHref ? (
            <a
              className="fp-sheet-view__open-original"
              href={grid.originalSheetHref}
              target="_blank"
              rel="noopener noreferrer"
              title="원본 Google Sheet를 새 탭에서 엽니다"
            ><ExternalLink size={ICON.sm} />원본 시트 열기</a>
          ) : null}
          <span className="fp-sheet-view__tab-meta">
            {grid.maskedColumns.length > 0 ? '일부 열은 권한에 따라 숨김 · ' : ''}{readTime(grid.readAt)}
          </span>
        </div>
      </div>

      {openColumn ? (
        <SheetColumnFilterPopover
          key={`${grid.tab}-${openColumn.column}`}
          column={openColumn.column}
          label={grid.header[openColumn.column] || '열'}
          x={openColumn.x}
          y={openColumn.y}
          entries={filterEntries}
          selected={filters[openColumn.column]}
          sort={sort}
          onChange={(selection) => applyFilter(openColumn.column, selection)}
          onSort={setSort}
          onClose={() => closeColumn(openColumn.column)}
          onDismiss={(restoreHeaderFocus) => {
            if (restoreHeaderFocus) closeColumn(openColumn.column);
            else setOpenColumn(null);
          }}
        />
      ) : null}
    </div>
  );
}
