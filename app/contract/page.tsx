'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getStore, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { contractStage, getProgress, isContractCancelled, isContractCompleted } from '@/lib/domain/contract';
import { contractVehicleLabel } from '@/lib/domain/vehicle-label';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import { createSettlement } from '@/lib/domain/settlement-engine';
import { requirePositiveRentAmount } from '@/lib/domain/contract-money';
import { settlementNetTone } from '@/lib/domain/settlement-display';
import { downloadSettlementsExcel } from '@/lib/excel-export';
import { CheckCircle2, Download, Files, ListChecks, PauseCircle, RotateCcw, Save, ShieldCheck, WalletCards } from 'lucide-react';
import { getRole, actor, createBlankContract, type Role } from '@/lib/domain/deal';
import { getSession } from '@/lib/auth-session';
import { canAccessOwnedRecord, organizationRole } from '@/lib/domain/authorization';
import { providerNameMap, withProviderNames } from '@/lib/domain/identity';
import { initAuth } from '@/lib/firebase/auth';
import { man } from '@/lib/format';
import { PaneHead, PaneBody, Badge, Btn, ButtonLabel, Input, won, C, R, NUM, Loading, CenterNote, ListGroup, SETTLEMENT_STATUS_TONE, FilterChips, FilterGroup, Select, FW, FS, FeedRowSkeleton, KV_LABEL_W, rowPadY, ICON, Modal, FormGrid } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { ContractPanel } from '@/components/ContractPanel';
import { ContractDocs } from '@/components/ContractDocs';
import { ContractCreateRow, ContractListRow } from '@/components/list-rows';
import { NAV_LABEL } from '@/lib/tabbar';
import { toast } from '@/components/Toaster';
import { haptic } from '@/lib/haptics';
import {
  CONTRACT_FILTER_OPTIONS as CONT_FILTERS,
  CONTRACT_SORT_OPTIONS as CONT_SORTS,
  contractMonthLabel as labelMonth,
  contractMonthOptions,
  contractPreviewCount,
  contractWorkflowGroup,
  filterContracts,
  type ContractFilter as ContFilter,
  type ContractSort as ContSort,
} from '@/features/contract/contract-filter';
import { joinMetaText, retainVisibleSelection, workPartyParts } from '@/features/work-list-display';
import { findRoomForContract } from '@/features/chat/room-display';

const PAGE = 100; // 파인더와 동일 — 첫 화면·더보기 단위

// 계약 = [목록 | 계약진행상황 | 첨부서류 | 정산상태] 4프레임.
// 진행상황은 문의(/chat) ContractPanel과 동일 SSOT. 발송·단계는 패널 안.

// R1/R2 금액 편집 원자 — 입력은 로컬 draft, 명시적 저장 버튼에서만 커밋.
// 실패하면 onCommit이 false/throw → draft를 val로 롤백한다.
function AmtInput({ val, label, onCommit }: { val: number; label: string; onCommit: (n: number) => Promise<boolean> | boolean }) {
  const [draft, setDraft] = useState(val ? val.toLocaleString() : '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(val ? val.toLocaleString() : ''); }, [val]);
  const parsed = Number(draft.replace(/[^\d]/g, '')) || 0;
  const dirty = parsed !== val;
  const commit = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const ok = await onCommit(parsed);
      if (!ok) setDraft(val ? val.toLocaleString() : '');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
      <Input value={draft} onChange={setDraft} placeholder="0" ariaLabel={`${label} 금액`} inputMode="numeric" size="sm" full
        disabled={saving}
        style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', textAlign: 'right', background: dirty ? C.warnBg : undefined }} />
      <Btn
        title={`${label} 저장`}
        size="sm"
        variant={dirty ? 'solid' : 'ghost'}
        disabled={!dirty || saving}
        onClick={() => { void commit(); }}
      >
        <ButtonLabel icon={<Save size={ICON.md} aria-hidden />}>
          {saving ? '저장 중…' : '저장'}
        </ButtonLabel>
      </Btn>
    </div>
  );
}

export default function ContractsSettlement() {
  const co = getCompanyId();
  const mobile = useIsMobile();
  // 같은 세션의 문의→계약 이동에서는 이미 권한 스코프로 읽은 계약 캐시를 즉시 그린다.
  // 백그라운드 load가 곧 최신값으로 교체하므로 목록 전환 때 골격 화면으로 되돌아가지 않는다.
  const [rows, setRows] = useState<EntityRecord[] | null>(() => {
    const cached = peekList('contract', co);
    if (!cached) return null;
    return cached
      .filter((contract) => canAccessOwnedRecord(getSession(), contract))
      .slice()
      .sort((a, b) => String(b.contract_date || '').localeCompare(String(a.contract_date || '')));
  });
  const [sel, setSel] = useState<string | null>(null);
  const [selC, setSelC] = useState<EntityRecord | null>(null);
  const [selS, setSelS] = useState<EntityRecord | null>(null);
  const [selProduct, setSelProduct] = useState<EntityRecord | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [setts, setSetts] = useState<EntityRecord[]>(() => (
    peekList('settlement', co)?.filter((settlement) => canAccessOwnedRecord(getSession(), settlement)) || []
  ));
  const [catalogProducts, setCatalogProducts] = useState<EntityRecord[]>([]);
  const [partnerRows, setPartnerRows] = useState<EntityRecord[]>(() => peekList('partner', co) || []);
  const settsRef = useRef<EntityRecord[]>(setts);
  const catalogLoading = useRef(false);
  const selectionEpoch = useRef(0);
  const selectedCodeRef = useRef<string | null>(null);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [role, setRoleS] = useState<Role>('agent');
  const [qInput, setQInput] = useState(''); // 검색창 즉시 반영
  const [q, setQ] = useState(''); // 디바운스된 검색
  const [sort, setSort] = useState<ContSort | ''>('date');
  const [flt, setFlt] = useState<ContFilter>('진행');
  const [draftFlt, setDraftFlt] = useState<ContFilter>('진행');
  /** '' = 전체 월. contract_date YYYY-MM */
  const [monthFlt, setMonthFlt] = useState('');
  const [draftMonthFlt, setDraftMonthFlt] = useState('');
  /** 모바일 스왑 — 진행중=계약진행상황 · 계약완료=정산 */
  const [swapKey, setSwapKey] = useState('progress');
  const [limit, setLimit] = useState(PAGE);
  /**
   * 매물 없이 계약서만 만드는 창.
   * 당사자(공급사)는 비울 수 없다 — 비면 그 계약을 아무도 못 본다(역할 스코프).
   * 그래서 등록 즉시 만들지 않고 최소 정보를 먼저 받는다.
   */
  const [blank, setBlank] = useState<null | {
    providerCompanyCode: string; customerName: string; customerPhone: string;
    carNumber: string; vehicleName: string;
  }>(null);
  const [blankSaving, setBlankSaving] = useState(false);
  const [providers, setProviders] = useState<{ value: string; label: string }[]>([]);

  // 검색 디바운스 — 타이핑마다 계약 필터 전량 재계산 방지
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 180);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => { setLimit(PAGE); }, [q, flt, monthFlt, sort]);

  const monthOptions = useMemo(() => contractMonthOptions(rows || []), [rows]);

  const productIndex = useMemo(() => {
    const byId = new Map<string, EntityRecord>();
    const byCar = new Map<string, EntityRecord>();
    const providerByCode = new Map<string, string>();
    for (const product of catalogProducts) {
      for (const raw of [product.product_code, product.product_uid, product._key, product._rtdb_key]) {
        const key = String(raw || '').trim();
        if (key) byId.set(key, product);
      }
      const car = String(product.car_number || '').trim();
      if (car) byCar.set(car, product);
      const providerCode = String(product.provider_company_code || product.partner_code || '').trim();
      const providerName = String(product.provider_name || product.provider_name_full || '').trim();
      if (providerCode && providerName && providerName !== providerCode) providerByCode.set(providerCode, providerName);
    }
    for (const [providerCode, providerName] of Object.entries(providerNameMap(partnerRows))) {
      if (providerCode && providerName && providerName !== providerCode) providerByCode.set(providerCode, providerName);
    }
    return { byId, byCar, providerByCode };
  }, [catalogProducts, partnerRows]);
  const productForContract = (contract: EntityRecord): EntityRecord | undefined => (
    productIndex.byId.get(String(contract.product_code || ''))
    || productIndex.byId.get(String(contract.product_uid || ''))
    || productIndex.byCar.get(String(contract.car_number_snapshot || ''))
  );
  const contractName = (contract: EntityRecord) => contractVehicleLabel(contract, productForContract(contract));
  const contractPlate = (contract: EntityRecord) => String(
    contract.car_number_snapshot || productForContract(contract)?.car_number || '',
  ).trim();
  const contractParty = (contract: EntityRecord) => {
    const product = productForContract(contract);
    const providerCode = String(contract.provider_company_code || contract.partner_code || product?.provider_company_code || '').trim();
    // 이관 데이터는 provider_name 칸에도 코드(RP013)가 들어 있다. 실제 파트너명을
    // 찾았는데 앞선 코드값이 가리는 일이 없도록 코드와 같은 후보를 전부 건너뛴다.
    const providerName = [
      product?.provider_name,
      product?.provider_name_full,
      contract.provider_name,
      contract.provider_company_name,
      productIndex.providerByCode.get(providerCode),
    ]
      .map((value) => String(value || '').trim())
      .find((value) => value && value !== providerCode) || '';
    return workPartyParts(organizationRole(getSession()) || role, contract, { providerName });
  };

  const load = async (r: Role): Promise<EntityRecord[]> => {
    setRoleS(r);
    const store = getStore();
    // 공급사 표시명은 대용량 상품·삭제이력보다 먼저 독립 조회한다. 계약 캐시를 즉시
    // 그릴 때 RP013 같은 내부코드가 수 초간 노출되지 않게 한다.
    void store.list('partner', co).then(setPartnerRows).catch(() => {});
    if (!catalogLoading.current && catalogProducts.length === 0) {
      catalogLoading.current = true;
      void Promise.all([
        typeof store.listRaw === 'function' ? store.listRaw('product', co) : store.list('product', co),
        store.listDeleted('product', co).catch(() => []),
      ]).then(async ([products, deleted]) => {
        // 삭제 이력 먼저, 현재 상품을 나중에 두어 같은 식별자는 현재 값이 이긴다.
        let catalog = [...deleted, ...products];
        const needsProviderName = catalog.some((product) => {
          const code = String(product.provider_company_code || product.partner_code || '').trim();
          const name = String(product.provider_name || product.provider_name_full || '').trim();
          return !!code && (!name || name === code);
        });
        if (needsProviderName) {
          const partners = await store.list('partner', co).catch(() => []);
          catalog = withProviderNames(catalog, partners);
        }
        setCatalogProducts(catalog);
      }).catch((error) => {
        catalogLoading.current = false;
        console.error('[contract] 차량명 보강 실패(상품·삭제이력):', error);
      });
    }
    // 목록 표시를 정산 조회가 막지 않게 분리한다. 정산은 목록 행에 필요하지 않고
    // 상세 선택 시 같은 store Promise를 재사용하므로 백그라운드 선조회만 해두면 된다.
    const settlementsP = store.list('settlement', co);
    const all = await store.list('contract', co);
    const mine = all.filter((c) => canAccessOwnedRecord(getSession(), c));
    mine.sort((a, b) => String(b.contract_date || '').localeCompare(String(a.contract_date || '')));
    setRows(mine);
    void settlementsP.then((allS) => {
      const mineS = allS.filter((s) => canAccessOwnedRecord(getSession(), s));
      setSetts(mineS);
      settsRef.current = mineS;
    }).catch((error) => {
      console.warn('[contract] 정산 목록 선조회 실패:', (error as Error).message);
    });
    return mine;
  };
  const settlementForContract = (items: EntityRecord[], contractCode: unknown) => {
    const code = String(contractCode || '').trim();
    if (!code) return null;
    const settlementCode = `ST_${code}`;
    return items.find((item) => (
      String(item.contract_code || '').trim() === code
      || String(item.settlement_code || item._key || '').trim() === settlementCode
    )) || null;
  };
  const selectContract = async (c: EntityRecord) => {
    const selectedCode = String(c.contract_code || '').trim();
    selectedCodeRef.current = selectedCode;
    const epoch = ++selectionEpoch.current;
    const cachedSettlement = settlementForContract(settsRef.current, c.contract_code);
    setSel(selectedCode); setSelC(c);
    setSelProduct(null); setRoomId(null);
    setSelS(cachedSettlement); setSettlementLoading(!cachedSettlement);
    setSwapKey(isContractCompleted(c) ? 'settle' : 'progress');
    const [settsList, prod, room] = await Promise.all([
      getStore().list('settlement', co),
      getStore().get('product', co, String(c.product_code)).catch(() => null),
      getStore().list('room', co).then((rooms) => (
        findRoomForContract(rooms, c)?._key as string | undefined
      )).catch((error) => {
        console.warn('[contract] 기존 채팅방 조회 실패:', error);
        return null;
      }),
    ]);
    if (epoch !== selectionEpoch.current) return;
    let s = cachedSettlement || settlementForContract(settsList, c.contract_code);
    if (!s) {
      s = await getStore().get('settlement', co, `ST_${String(c.contract_code || '').trim()}`).catch(() => null);
    }
    // 상세 조회는 read-only다. 정산 생성은 계약 단계 완료 직후 reloadSel 경로에서만 수행한다.
    if (epoch !== selectionEpoch.current) return;
    setSelS(s);
    setSelProduct(prod || productForContract(c) || null);
    setRoomId(room || null);
    setSettlementLoading(false);
  };
  const clearSel = (preserveQuery = false) => {
    selectedCodeRef.current = null;
    selectionEpoch.current += 1;
    setSel(null); setSelC(null); setSelS(null); setSelProduct(null); setRoomId(null); setSwapKey('progress');
    setSettlementLoading(false);
    if (!preserveQuery && typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      if (u.searchParams.has('c')) {
        u.searchParams.delete('c');
        const q = u.searchParams.toString();
        window.history.replaceState({}, '', u.pathname + (q ? `?${q}` : '') + u.hash);
      }
    }
  };
  const reloadSel = async (changedCode?: string) => {
    const selectedCode = selectedCodeRef.current;
    // A의 늦은 완료 콜백이 이미 선택한 B의 상세·정산을 되돌리지 못하게 한다.
    if (!selectedCode || (changedCode && changedCode !== selectedCode)) {
      await load(getRole());
      return;
    }
    const epoch = selectionEpoch.current;
    const isCurrent = () => epoch === selectionEpoch.current && selectedCodeRef.current === selectedCode;
    setSettlementLoading(true);
    const all = await load(getRole());
    if (!isCurrent()) return;
    const c = all.find((x) => String(x.contract_code) === selectedCode);
    if (c) {
      setSelC(c);
      if (isContractCompleted(c)) setSwapKey('settle');
      const settsList = await getStore().list('settlement', co);
      if (!isCurrent()) return;
      let s = settlementForContract(settsList, selectedCode);
      if (!s) {
        s = await getStore().get('settlement', co, `ST_${selectedCode}`).catch(() => null);
      }
      if (!isCurrent()) return;
      if (!s && isContractCompleted(c)) {
        const r = getRole();
        const canCreate = r === 'admin'
          || (r === 'provider' && String(c.provider_company_code) === actor('provider').code);
        if (canCreate && isCurrent()) {
          try {
            await createSettlement(c);
            const again = await getStore().list('settlement', co);
            s = settlementForContract(again, selectedCode);
          } catch (e) {
            toast(`정산 생성 실패: ${String((e as Error)?.message || e)}`, 'error');
          }
        }
      }
      if (!isCurrent()) return;
      setSelS(s);
    }
    if (isCurrent()) setSettlementLoading(false);
  };

  useEffect(() => { (async () => {
    await initAuth();
    await seedIfEmpty(co); const all = await load(getRole());
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('c') : null;
    // 페이지 진입은 목록 조회만 한다. ?c= 명시 링크만 해당 계약을 연다.
    const target = wanted ? all.find((x) => String(x.contract_code) === wanted) : undefined;
    if (target) {
      if (wanted && isContractCancelled(target)) {
        setFlt('계약취소');
        setDraftFlt('계약취소');
      }
      if (target) selectContract(target);
    }
    // 계약등록 창에서 고를 공급사 목록 — 당사자는 비울 수 없으므로 미리 받아 둔다.
    try {
      const partners = await getStore().list('partner', co);
      setProviders(
        partners
          .filter((p) => String(p.partner_type || '').includes('공급') || p.provider_company_code)
          .map((p) => ({
            value: String(p.partner_code || p._key || ''),
            label: String(p.name || p.partner_name || p.partner_code || ''),
          }))
          .filter((p) => p.value && p.label),
      );
    } catch { /* 목록을 못 받아도 화면은 열린다 */ }
  })(); /* eslint-disable-next-line */ }, []);

  /** 계약등록 — 매물 없이 계약서만. 관리자·공급사만 만들 수 있다. */
  const canCreateBlank = role === 'admin' || role === 'provider';
  const newBlankContract = async () => {
    const mine = role === 'provider' ? actor('provider').code : '';
    setBlank({ providerCompanyCode: mine, customerName: '', customerPhone: '', carNumber: '', vehicleName: '' });
  };
  const saveBlankContract = async () => {
    if (!blank) return;
    if (!blank.providerCompanyCode.trim()) { toast('공급사를 골라 주세요', 'error'); return; }
    if (!blank.customerName.trim()) { toast('고객명을 입력해 주세요', 'error'); return; }
    setBlankSaving(true);
    try {
      const code = await createBlankContract({
        providerCompanyCode: blank.providerCompanyCode,
        customerName: blank.customerName,
        customerPhone: blank.customerPhone,
        carNumber: blank.carNumber,
        vehicleName: blank.vehicleName,
      });
      setBlank(null);
      const all = await load(getRole());
      const made = all.find((x) => String(x.contract_code) === code);
      if (made) selectContract(made);
      haptic.success();
      toast('계약이 등록되었습니다', 'ok');
    } catch (e) {
      toast(`등록 실패: ${String((e as Error)?.message || e)}`, 'error');
    } finally {
      setBlankSaving(false);
    }
  };

  // ?c= 계약이 첫 load에 없으면 목록 갱신 시 재시도(이미 다른 건 선택 중이면 스킵).
  useEffect(() => {
    if (!rows || sel) return;
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('c') : null;
    if (!wanted) return;
    const target = rows.find((x) => String(x.contract_code) === wanted);
    if (target) {
      if (isContractCancelled(target)) {
        setFlt('계약취소');
        setDraftFlt('계약취소');
      }
      void selectContract(target);
    }
  }, [rows, sel]);

  useEffect(() => { const on = (e: Event) => { const r = (e as CustomEvent).detail as Role; (async () => {
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('c') : null;
    const all = await load(r);
    clearSel(true);
    if (!mobile && all.length && wanted) {
      const target = all.find((c) => String(c.contract_code) === wanted);
      if (wanted && target && isContractCancelled(target)) {
        setFlt('계약취소');
        setDraftFlt('계약취소');
      }
      if (target) selectContract(target);
    }
  })(); }; window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); /* eslint-disable-next-line */ }, [mobile]);

  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === '/contract') clearSel();
    };
    window.addEventListener('fp:work-list', on);
    return () => window.removeEventListener('fp:work-list', on);
  }, []);

  const shownAll = useMemo(() => filterContracts({
    contracts: rows || [], query: q, filter: flt, month: monthFlt, sort,
    searchText: (contract) => joinMetaText([
      contractName(contract), contractPlate(contract), contractStage(contract).label, ...contractParty(contract),
    ]),
  }), [rows, q, flt, monthFlt, sort, productIndex, role]);

  // 필터·검색·월 조건에서 사라진 행의 상세는 남기지 않는다. 페이지네이션은 가시성 조건이 아니다.
  useEffect(() => {
    if (!rows || !sel) return;
    const visible = shownAll.map((contract) => String(contract.contract_code));
    if (retainVisibleSelection(sel, visible) === sel) return;
    clearSel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, shownAll, sel]);

  const shown = shownAll.slice(0, limit);
  const moreCount = Math.max(0, shownAll.length - shown.length);
  const draftPreviewCount = useMemo(() => contractPreviewCount({
    contracts: rows || [], query: q, filter: draftFlt, month: draftMonthFlt,
    searchText: (contract) => joinMetaText([
      contractName(contract), contractPlate(contract), contractStage(contract).label, ...contractParty(contract),
    ]),
  }), [rows, q, draftFlt, draftMonthFlt, productIndex, role]);
  const filterActive = (flt !== '진행' ? 1 : 0) + (monthFlt ? 1 : 0);
  const uiFlt = mobile ? draftFlt : flt;
  const uiMonth = mobile ? draftMonthFlt : monthFlt;
  const listEl = shownAll.length === 0
    ? (
      <CenterNote>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <span>{q || filterActive > 0 ? '검색 결과 없음' : '표시할 계약이 없습니다.'}</span>
          {(q || filterActive > 0) ? (
            <Btn title="조건 해제" size="sm" variant="ghost" onClick={() => { setQInput(''); setQ(''); setFlt('진행'); setMonthFlt(''); }}>조건 해제</Btn>
          ) : null}
        </div>
      </CenterNote>
    )
    : (
      <div>
        {/*
          등록은 «목록 맨 위 한 자리»로 — 재고(InventoryCreateRow)·정책(PolicyCreateRow)과 같은 규격.
          보통 계약은 매물에서 파생되지만, 재고에 없는 차인데 계약서만 보내는 경우가 있다.
        */}
        {canCreateBlank && <ContractCreateRow onClick={() => { void newBlankContract(); }} />}
        {shown.map((c) => (
          <ContractListRow
            key={String(c.contract_code)}
            c={c}
            displayName={contractName(c)}
            plate={contractPlate(c)}
            party={contractParty(c)}
            selected={String(c.contract_code) === sel}
            onClick={() => { void selectContract(c); }}
          />
        ))}
        {moreCount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 14px' }}>
            <Btn
              title={`더보기 ${Math.min(PAGE, moreCount)}건`}
              variant="ghost"
              size="sm"
              onClick={() => setLimit((n) => n + PAGE)}
            >
              {`더보기 · ${Math.min(PAGE, moreCount).toLocaleString()}건`}
            </Btn>
          </div>
        )}
      </div>
    );

  // 라벨 열 폭은 DetailGrid(116)와 같은 값 하나로. 110/120 두 갈래라 값 시작선이 10px 어긋났다.
  //  구분선은 ListGroup이 자식마다 그어 주므로 여기서 borderTop을 또 긋지 않는다(카드선과 2겹).
  const kv = (k: string, v: React.ReactNode, valueColor?: string) => (
    <div style={{ display: 'flex', padding: '8px 12px', fontSize: FS.sub }}>
      <span style={{ width: KV_LABEL_W, flex: `0 0 ${KV_LABEL_W}px`, color: C.mute }}>{k}</span>
      <span style={{ fontWeight: valueColor ? FW.head : FW.strong, color: valueColor || C.ink, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );

  const setStatus = async (to: string) => {
    if (!selS || role !== 'admin') return;
    if (to === '정산완료') {
      try {
        requirePositiveRentAmount(selS.rent_amount, '정산 확정');
      } catch (e) {
        toast(String((e as Error)?.message || e), 'error');
        return;
      }
    }
    try {
      await getStore().update('settlement', co, String(selS.settlement_code), { settlement_status: to });
    } catch (e) {
      toast(`정산 상태 변경 실패: ${String((e as Error)?.message || e)}`, 'error');
      return;
    }
    const allS = await getStore().list('settlement', co);
    setSetts(allS.filter((s) => canAccessOwnedRecord(getSession(), s)));
    setSelS(allS.find((x) => String(x.settlement_code) === String(selS.settlement_code)) || null);
  };
  const setAmount = async (settlementCode: string, field: 'fee_amount' | 'agent_payout', value: number): Promise<boolean> => {
    const targetSettlementCode = String(settlementCode || '').trim();
    const targetContractCode = selectedCodeRef.current;
    const epoch = selectionEpoch.current;
    if (!selS || !targetContractCode || String(selS.settlement_code) !== targetSettlementCode) return false;
    const fee = field === 'fee_amount' ? value : Number(selS.fee_amount) || 0;
    const payout = field === 'agent_payout' ? value : Number(selS.agent_payout) || 0;
    try {
      await getStore().update('settlement', co, targetSettlementCode, { [field]: value, net_amount: fee - payout });
    } catch (e) {
      toast(`정산 금액 저장 실패: ${String((e as Error)?.message || e)}`, 'error');
      return false;
    }
    const allS = await getStore().list('settlement', co);
    setSetts(allS.filter((s) => canAccessOwnedRecord(getSession(), s)));
    if (epoch === selectionEpoch.current && selectedCodeRef.current === targetContractCode) {
      setSelS(allS.find((x) => String(x.settlement_code) === targetSettlementCode) || null);
    }
    return true;
  };
  const amtRow = (label: string, field: 'fee_amount' | 'agent_payout', val: number, code: string) => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', fontSize: FS.sub }}>
      <span style={{ width: KV_LABEL_W, flex: `0 0 ${KV_LABEL_W}px`, color: C.mute }}>{label}</span>
      {role === 'admin'
        ? <AmtInput key={`${code}-${field}`} val={val} label={label} onCommit={(n) => setAmount(code, field, n)} />
        : <span style={{ fontWeight: FW.head, color: C.brand, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(val)}원</span>}
    </div>
  );
  const detailSettle = () => {
    if (!selC) return <CenterNote>계약 완료 시 정산이 자동 생성됩니다.</CenterNote>;
    if (settlementLoading) return <CenterNote>정산 기록 확인 중…</CenterNote>;
    if (!selS) return <CenterNote>{isContractCompleted(selC) ? '정산 기록 없음' : '계약 완료 시 정산이 자동 생성됩니다.'}</CenterNote>;
    const s = selS; const st = String(s.settlement_status); const cb = Number(s.clawback_amount) || 0;
    const net = (Number(s.fee_amount) || 0) - (Number(s.agent_payout) || 0);
    return (
      <div>
        {/* 형제(뱃지·버튼)가 전부 nowrap 이라 축소 부담을 코드 혼자 져서 'ST_…-01' 이 두 줄로 쪼개졌다.
            코드는 말줄임으로 접고, 액션이 안 들어가면 줄을 바꾼다. */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, rowGap: rowPadY(true), padding: '12px 12px' }}>
          <span style={{ fontSize: FS.body, fontWeight: FW.title, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', minWidth: 0, flex: '0 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(s.settlement_code)}</span>
          <Badge tone={SETTLEMENT_STATUS_TONE[st] || 'gray'}>{st}</Badge>
          <span style={{ flex: 1 }} />
          {role === 'admin' && st === '정산대기' && (
            <Btn title="정산 보류" variant="ghost" size="sm" onClick={() => setStatus('정산보류')}>
              <ButtonLabel icon={<PauseCircle size={ICON.md} aria-hidden />}>보류</ButtonLabel>
            </Btn>
          )}
          {role === 'admin' && st === '정산대기' && (
            <Btn title="정산 확정" size="sm" onClick={() => setStatus('정산완료')}>
              <ButtonLabel icon={<CheckCircle2 size={ICON.md} aria-hidden />}>정산 확정</ButtonLabel>
            </Btn>
          )}
          {role === 'admin' && st === '정산보류' && (
            <Btn title="정산 대기로 변경" size="sm" onClick={() => setStatus('정산대기')}>
              <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>대기로</ButtonLabel>
            </Btn>
          )}
          {role === 'admin' && st === '환수대기' && (
            <Btn title="환수 확정" size="sm" onClick={() => setStatus('환수결정')}>
              <ButtonLabel icon={<ShieldCheck size={ICON.md} aria-hidden />}>환수 확정</ButtonLabel>
            </Btn>
          )}
        </div>
        <div style={{ margin: '0 12px' }}>
        <ListGroup>
          {role !== 'agent' && amtRow('공급사 청구 (R1)', 'fee_amount', Number(s.fee_amount) || 0, String(s.settlement_code))}
          {role !== 'provider' && amtRow('영업자 지급 (R2)', 'agent_payout', Number(s.agent_payout) || 0, String(s.settlement_code))}
          {role === 'admin' && kv('순수익 (R1−R2)', `${won(net)}원`, C[settlementNetTone(net)])}
          {cb > 0 ? kv('환수액', `${won(cb)}원`) : null}
        </ListGroup>
        </div>
        <div style={{ padding: '10px 12px', fontSize: FS.cap, color: C.faint, lineHeight: 1.6 }}>공급사에서 <b>받은 금액(R1)</b>·영업자에 <b>준 금액(R2)</b>을 실측 기록(관리자 편집, 율=기본값). 순수익=R1−R2. 중도취소 시 환수(경과비례).</div>
      </div>
    );
  };

  const progressBody = selC && isContractCancelled(selC)
    ? <CenterNote>{joinMetaText([selC.contract_code, '취소된 계약입니다.'])}</CenterNote>
    : sel
    ? <ContractPanel
        key={sel}
        product={selProduct}
        roomId={roomId || undefined}
        linkedCode={sel}
        agentCode={selC ? String(selC.agent_code || '') : undefined}
        onChange={reloadSel}
      />
    : <CenterNote>계약을 선택하세요.</CenterNote>;

  const docsBody = sel
    ? <ContractDocs key={sel} contractCode={sel} roomId={roomId || undefined} readOnly={isContractCancelled(selC)} />
    : <CenterNote>계약을 선택하세요.</CenterNote>;

  // 웹 = 3패널 나란히(+목록 = 4프레임) → 어느 칸이 무엇인지 PaneHead로 구분.
  // 모바일 = 스왑(한 번에 한 칸) + 하단 세그먼트가 이미 「진행·서류·정산」을 표시 →
  //   PaneHead는 같은 말 반복 + 틀고정으로 세로를 먹는다. 문의(/chat) 모바일 pane과 동일하게 헤드 없이 본문만.
  const panes: WorkPane[] = mobile
    ? [
      { key: 'progress', title: '진행', icon: ListChecks, node: <PaneBody>{progressBody}</PaneBody> },
      { key: 'docs', title: '서류', icon: Files, node: <PaneBody>{docsBody}</PaneBody> },
      { key: 'settle', title: '정산', icon: WalletCards, node: <PaneBody>{detailSettle()}</PaneBody> },
    ]
    : [
      { key: 'progress', title: '진행', icon: ListChecks, node: <><PaneHead title="계약 진행상황" /><PaneBody>{progressBody}</PaneBody></> },
      { key: 'docs', title: '서류', icon: Files, node: <><PaneHead title="첨부 서류" /><PaneBody>{docsBody}</PaneBody></> },
      { key: 'settle', title: '정산', icon: WalletCards, node: <><PaneHead title="정산상태" /><PaneBody>{detailSettle()}</PaneBody></> },
    ];

  return (
    <>
      <WorkPage title={NAV_LABEL.contract || '계약'} statusLabel="처리 대기"
        statusCount={rows === null ? null : rows.filter((c) => !['계약완료', '계약취소'].includes(contractWorkflowGroup(c))).length}
        listCount={rows === null ? null : shownAll.length}
        list={rows === null ? <FeedRowSkeleton /> : listEl} panes={panes} selected={!!sel} onBack={clearSel}
        contextTitle={selC ? joinMetaText([
          vehicleNameOf({
            kind: 'contract',
            contract: selC,
            product: selProduct || productForContract(selC),
          }, { tier: 'full', fallback: 'none' }),
          selC.customer_name,
        ]) : undefined}
        search={{ value: qInput, onChange: setQInput, placeholder: '계약·차번·계약자·전화·영업·공급…' }}
        mobileLayout="swap"
        mobileSwapKey={swapKey}
        onMobileSwapKeyChange={setSwapKey}
        listTools={{
          search: { value: qInput, onChange: setQInput, placeholder: '계약·차번·계약자·전화·영업·공급…' },
          action: !mobile && setts.length ? { label: '엑셀', icon: Download, onClick: () => downloadSettlementsExcel(setts, new Date().toISOString().slice(0, 10), role) } : undefined,
          /* 모바일 = 정렬 없음(기본 최근순) — 사장님 2026-08-22 「계약진행도 어려운 필터 없이 최대한 심플하게」. */
          sort: mobile ? undefined : { value: sort, onChange: (v) => setSort(v as ContSort | ''), options: CONT_SORTS, defaultValue: 'date' },
          filter: {
            count: filterActive,
            title: '조건 검색',
            previewCount: draftPreviewCount,
            previewUnit: '건',
            dirty: draftFlt !== flt || draftMonthFlt !== monthFlt,
            capture: () => { setDraftFlt(flt); setDraftMonthFlt(monthFlt); },
            restore: () => { setDraftFlt(flt); setDraftMonthFlt(monthFlt); },
            commit: () => { setFlt(draftFlt); setMonthFlt(draftMonthFlt); },
            onClear: () => {
              if (mobile) { setDraftFlt('진행'); setDraftMonthFlt(''); }
              else { setFlt('진행'); setMonthFlt(''); }
            },
            body: (
              <>
                {/* 계약월은 웹만 — 모바일 필터는 업무단계 칩 하나로(사장님 2026-08-22 「어려운 필터 없이 최대한 심플하게」). */}
                {!mobile && (
                <FilterGroup
                  title="계약월"
                  count={uiMonth ? 1 : 0}
                  defaultOpen
                  first
                  onClear={() => setMonthFlt('')}
                >
                  <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
                    <Select
                      full
                      value={uiMonth}
                      onChange={(v) => setMonthFlt(v)}
                      placeholder="전체"
                      options={monthOptions}
                    />
                  </div>
                </FilterGroup>
                )}
                <FilterGroup
                  title="업무단계"
                  count={uiFlt === '진행' ? 0 : 1}
                  defaultOpen
                  first={mobile}
                  onClear={() => mobile ? setDraftFlt('진행') : setFlt('진행')}
                >
                  {/* 모바일 = 굵은 다섯 칩만(단계별 «N 진행»·테스트 제외) — 단계 상세는 열 눌러 보는 게 아니라 카드가 이미 보여 준다. */}
                  <FilterChips
                    value={uiFlt}
                    onChange={mobile ? setDraftFlt : setFlt}
                    options={mobile
                      ? CONT_FILTERS.filter((o) => ['all', '진행', '확인 필요', '계약완료', '계약취소'].includes(String(o.key)))
                      : CONT_FILTERS}
                  />
                </FilterGroup>
              </>
            ),
          },
          hints: [
            ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
            ...(sort && sort !== 'date' ? [CONT_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...(monthFlt ? [labelMonth(monthFlt)] : []),
            ...(flt !== '진행' ? [CONT_FILTERS.find((option) => option.key === flt)?.label || flt] : []),
          ],
          onClearHints: () => { setQInput(''); setQ(''); setSort('date'); setFlt('진행'); setMonthFlt(''); },
        }}
      />

      {/*
        계약등록 — 매물 없이 계약서만 보낼 때.
        여기서 «공급사»를 반드시 받는다. 당사자가 비면 그 계약을 아무도 못 본다(역할 스코프).
        차량·금액은 나중에 채운다 — 신차라 번호가 아직 없는 경우와 같은 자리다.
      */}
      {blank && (
        <Modal
          title="계약등록"
          meta="매물 없이 계약서만 보낼 때 씁니다"
          width={520}
          onClose={() => setBlank(null)}
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn title="취소" variant="ghost" onClick={() => setBlank(null)} disabled={blankSaving}>취소</Btn>
              <Btn title="등록" onClick={() => { void saveBlankContract(); }} disabled={blankSaving}>
                {blankSaving ? '등록 중…' : '등록'}
              </Btn>
            </div>
          }
        >
          <div style={{ display: 'grid', gap: 10 }}>
            <FormGrid
              cols={2}
              showNotes
              form={blank as unknown as EntityRecord}
              onChange={(k: string, v: string) => setBlank((b) => (b ? { ...b, [k]: v } : b))}
              selectOptions={{ providerCompanyCode: providers }}
              fields={[
                {
                  key: 'providerCompanyCode',
                  label: '공급사',
                  type: 'select',
                  required: true,
                  options: [],
                  note: '비우면 그 계약을 아무도 못 봅니다',
                },
                { key: 'customerName', label: '고객명', type: 'text', required: true, note: '' },
                { key: 'customerPhone', label: '연락처', type: 'text', note: '' },
                { key: 'carNumber', label: '차량번호', type: 'text', note: '신차면 비워 두세요' },
                { key: 'vehicleName', label: '차명', type: 'text', note: '' },
              ]}
            />
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: C.mute }}>
              대여기간·월 대여료·보증금은 약정에서 확정합니다. 수수료율은 매물이 없어 지금 굳히지 않고
              정산 시점에 해석합니다.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
