'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { listHiddenCodes, subscribeHidden } from '@/lib/product-hide';
import { listPassedCodes, subscribePassed } from '@/lib/product-pass';
import {
  discardOtherFinderData,
  getFinderDataSnapshot,
  subscribeFinderData,
  type FinderDataParams,
} from '@/features/finder/finder-data-store';

type Params = FinderDataParams;

/**
 * 상품찾기·ERP5·상품 상세가 쓰는 목록 단일 진입점.
 * 데이터/실시간 상태는 사용자별 공용 store에서 읽고, 화면 고유인 숨김·통과 표식만 여기서 구독한다.
 */
export function useFinderData(params: Params) {
  const key = `${params.companyId}::${params.sessionUid || 'anonymous'}::${params.sessionScope || 'default'}::${params.authReady ? 'ready' : 'waiting'}`;
  const subscribe = useMemo(
    () => (listener: () => void) => subscribeFinderData(params, listener),
    // params object 자체는 호출마다 새로 만들어질 수 있어 primitive만 계약으로 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const getSnapshot = useMemo(
    () => () => getFinderDataSnapshot(params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const rows = useSyncExternalStore(subscribe, getSnapshot, () => null);

  useEffect(() => { discardOtherFinderData(params.sessionUid, params.sessionScope); }, [params.sessionUid, params.sessionScope]);

  const [hiddenCodes, setHiddenCodes] = useState<Set<string>>(() => new Set(listHiddenCodes()));
  const [passedCodes, setPassedCodes] = useState<Set<string>>(() => new Set(listPassedCodes()));
  useEffect(() => {
    const refreshHidden = () => setHiddenCodes(new Set(listHiddenCodes()));
    const refreshPassed = () => setPassedCodes(new Set(listPassedCodes()));
    refreshHidden();
    refreshPassed();
    const unsubscribeHidden = subscribeHidden(refreshHidden);
    const unsubscribePassed = subscribePassed(refreshPassed);
    return () => { unsubscribeHidden(); unsubscribePassed(); };
  }, []);

  return { rows, hiddenCodes, passedCodes };
}
