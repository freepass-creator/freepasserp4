'use client';

import { useEffect, useState } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import { getStore, peekList } from '@/lib/store';
import { seedIfEmpty } from '@/lib/seed';
import { firebaseReady } from '@/lib/firebase/client';
import { withProviderNames } from '@/lib/domain/identity';
import { listHiddenCodes, subscribeHidden } from '@/lib/product-hide';
import { listPassedCodes, subscribePassed } from '@/lib/product-pass';
import { isGuest } from '@/lib/auth-session';

type Params = {
  companyId: string;
  authReady: boolean;
  sessionUid?: string;
};

export function useFinderData({ companyId, authReady, sessionUid }: Params) {
  const [rows, setRows] = useState<EntityRecord[] | null>(() => peekList('product', companyId));
  const [hiddenCodes, setHiddenCodes] = useState<Set<string>>(() => new Set());
  const [passedCodes, setPassedCodes] = useState<Set<string>>(() => new Set());

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
      if (isGuest()) {
        try {
          const response = await fetch('/api/catalog/feed', { cache: 'no-store' });
          if (!response.ok) throw new Error(`guest catalog HTTP ${response.status}`);
          const payload = await response.json() as { products?: EntityRecord[] };
          if (active) setRows(Array.isArray(payload.products) ? payload.products : []);
        } catch (error) {
          console.warn('[finder] guest catalog load failed:', error);
          if (active) setRows([]);
        }
        return;
      }
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
        if (active) setRows(withProviderNames(products, partners));
      } catch (error) {
        console.warn('[finder] 매물 로드 실패:', error);
        if (active) setRows([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [authReady, companyId, sessionUid]);

  return { rows, hiddenCodes, passedCodes };
}
