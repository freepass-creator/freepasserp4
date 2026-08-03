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
        // 권한이 확인되면 4패널 골격을 먼저 보여주고, 독립 read는 병렬 실행한다.
        // 정책 → 상품 → 파트너 순차 대기는 공급사 재고 진입을 매번 1초 이상 늦췄다.
        setAccess(true);
        setGateMessage('');
        const [loadedPolicies] = await Promise.all([
          getStore().list('policy', companyId),
          loadProducts(role),
        ]);
        setPolicies(loadedPolicies);
        void loadMasterRef.current().catch(() => {});
        // 업무 목록 공통 규격: 화면 진입은 목록부터 시작하고, 사용자가 행을 선택해야 상세를 연다.
        clearSelectionRef.current();
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
        await loadProducts(role);
        clearSelectionRef.current();
      })();
    };
    window.addEventListener('fp:role', onRole);
    return () => window.removeEventListener('fp:role', onRole);
  }, [loadProducts, setAccess, setGateMessage]);

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
