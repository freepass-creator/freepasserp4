'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStore, peekList } from '@/lib/store';
import { seedIfEmpty } from '@/lib/seed';
import type { EntityRecord } from '@/lib/intake/entities';
import { actor, getRole, type Role } from '@/lib/domain/deal';
import { withProviderNames } from '@/lib/domain/identity';
import { NAV_LABEL } from '@/lib/tabbar';
import { scopeInventoryPolicies } from '@/lib/domain/policy-access';

export function useInventoryData(companyId: string) {
  const [rows, setRows] = useState<EntityRecord[] | null>(() => peekList('product', companyId));
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const [partners, setPartners] = useState<EntityRecord[]>([]);
  const [access, setAccess] = useState<boolean | null>(null);
  const [gateMessage, setGateMessage] = useState('');
  const loadEpochRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    loadEpochRef.current += 1;
  }, []);

  const loadProducts = useCallback(async (role: Role) => {
    const epoch = ++loadEpochRef.current;
    const store = getStore();
    // 두 요청은 같이 시작하되 상품이 도착하면 공급사 명칭 보강을 기다리지 않고 먼저 그린다.
    const productRequest = store.list('product', companyId);
    const partnerRequest = store.list('partner', companyId);
    const all = await productRequest;
    if (!mountedRef.current || epoch !== loadEpochRef.current) return [];
    const visible = role === 'provider'
      ? all.filter((product) => String(product.provider_company_code) === actor('provider').code)
      : all;
    const cachedPartners = peekList('partner', companyId) || [];
    const quickRows = withProviderNames(visible, cachedPartners);
    setRows(quickRows);

    const partners = await partnerRequest.catch(() => cachedPartners);
    if (!mountedRef.current || epoch !== loadEpochRef.current) return [];
    const named = withProviderNames(visible, partners);
    setPartners(partners);
    setRows(named);
    return named;
  }, [companyId]);

  return {
    rows,
    setRows,
    policies,
    setPolicies,
    partners,
    access,
    setAccess,
    gateMessage,
    setGateMessage,
    loadProducts,
  };
}

type InventoryAccessOptions = {
  companyId: string;
  loadProducts: (role: Role) => Promise<EntityRecord[]>;
  setPolicies: (policies: EntityRecord[]) => void;
  setAccess: (access: boolean) => void;
  setGateMessage: (message: string) => void;
  loadMaster: () => Promise<unknown>;
  clearSelection: () => void;
};

export function useInventoryAccessEffects({
  companyId,
  loadProducts,
  setPolicies,
  setAccess,
  setGateMessage,
  loadMaster,
  clearSelection,
}: InventoryAccessOptions) {
  const clearSelectionRef = useRef(clearSelection);
  const loadMasterRef = useRef(loadMaster);
  const accessEpochRef = useRef(0);
  clearSelectionRef.current = clearSelection;
  loadMasterRef.current = loadMaster;

  useEffect(() => {
    const epoch = ++accessEpochRef.current;
    void (async () => {
      try {
        await seedIfEmpty(companyId);
        const role = getRole();
        if (!canAccessInventory(role)) {
          setPolicies([]);
          setGateMessage(`${NAV_LABEL.inventory}는 공급사·관리자만 사용할 수 있습니다.`);
          setAccess(false);
          return;
        }
        // 권한이 확인되면 4패널 골격을 먼저 보여주고, 독립 read는 병렬 실행한다.
        // 정책 → 상품 → 파트너 순차 대기는 공급사 재고 진입을 매번 1초 이상 늦췄다.
        setAccess(true);
        setGateMessage('');
        const [loadedPolicies] = await Promise.all([
          getStore().list('policy', companyId),
          loadProducts(role),
        ]);
        if (epoch !== accessEpochRef.current) return;
        setPolicies(scopeInventoryPolicies(loadedPolicies, role, role === 'provider' ? actor('provider').code : ''));
        void loadMasterRef.current().catch(() => {});
        // 업무 목록 공통 규격: 화면 진입은 목록부터 시작하고, 사용자가 행을 선택해야 상세를 연다.
        clearSelectionRef.current();
      } catch (error) {
        if (epoch !== accessEpochRef.current) return;
        setGateMessage('재고 로드 실패: ' + String((error as Error).message || error));
        setAccess(false);
      }
    })();
    return () => { accessEpochRef.current += 1; };
    // 최초 진입 시점의 역할과 화면 모드로 한 번만 초기화한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onRole = (event: Event) => {
      void (async () => {
        const epoch = ++accessEpochRef.current;
        const role = (event as CustomEvent).detail as Role;
        if (!canAccessInventory(role)) {
          setPolicies([]);
          setGateMessage(`${NAV_LABEL.inventory}는 공급사·관리자만 사용할 수 있습니다.`);
          setAccess(false);
          return;
        }
        setAccess(true);
        setGateMessage('');
        const [loadedPolicies] = await Promise.all([
          getStore().list('policy', companyId),
          loadProducts(role),
        ]);
        if (epoch !== accessEpochRef.current) return;
        setPolicies(scopeInventoryPolicies(loadedPolicies, role, role === 'provider' ? actor('provider').code : ''));
        clearSelectionRef.current();
      })();
    };
    window.addEventListener('fp:role', onRole);
    return () => window.removeEventListener('fp:role', onRole);
  }, [companyId, loadProducts, setAccess, setGateMessage, setPolicies]);

  useEffect(() => {
    const onWorkList = (event: Event) => {
      if ((event as CustomEvent).detail === '/inventory') clearSelectionRef.current();
    };
    window.addEventListener('fp:work-list', onWorkList);
    return () => window.removeEventListener('fp:work-list', onWorkList);
  }, []);
}

function canAccessInventory(role: Role) {
  return role === 'admin' || role === 'provider';
}
