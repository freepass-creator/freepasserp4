'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { getStore, peekList } from '@/lib/store';
import { seedIfEmpty } from '@/lib/seed';
import { firebaseReady } from '@/lib/firebase/client';
import { fetchSheetLiveStatuses, SHEET_LIVE_STATUS_POLL_MS } from '@/lib/firebase/sheet-live-status-client';
import { withProviderNames } from '@/lib/domain/identity';

export type FinderDataParams = {
  companyId: string;
  authReady: boolean;
  sessionUid?: string;
  /** 같은 UID라도 역할·소속이 바뀌면 이전 목록을 절대 재사용하지 않는다. */
  sessionScope?: string;
};

type FinderSessionScope = {
  role?: string;
  rawRole?: string;
  company_code?: string;
  is_active?: string;
} | null | undefined;

/** 목록 가시성에 영향을 주는 세션 축. 호출부에서 역할 키를 제각각 조립하지 않는다. */
export function finderDataScope(session: FinderSessionScope): string {
  return `${session?.role || ''}:${session?.rawRole || ''}:${session?.company_code || ''}:${session?.is_active || ''}`;
}

type FinderDataEntry = {
  key: string; companyId: string; sessionUid?: string; rows: EntityRecord[] | null;
  liveStatuses: Record<string, string> | null; listeners: Set<() => void>;
  loading: boolean; loadedAt: number; retryAfter: number; requestId: number; statusRefreshing: boolean;
  statusController: AbortController | null; statusTimer: number | null;
  onFocus: (() => void) | null; onVisibility: (() => void) | null;
};

const entries = new Map<string, FinderDataEntry>();
const REVALIDATE_AFTER_MS = 30_000;
const RETRY_AFTER_ERROR_MS = 5_000;

function entryKey({ companyId, sessionUid, sessionScope }: FinderDataParams) {
  // 목록은 역할에 따라 가려질 수 있으므로 회사만으로 cache를 공유하지 않는다.
  return `${companyId}::${sessionUid || 'anonymous'}::${sessionScope || 'default'}`;
}

function withLiveStatuses(rows: EntityRecord[], statuses: Record<string, string>): EntityRecord[] {
  let changed = false;
  const next = rows.map((row) => {
    const key = String(row._key || row.product_code || '');
    if (!Object.prototype.hasOwnProperty.call(statuses, key)) return row;
    const status = String(statuses[key] || '').trim();
    if (String(row.vehicle_status || '').trim() === status) return row;
    changed = true;
    return { ...row, vehicle_status: status };
  });
  return changed ? next : rows;
}

function notify(entry: FinderDataEntry) { for (const listener of entry.listeners) listener(); }

function getEntry(params: FinderDataParams): FinderDataEntry {
  const key = entryKey(params);
  const existing = entries.get(key);
  if (existing) return existing;
  const entry: FinderDataEntry = {
    key, companyId: params.companyId, sessionUid: params.sessionUid,
    rows: peekList('product', params.companyId), liveStatuses: null, listeners: new Set(),
    loading: false, loadedAt: 0, retryAfter: 0, requestId: 0, statusRefreshing: false, statusController: null,
    statusTimer: null, onFocus: null, onVisibility: null,
  };
  entries.set(key, entry);
  return entry;
}

async function loadProducts(entry: FinderDataEntry) {
  if (entry.loading) return;
  entry.loading = true;
  const requestId = ++entry.requestId;
  try {
    await seedIfEmpty(entry.companyId);
    const timeout = <T,>(promise: Promise<T>) => Promise.race([
      promise,
      new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('finder list timeout')), 15_000)),
    ]);
    const [products, partners] = await timeout(Promise.all([
      getStore().list('product', entry.companyId), getStore().list('partner', entry.companyId),
    ]));
    if (entries.get(entry.key) !== entry || requestId !== entry.requestId) return;
    const named = withProviderNames(products, partners);
    entry.rows = entry.liveStatuses ? withLiveStatuses(named, entry.liveStatuses) : named;
    entry.loadedAt = Date.now();
    entry.retryAfter = 0;
    notify(entry);
  } catch (error) {
    console.warn('[finder] 매물 로드 실패:', error);
    if (entries.get(entry.key) === entry && requestId === entry.requestId) {
      entry.rows = entry.rows ?? [];
      entry.retryAfter = Date.now() + RETRY_AFTER_ERROR_MS;
      notify(entry);
    }
  } finally {
    if (entries.get(entry.key) === entry && requestId === entry.requestId) entry.loading = false;
  }
}

async function refreshLiveStatuses(entry: FinderDataEntry) {
  if (entry.statusRefreshing || document.visibilityState === 'hidden') return;
  entry.statusRefreshing = true;
  try {
    const statuses = await fetchSheetLiveStatuses(entry.statusController?.signal);
    if (!statuses || entries.get(entry.key) !== entry) return;
    entry.liveStatuses = statuses;
    if (entry.rows) {
      const next = withLiveStatuses(entry.rows, statuses);
      if (next !== entry.rows) { entry.rows = next; notify(entry); }
    }
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') console.warn('[finder] 차량상태 실시간 갱신 실패(기존 상태 유지):', (error as Error).message);
  } finally {
    if (entries.get(entry.key) === entry) entry.statusRefreshing = false;
  }
}

/**
 * ★★**꺼 둔다 — 상품찾기는 «상품리스트» 하나만 본다.** (사장님 2026-09-01)
 *
 * > 「댓수가 올라오면 **580 몇 대에서 한 1초 있다가 680 몇 대로 바뀐다**. 왜 이렇게 바뀌냐고.
 * >  우리는 **그대로 상품 리스트를 연동해서 갖고 오는 거밖에 없는데.** 그럼 상품 바로 뜨면 되지.」
 *
 * 무슨 일이었나 — 화면이 **두 번** 그려졌다.
 *   1차(즉시)  ERP 목록 그대로                                     582대
 *   2차(1초 뒤) `/api/sheet/live-status` = `runSheetLiveStatusSync` 가
 *              **브라우저를 열 때마다 공급사 시트들을 그 자리에서 다시 읽어** 상태를 덮어씀 → 대수가 늘어남
 *   게다가 `SHEET_LIVE_STATUS_POLL_MS`(60초)마다 **보고 있는 중에도 또** 바뀌었다.
 *
 * 연동지도상 시트를 읽어 ERP 에 반영하는 일은 **매시간 자동동기(`hourly-sync`)의 몫**이다.
 * 화면이 그 일을 한 번 더 하면, 대수가 두 군데서 세어져 **어느 숫자도 못 믿게 된다.**
 * 상태가 늦게 반영되는 것은 회차가 해결한다 — 화면은 ERP 가 말하는 것만 말한다.
 *
 * ⚠ 되살리려면 **대수가 바뀌지 않는 방식**이어야 한다(상태 글자만 갱신 · 목록에 없던 차를 세우지 않음).
 *   그게 안 되면 켜지 마라. 밑의 `refreshLiveStatuses`·`withLiveStatuses` 는 그때 쓰라고 남겨 둔다.
 */
const LIVE_STATUS_OVERLAY = false;

function startLiveStatuses(entry: FinderDataEntry, params: FinderDataParams) {
  if (!LIVE_STATUS_OVERLAY) return;
  if (!firebaseReady() || !params.authReady || !params.sessionUid || entry.statusTimer != null) return;
  entry.statusController = new AbortController();
  const refresh = () => { void refreshLiveStatuses(entry); };
  entry.onFocus = refresh;
  entry.onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
  refresh();
  entry.statusTimer = window.setInterval(refresh, SHEET_LIVE_STATUS_POLL_MS);
  window.addEventListener('focus', entry.onFocus);
  document.addEventListener('visibilitychange', entry.onVisibility);
}

function stopLiveStatuses(entry: FinderDataEntry) {
  entry.statusController?.abort();
  entry.statusController = null;
  if (entry.statusTimer != null) window.clearInterval(entry.statusTimer);
  entry.statusTimer = null;
  if (entry.onFocus) window.removeEventListener('focus', entry.onFocus);
  if (entry.onVisibility) document.removeEventListener('visibilitychange', entry.onVisibility);
  entry.onFocus = null;
  entry.onVisibility = null;
}

/** 현재 세션 외의 목록은 메모리에서 즉시 폐기해 역할/사용자 전환 때 재사용하지 않는다. */
export function discardOtherFinderData(sessionUid?: string, sessionScope?: string) {
  for (const [key, entry] of entries) {
    if (entry.sessionUid === sessionUid && entry.key === entryKey({ companyId: entry.companyId, authReady: true, sessionUid, sessionScope })) continue;
    stopLiveStatuses(entry);
    entries.delete(key);
  }
}

export function subscribeFinderData(params: FinderDataParams, listener: () => void) {
  const entry = getEntry(params);
  entry.listeners.add(listener);
  const now = Date.now();
  const stale = entry.loadedAt === 0 || now - entry.loadedAt >= REVALIDATE_AFTER_MS;
  if (!(firebaseReady() && !params.authReady) && stale && now >= entry.retryAfter) void loadProducts(entry);
  startLiveStatuses(entry, params);
  return () => {
    entry.listeners.delete(listener);
    // Finder → 상세 → Finder 전환에서는 목록을 재사용하되, 보이지 않는 동안은 폴링하지 않는다.
    if (entry.listeners.size === 0) stopLiveStatuses(entry);
  };
}

export function getFinderDataSnapshot(params: FinderDataParams): EntityRecord[] | null {
  return getEntry(params).rows;
}
