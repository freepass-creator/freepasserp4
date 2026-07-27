'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStore, peekList } from '@/lib/store';
import { seedIfEmpty } from '@/lib/seed';
import type { EntityRecord } from '@/lib/intake/entities';
import { actor, getRole, type Role } from '@/lib/domain/deal';
import { withProviderNames } from '@/lib/domain/identity';
import { NAV_LABEL } from '@/lib/tabbar';

export function useInventoryData(companyId: string) {
  const [rows, setRows] = useState<EntityRecord[] | null>(() => peekList('product', companyId));
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const [partners, setPartners] = useState<EntityRecord[]>([]);
  const [access, setAccess] = useState<boolean | null>(null);
  const [gateMessage, setGateMessage] = useState('');

  const loadProducts = useCallback(async (role: Role) => {
    const [all, partners] = await Promise.all([
      getStore().list('product', companyId),
      getStore().list('partner', companyId),
    ]);
    const visible = role === 'provider'
      ? all.filter((product) => String(product.provider_company_code) === actor('provider').code)
      : all;
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
  mobile: boolean;
  loadProducts: (role: Role) => Promise<EntityRecord[]>;
  setPolicies: (policies: EntityRecord[]) => void;
  setAccess: (access: boolean) => void;
  setGateMessage: (message: string) => void;
  loadMaster: () => Promise<unknown>;
  selectProduct: (product: EntityRecord) => Promise<void>;
  clearSelection: () => void;
};

export function useInventoryAccessEffects({
  companyId,
  mobile,
  loadProducts,
  setPolicies,
  setAccess,
  setGateMessage,
  loadMaster,
  selectProduct,
  clearSelection,
}: InventoryAccessOptions) {
  const selectProductRef = useRef(selectProduct);
  const clearSelectionRef = useRef(clearSelection);
  const loadMasterRef = useRef(loadMaster);
  selectProductRef.current = selectProduct;
  clearSelectionRef.current = clearSelection;
  loadMasterRef.current = loadMaster;

  useEffect(() => {
    void (async () => {
      try {
        await seedIfEmpty(companyId);
        const role = getRole();
        if (!canAccessInventory(role)) {
          setGateMessage(`${NAV_LABEL.inventory}는 공급사·관리자만 사용할 수 있습니다.`);
          setAccess(false);
          return;
        }
        setPolicies(await getStore().list('policy', companyId));
        const all = await loadProducts(role);
        setAccess(true);
        void loadMasterRef.current().catch(() => {});
        if (!mobile && all.length) void selectProductRef.current(all[0]);
      } catch (error) {
        setGateMessage('재고 로드 실패: ' + String((error as Error).message || error));
        setAccess(false);
      }
    })();
    // 최초 진입 시점의 역할과 화면 모드로 한 번만 초기화한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onRole = (event: Event) => {
      void (async () => {
        const role = (event as CustomEvent).detail as Role;
        if (!canAccessInventory(role)) {
          setGateMessage(`${NAV_LABEL.inventory}는 공급사·관리자만 사용할 수 있습니다.`);
          setAccess(false);
          return;
        }
        setAccess(true);
        setGateMessage('');
        const all = await loadProducts(role);
        clearSelectionRef.current();
        if (!mobile && all.length) void selectProductRef.current(all[0]);
      })();
    };
    window.addEventListener('fp:role', onRole);
    return () => window.removeEventListener('fp:role', onRole);
  }, [loadProducts, mobile, setAccess, setGateMessage]);

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
