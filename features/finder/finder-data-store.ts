'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { getStore, peekList } from '@/lib/store';
import { seedIfEmpty } from '@/lib/seed';
import { firebaseReady, getAuthClient } from '@/lib/firebase/client';
import { shapeFinderRows } from '@/lib/firebase/firestore-products-client';

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
  listeners: Set<() => void>;
  loading: boolean; loadedAt: number; retryAfter: number; requestId: number;
  /** canonical ERP5 API 폴링/포커스 갱신 해지 핸들. */
  stopErp5?: () => void;
};

const entries = new Map<string, FinderDataEntry>();
const REVALIDATE_AFTER_MS = 30_000;
const RETRY_AFTER_ERROR_MS = 5_000;

function entryKey({ companyId, sessionUid, sessionScope }: FinderDataParams) {
  // 목록은 역할에 따라 가려질 수 있으므로 회사만으로 cache를 공유하지 않는다.
  return `${companyId}::${sessionUid || 'anonymous'}::${sessionScope || 'default'}`;
}

function notify(entry: FinderDataEntry) { for (const listener of entry.listeners) listener(); }

function getEntry(params: FinderDataParams): FinderDataEntry {
  const key = entryKey(params);
  const existing = entries.get(key);
  if (existing) return existing;
  const entry: FinderDataEntry = {
    key, companyId: params.companyId, sessionUid: params.sessionUid,
    rows: firebaseReady() ? null : peekList('product', params.companyId), listeners: new Set(),
    loading: false, loadedAt: 0, retryAfter: 0, requestId: 0,
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
    // 상품은 손님에게 바로 보이는 핵심 데이터다. 공급사명 보정까지 Promise.all로 묶으면
    // 느린 partner read 하나 때문에 이미 받은 상품 목록도 빈 화면에 묶인다.
    const store = getStore();
    // RtdbAdapter는 상품찾기에서만 공급사명 조인을 미뤄, 목록을 먼저 반환한다.
    // 다른 어댑터는 표준 list로 동일하게 동작한다.
    const products = await timeout(
      typeof store.listForFinder === 'function'
        ? store.listForFinder(entry.companyId)
        : store.list('product', entry.companyId),
    );
    if (entries.get(entry.key) !== entry || requestId !== entry.requestId) return;
    entry.rows = products;
    entry.loadedAt = Date.now();
    entry.retryAfter = 0;
    notify(entry);

    // 공급사명은 후속 보정이다. 실패하거나 늦어도 상품 표시를 되돌리거나 막지 않는다.
    try {
      const partners = await timeout(getStore().list('partner', entry.companyId));
      if (entries.get(entry.key) !== entry || requestId !== entry.requestId) return;
      const named = withProviderNames(products, partners);
      entry.rows = named;
      notify(entry);
    } catch (error) {
      console.warn('[finder] 공급사명 보정 실패(상품 목록은 유지):', error);
    }
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

/**
 * 로그인 ERP의 상품찾기는 인증은 ERP4 Firebase로 확인하되, 상품 값은 서버 `/api/products`
 * 를 통해 canonical ERP5에서 직접 받는다.
 *
 * ★중요: 실패 시 옛 ERP4 products로 폴백하지 않는다. 서로 다른 원장을 조용히 섞는 것보다
 * 마지막 정상 목록을 유지하고 재시도하는 편이 SSOT에 맞다.
 */
async function loadErp5Products(entry: FinderDataEntry) {
  if (entry.loading) return;
  const user = getAuthClient()?.currentUser;
  if (!user) return;
  entry.loading = true;
  const requestId = ++entry.requestId;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/products', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`ERP5 Finder feed HTTP ${res.status}`);
    const raw = await res.json() as EntityRecord[];
    if (!Array.isArray(raw)) throw new Error('ERP5 Finder feed shape 오류');
    if (entries.get(entry.key) !== entry || requestId !== entry.requestId) return;
    entry.rows = shapeFinderRows(raw);
    entry.loadedAt = Date.now();
    entry.retryAfter = 0;
    notify(entry);
  } catch (error) {
    console.warn('[finder] ERP5 canonical feed 실패:', error);
    if (entries.get(entry.key) === entry && requestId === entry.requestId) {
      entry.rows = entry.rows ?? [];
      entry.retryAfter = Date.now() + RETRY_AFTER_ERROR_MS;
      notify(entry);
    }
  } finally {
    if (entries.get(entry.key) === entry && requestId === entry.requestId) entry.loading = false;
  }
}

/** 열린 상품찾기 = 30초 주기 + 포커스/탭 복귀 즉시 재확인. 서버 ERP5 캐시는 최대 60초다. */
function startErp5(entry: FinderDataEntry) {
  if (entry.stopErp5) return;
  const tick = () => {
    if (document.visibilityState === 'visible' && Date.now() >= entry.retryAfter) void loadErp5Products(entry);
  };
  void loadErp5Products(entry);
  const timer = window.setInterval(tick, REVALIDATE_AFTER_MS);
  const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
  window.addEventListener('focus', tick);
  document.addEventListener('visibilitychange', onVisible);
  entry.stopErp5 = () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', tick);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** 현재 세션 외의 목록은 메모리에서 즉시 폐기해 역할/사용자 전환 때 재사용하지 않는다. */
export function discardOtherFinderData(sessionUid?: string, sessionScope?: string) {
  for (const [key, entry] of entries) {
    if (entry.sessionUid === sessionUid && entry.key === entryKey({ companyId: entry.companyId, authReady: true, sessionUid, sessionScope })) continue;
    entry.stopErp5?.();
    entries.delete(key);
  }
}

export function subscribeFinderData(params: FinderDataParams, listener: () => void) {
  const entry = getEntry(params);
  entry.listeners.add(listener);
  // ★실 인증 UID 복원 뒤에만 시작한다 — RTDB·Firestore 경로 공통(㉠). AuthProvider 의 화면 보호용 ready
  //   타이머(최대 6초)는 Firebase 사용자 복원보다 먼저 끝날 수 있어, 인증 전 요청/구독은 규칙에 막힌다.
  const firebaseUserReady = !!params.sessionUid
    && getAuthClient()?.currentUser?.uid === params.sessionUid;
  const canLoad = !firebaseReady() || firebaseUserReady;
  // 운영 Firebase가 준비된 로그인 세션은 canonical ERP5 API만 쓴다.
  if (firebaseReady()) {
    if (canLoad) startErp5(entry);
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) { entry.stopErp5?.(); entry.stopErp5 = undefined; }
    };
  }

  // 로컬 미리보기(Firebase 미설정)만 기존 LocalAdapter를 쓴다.
  const now = Date.now();
  const stale = entry.loadedAt === 0 || now - entry.loadedAt >= REVALIDATE_AFTER_MS;
  if (canLoad && stale && now >= entry.retryAfter) void loadProducts(entry);
  return () => { entry.listeners.delete(listener); };
}

export function getFinderDataSnapshot(params: FinderDataParams): EntityRecord[] | null {
  return getEntry(params).rows;
}
