'use client';

import { useEffect, useRef, useState } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import { getStore, peekList } from '@/lib/store';
import { seedIfEmpty } from '@/lib/seed';
import { firebaseReady } from '@/lib/firebase/client';
import { fetchSheetLiveStatuses, SHEET_LIVE_STATUS_POLL_MS } from '@/lib/firebase/sheet-live-status-client';
import { withProviderNames } from '@/lib/domain/identity';
import { listHiddenCodes, subscribeHidden } from '@/lib/product-hide';
import { listPassedCodes, subscribePassed } from '@/lib/product-pass';

type Params = {
  companyId: string;
  authReady: boolean;
  sessionUid?: string;
};

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

export function useFinderData({ companyId, authReady, sessionUid }: Params) {
  const [rows, setRows] = useState<EntityRecord[] | null>(() => peekList('product', companyId));
  const [hiddenCodes, setHiddenCodes] = useState<Set<string>>(() => new Set());
  const [passedCodes, setPassedCodes] = useState<Set<string>>(() => new Set());
  const latestLiveStatuses = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    const refreshHidden = () => setHiddenCodes(new Set(listHiddenCodes()));
    const refreshPassed = () => setPassedCodes(new Set(listPassedCodes()));
    refreshHidden();
    refreshPassed();
    const unsubscribeHidden = subscribeHidden(refreshHidden);
    const unsubscribePassed = subscribePassed(refreshPassed);
    return () => {
      unsubscribeHidden();
      unsubscribePassed();
    };
  }, []);

  useEffect(() => {
    if (firebaseReady() && !authReady) return;
    let active = true;
    (async () => {
      try {
        await seedIfEmpty(companyId);
      } catch (error) {
        console.warn('[finder] 시드 실패(계속):', error);
      }
      try {
        const timeout = <T,>(promise: Promise<T>) => Promise.race([
          promise,
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error('finder list timeout')), 15000)),
        ]);
        const [products, partners] = await timeout(Promise.all([
          getStore().list('product', companyId),
          getStore().list('partner', companyId),
        ]));
        if (active) {
          const named = withProviderNames(products, partners);
          setRows(latestLiveStatuses.current
            ? withLiveStatuses(named, latestLiveStatuses.current)
            : named);
        }
      } catch (error) {
        console.warn('[finder] 매물 로드 실패:', error);
        if (active) setRows([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [authReady, companyId, sessionUid]);

  useEffect(() => {
    if (!firebaseReady() || !authReady || !sessionUid) return;
    let active = true;
    let refreshing = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (!active || refreshing || document.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        const statuses = await fetchSheetLiveStatuses(controller.signal);
        if (!active || !statuses) return;
        latestLiveStatuses.current = statuses;
        setRows((current) => current ? withLiveStatuses(current, statuses) : current);
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') {
          console.warn('[finder] 차량상태 실시간 갱신 실패(기존 상태 유지):', (error as Error).message);
        }
      } finally {
        refreshing = false;
      }
    };
    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, SHEET_LIVE_STATUS_POLL_MS);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authReady, companyId, sessionUid]);

  return { rows, hiddenCodes, passedCodes };
}
