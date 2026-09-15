'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { getStore, peekList } from '@/lib/store';
import { seedIfEmpty } from '@/lib/seed';
import { firebaseReady, getAuthClient } from '@/lib/firebase/client';
import { withProviderNames } from '@/lib/domain/identity';
import { fetchFirestoreProducts, subscribeFirestoreProducts, shapeFinderRows } from '@/lib/firebase/firestore-products-client';

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
  /** Firestore 읽기 경로(플래그 ON)일 때 onSnapshot 해지 핸들. */
  fsUnsub?: () => void;
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
    rows: peekList('product', params.companyId), listeners: new Set(),
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
 * Firestore 읽기 경로(플래그 ON) — onSnapshot 로 구독해 «바뀐 문서만」 받는다(RTDB 대역폭 컷).
 * 가시성·원가 규칙은 shapeFinderRows(=listForFinder 와 동일 함수)로 재적용한다.
 */
function startFirestore(entry: FinderDataEntry) {
  if (entry.fsUnsub) return;
  const streamId = ++entry.requestId;
  let received = false;
  let fallbackStarted = false;
  const active = () => entries.get(entry.key) === entry && entry.requestId === streamId;
  const fallback = async (reason: unknown) => {
    if (fallbackStarted || !active()) return;
    fallbackStarted = true;
    console.warn('[finder] Firestore 직접 구독 지연/실패 → Firestore 서버 재조회:', reason);
    try {
      const raw = await fetchFirestoreProducts();
      if (!active() || received) return;
      entry.rows = shapeFinderRows(raw);
      entry.loadedAt = Date.now();
      entry.retryAfter = 0;
      notify(entry);
    } catch (error) {
      fallbackStarted = false;
      console.warn('[finder] Firestore 서버 재조회 실패:', error);
      if (active() && !received) {
        entry.rows = entry.rows ?? [];
        entry.retryAfter = Date.now() + RETRY_AFTER_ERROR_MS;
        notify(entry);
      }
    }
  };
  const watchdog = window.setTimeout(() => void fallback('initial snapshot timeout'), 3_000);
  entry.fsUnsub = subscribeFirestoreProducts(
    (raw, meta) => {
      if (!active() || meta.fromCache) return;
      received = true;
      window.clearTimeout(watchdog);
      const providerNames = new Map((entry.rows || []).map((row) => [String(row.product_code || row._key || ''), row.provider_name]));
      const shaped = shapeFinderRows(raw).map((row) => ({
        ...row,
        provider_name: row.provider_name || providerNames.get(String(row.product_code || row._key || '')),
      }));
      entry.rows = shaped;
      entry.loadedAt = Date.now();
      entry.retryAfter = 0;
      notify(entry);
    },
    (err) => {
      // 실패를 폐기된 RTDB로 숨기지 않고 같은 Firestore의 인증 서버 읽기로 한 번 재시도한다.
      if (!active()) return;
      entry.fsUnsub = undefined;
      received = false;
      window.clearTimeout(watchdog);
      void fallback(err);
    },
  );
}

/** 현재 세션 외의 목록은 메모리에서 즉시 폐기해 역할/사용자 전환 때 재사용하지 않는다. */
export function discardOtherFinderData(sessionUid?: string, sessionScope?: string) {
  for (const [key, entry] of entries) {
    if (entry.sessionUid === sessionUid && entry.key === entryKey({ companyId: entry.companyId, authReady: true, sessionUid, sessionScope })) continue;
    entry.fsUnsub?.();
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
  // Firestore 읽기 경로(플래그 ON): 실 UID 복원 뒤에만 onSnapshot 한 번 걸고 poll 은 안 탄다.
  //   아직 인증 전이면 «안 건다» — sessionUid 가 실 UID 로 바뀌면 store 키가 바뀌어 재구독되고, 그때 시작한다(㉠).
  if (firebaseReady()) {
    if (canLoad) startFirestore(entry);
    return () => { entry.listeners.delete(listener); };
  }
  const now = Date.now();
  const stale = entry.loadedAt === 0 || now - entry.loadedAt >= REVALIDATE_AFTER_MS;
  if (canLoad && stale && now >= entry.retryAfter) void loadProducts(entry);
  return () => {
    entry.listeners.delete(listener);
  };
}

export function getFinderDataSnapshot(params: FinderDataParams): EntityRecord[] | null {
  return getEntry(params).rows;
}
