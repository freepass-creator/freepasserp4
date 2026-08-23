'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCompanyId } from '@/lib/tenant';
import { PRODUCT_TYPES, type EntityRecord } from '@/lib/intake/entities';
import { getRole } from '@/lib/domain/deal';
import { VEHICLE_DISPLAY_STATUSES, canonProductType, normalizeVehicleDisplayStatus, vehicleName } from '@/lib/domain/product';
import { PaneHead, PaneBody, Btn, C, Loading, CenterNote, Page, ToggleChips, FilterGroup, PageActions, FW, FS, FeedRowSkeleton } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { useResolvedLinkPhotos } from '@/components/use-product-photos';
import dynamic from 'next/dynamic';
import { useIsMobile } from '@/lib/use-mobile';
import { NAV_LABEL } from '@/lib/tabbar';
import { toggleInSet } from '@/lib/set';
import { useInventoryResults, type InventorySort as InvSort } from '@/features/inventory/useInventoryResults';
import { InventoryListPanel, type InventoryListPanelModel } from '@/features/inventory/InventoryListPanel';
import type { InventoryEditorModel } from '@/features/inventory/InventoryEditorPanes';
import { useInventoryVehicleTools } from '@/features/inventory/useInventoryVehicleTools';
import { useInventoryEditorLifecycle } from '@/features/inventory/useInventoryEditorLifecycle';
import { useInventoryAccessEffects, useInventoryData } from '@/features/inventory/useInventoryData';
import { retainVisibleSelection } from '@/features/work-list-display';
import { EMPTY_CATALOG, type VehicleCatalog } from '@/lib/domain/vehicle-catalog';
const INV_SORTS: { value: InvSort; label: string }[] = [
  { value: 'status', label: '상태순' },
  { value: 'name', label: '차명순' },
  { value: 'plate', label: '차번순' },
  { value: 'code', label: '코드순' },
];
const PAGE = 100; // 첫 화면·더보기 단위(파인더와 동일)

function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** 공급사 역할만 임베드 — 관리자 일괄 연동 SSOT는 /dev?tool=sync. */
const SheetSync = dynamic(() => import('@/components/SheetSync').then((m) => m.SheetSync), {
  ssr: false,
  loading: () => <CenterNote>시트 연동 불러오는 중…</CenterNote>,
});
// 목록을 훑는 단계에서는 차량 기본·운영 편집폼이 보이지 않는다. OCR/폼 구성까지 초기 번들에
// 넣지 않고, 실제 매물을 선택한 뒤에만 가져와 재고 목록과 검색의 첫 반응을 가볍게 한다.
const InventoryFixedPane = dynamic(() => import('@/features/inventory/InventoryEditorPanes').then((m) => m.InventoryFixedPane), {
  ssr: false,
  loading: () => <CenterNote>기본 정보를 여는 중…</CenterNote>,
});
const InventoryVariablePane = dynamic(() => import('@/features/inventory/InventoryEditorPanes').then((m) => m.InventoryVariablePane), {
  ssr: false,
  loading: () => <CenterNote>운영 정보를 여는 중…</CenterNote>,
});

// 재고관리 4프레임 = [매물 목록 | 기본 | 운영 | 연동·반영].
// 관리자 연동 본체는 개발도구. 여기 4번째 패널은 진입 버튼(+종합표)만.

export default function Inventory() {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const isAdmin = getRole() === 'admin';
  const {
    rows,
    setRows,
    policies,
    setPolicies,
    partners,
    access: ok,
    setAccess: setOk,
    gateMessage: gateMsg,
    setGateMessage: setGateMsg,
    loadProducts: load,
  } = useInventoryData(co);
  const [sel, setSel] = useState<string | null>(null);
  /**
   * ★차종사전(신규마스터) — 차명 축의 선택지(사장님 2026-08-23 「기존 재고관리 상품등록은 신규마스터를 반영해서 입력값을 만든다」).
   *   `public/data/vehicle-catalog.json` 은 공급사 정제칸에서 파생한다(`scripts/build-vehicle-catalog.mts`).
   * ⚠ 못 받아도 화면은 그대로 돈다 — 선택지가 비고 손입력만 남을 뿐, 등록을 막지 않는다.
   *   옛 차종마스터(1.7MB)와 달리 이 파일은 작아 첫 화면을 붙잡지 않는다.
   */
  const [catalog, setCatalog] = useState<VehicleCatalog>(EMPTY_CATALOG);
  useEffect(() => {
    let alive = true;
    fetch('/data/vehicle-catalog.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (alive && data?.rows) setCatalog(data as VehicleCatalog); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState(''); // 검색창 즉시 반영(입력·힌트·조건해제)
  const [debouncedQ, setDebouncedQ] = useState(''); // 디바운스된 검색 — 목록 필터에만 사용
  const [sort, setSort] = useState<InvSort | ''>('status');
  const [stFlt, setStFlt] = useState<Set<string>>(() => new Set());
  const [typeFlt, setTypeFlt] = useState<Set<string>>(() => new Set());
  const [draftStFlt, setDraftStFlt] = useState<Set<string>>(() => new Set());
  const [draftTypeFlt, setDraftTypeFlt] = useState<Set<string>>(() => new Set());
  const [limit, setLimit] = useState(PAGE);
  /** 신규 작성 중(아직 DB 없음). 기존 = 보기 → 수정 눌러야 편집. */
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const supplierPhotos = useResolvedLinkPhotos(form);
  const {
    loadMaster,
    selectProduct: selectP,
    runOcr,
    ocrBusy,
    ocrInputRef: ocrRef,
  } = useInventoryVehicleTools({
    form,
    selectedCode: sel,
    setSelectedCode: setSel,
    setForm,
    setDirty,
    setCreating,
    setEditing,
  });

  const {
    clipboardAvailable,
    saving,
    clearSelection: clearSel,
    changeField: onChange,
    save,
    cancelEdit,
    startEdit,
    remove: removeP,
    resetForm,
    copyForm,
    pasteForm,
    createProduct: newP,
  } = useInventoryEditorLifecycle({
    companyId: co,
    selectedCode: sel,
    form,
    rows,
    creating,
    setSelectedCode: setSel,
    setForm,
    setDirty,
    setCreating,
    setEditing,
    reload: load,
  });
  // 목록행 클릭 = 최신 selectP를 안정 참조로 호출. handleRowClick 참조가 렌더마다 바뀌지 않아
  //  InventoryListRow(React.memo)가 편집 폼 타이핑(form state 변경) 리렌더에 딸려 재렌더되지 않는다.
  const selectPRef = useRef(selectP);
  selectPRef.current = selectP;
  // FeedListRow가 목록 공통 햅틱을 한 번 제공한다. 여기서는 선택만 수행해 중복 진동을 피한다.
  const handleRowClick = useCallback((p: EntityRecord) => { selectPRef.current(p); }, []);
  useInventoryAccessEffects({
    companyId: co,
    loadProducts: load,
    setPolicies,
    setAccess: setOk,
    setGateMessage: setGateMsg,
    loadMaster,
    clearSelection: clearSel,
  });

  // 검색 디바운스 — 편집 폼 타이핑과 무관하게, 목록 검색 타이핑마다 전량 filter/sort 하지 않게(파인더와 동일 패턴).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 180);
    return () => clearTimeout(t);
  }, [q]);

  // 검색·필터·정렬 바뀌면 더보기 리셋
  useEffect(() => { setLimit(PAGE); }, [debouncedQ, stFlt, typeFlt, sort]);

  /** 상품상태·구분 칩 건수 — 목록 rows 기준(출고불가 포함). 복수선택(ToggleChips). */
  const statusChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of rows || []) {
      const status = normalizeVehicleDisplayStatus(product.vehicle_status);
      counts.set(status, (counts.get(status) || 0) + 1);
    }
    return VEHICLE_DISPLAY_STATUSES.map((status) => ({
      key: status,
      label: status,
      count: counts.get(status) || 0,
    }));
  }, [rows]);

  const typeChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of rows || []) {
      const type = canonProductType(product.product_type) || String(product.product_type || '').trim();
      if (!type) continue;
      counts.set(type, (counts.get(type) || 0) + 1);
    }
    return PRODUCT_TYPES.map((type) => ({
      key: type,
      label: type,
      count: counts.get(type) || 0,
    }));
  }, [rows]);

  const { filtered, draftPreviewCount } = useInventoryResults({
    rows,
    query: debouncedQ,
    liveQuery: q,
    statuses: stFlt,
    productTypes: typeFlt,
    draftStatuses: draftStFlt,
    draftProductTypes: draftTypeFlt,
    sort,
  });

  // 검색·필터에서 선택 행이 사라지면 읽기 상세도 함께 정리한다.
  // 신규/수정 값과 저장 중 상태는 자동으로 버리지 않는다.
  useEffect(() => {
    if (!sel || dirty || creating || saving) return;
    const visible = filtered.map((product) => String(product.product_code));
    if (retainVisibleSelection(sel, visible) === sel) return;
    clearSel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sel, dirty, creating, saving]);

  const selectedIsVisible = creating || editing || !!(sel && filtered.some((product) => (
    String(product.product_code) === sel
  )));

  /** 상품마스터가 정본이다. 연동 후 ERP 목록만 다시 읽고 시트를 역방향으로 덮지 않는다. */
  const afterSyncImported = () => { load(getRole()); };

  if (ok === false) {
    return (
      <Page title={NAV_LABEL.inventory}>
        <CenterNote>{gateMsg || '접근 불가'}</CenterNote>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <Btn title="홈으로" href="/" size="sm">홈으로</Btn>
        </div>
      </Page>
    );
  }
  if (ok !== true) return <Loading />;

  const listPanelModel: InventoryListPanelModel = {
    rows: filtered,
    limit,
    selectedCode: sel,
    creating,
    draft: form,
    hasConditions: !!(q || stFlt.size || typeFlt.size),
    onSelect: handleRowClick,
    onCreate: newP,
    onClearConditions: () => { setQ(''); setStFlt(new Set()); setTypeFlt(new Set()); },
    onLimitChange: setLimit,
  };
  const listEl = <InventoryListPanel model={listPanelModel} />;

  const editorModel: InventoryEditorModel = {
    selected: selectedIsVisible,
    selectedCode: sel,
    form,
    creating,
    editing,
    dirty,
    clipboardAvailable,
    ocrBusy,
    ocrInputRef: ocrRef,
    policies,
    partners,
    supplierPhotos,
    isAdmin,
    catalog,
    onReset: resetForm,
    onCopy: copyForm,
    onPaste: pasteForm,
    onOcrFiles: runOcr,
    onFieldChange: onChange,
    onPriceChange: (price) => {
      setForm((current) => ({ ...current, price }));
      setDirty(true);
    },
    onPhotosChange: (photos) => {
      setForm((current) => ({ ...current, photos }));
      setDirty(true);
    },
    onInteriorChange: (url) => {
      setForm((current) => ({ ...current, interior_photo: url || '' }));
      setDirty(true);
    },
  };
  const fixedPane = <InventoryFixedPane model={editorModel} />;
  const varPane = <InventoryVariablePane model={editorModel} />;
  const syncPane = isAdmin ? (
    <>
      <PaneHead title="상품마스터 연동" />
      <PaneBody pad>
        <SheetSync co={co} compact onImported={afterSyncImported} />
      </PaneBody>
    </>
  ) : (
    <>
      <PaneHead title="연동 안내" />
      <PaneBody pad>
        <div style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.ink, lineHeight: 1.55 }}>
          공급사 원본은 참고·자료 제출용입니다.
        </div>
        <div style={{ marginTop: 6, fontSize: FS.cap, color: C.mute, lineHeight: 1.55 }}>
          관리자가 상품마스터를 확인한 뒤 ERP에 일괄 반영합니다. 공급사 원본은 비교·갱신 자료이며 ERP 재고를 직접 덮어쓰지 않습니다.
        </div>
      </PaneBody>
    </>
  );

  // 목록을 포함한 4번째 프레임이 연동·반영이다. 모바일은 해당 페인을 제외한다.
  const panes: WorkPane[] = [
    { key: 'fixed', title: '기본', node: fixedPane },
    { key: 'var', title: '운영', node: varPane },
    ...(mobile ? [] : [{ key: 'sync', title: '연동·반영', node: syncPane }]),
  ];
  // 하단바 = 편집 컨텍스트만(수정·삭제 / 취소·저장). 등록 = 목록 맨 위 행(InventoryCreateRow).
  const dockActions = creating || editing ? (
    <PageActions cancel={{ onClick: cancelEdit, disabled: saving }} save={{ onClick: save, disabled: !dirty || saving, label: saving ? '저장 중…' : undefined }} />
  ) : selectedIsVisible ? (
    <PageActions edit={{ onClick: startEdit }} remove={{ onClick: removeP }} />
  ) : undefined;
  const fltCount = (stFlt.size ? 1 : 0) + (typeFlt.size ? 1 : 0);
  return (
    <>
      {/* 상단 = 이 목록에 올라온 전체 매물(출고불가 포함). 공급사는 자기 회사분만. */}
      <WorkPage title={NAV_LABEL.inventory}
        statusCount={rows === null ? null : rows.length}
        countSuffix="대"
        listCount={rows === null ? null : filtered.length}
        list={rows === null ? <FeedRowSkeleton /> : listEl} panes={panes} selected={selectedIsVisible} onBack={clearSel}
        contextTitle={selectedIsVisible ? (creating ? '신규 상품' : (vehicleName(form) || String(form.car_number || '상품'))) : undefined}
        search={{ value: q, onChange: setQ, placeholder: '차번·차명·옵션·공급사·메모…' }}
        actions={dockActions}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '차번·차명·옵션·공급사·메모…' },
          sort: { value: sort, onChange: (v) => setSort(v as InvSort | ''), options: INV_SORTS, defaultValue: 'status' },
          filter: {
            count: fltCount,
            title: '조건 검색',
            previewCount: draftPreviewCount,
            previewUnit: '대',
            dirty: !sameStringSet(draftStFlt, stFlt) || !sameStringSet(draftTypeFlt, typeFlt),
            capture: () => {
              setDraftStFlt(new Set(stFlt));
              setDraftTypeFlt(new Set(typeFlt));
            },
            restore: () => {
              setDraftStFlt(new Set(stFlt));
              setDraftTypeFlt(new Set(typeFlt));
            },
            commit: () => {
              setStFlt(new Set(draftStFlt));
              setTypeFlt(new Set(draftTypeFlt));
            },
            onClear: () => {
              if (mobile) {
                setDraftStFlt(new Set());
                setDraftTypeFlt(new Set());
              } else {
                setStFlt(new Set());
                setTypeFlt(new Set());
              }
            },
            body: (
              rows === null ? (
                <CenterNote minHeight={120}>재고와 필터를 불러오는 중…</CenterNote>
              ) : <>
                <FilterGroup
                  title="상품상태"
                  count={(mobile ? draftStFlt : stFlt).size}
                  defaultOpen
                  first={!mobile}
                  onClear={() => mobile ? setDraftStFlt(new Set()) : setStFlt(new Set())}
                >
                  <ToggleChips
                    selected={mobile ? draftStFlt : stFlt}
                    onToggle={(key) => (mobile ? setDraftStFlt : setStFlt)((prev) => toggleInSet(prev, key))}
                    options={statusChips}
                  />
                </FilterGroup>
                <FilterGroup
                  title="상품구분"
                  count={(mobile ? draftTypeFlt : typeFlt).size}
                  defaultOpen
                  onClear={() => mobile ? setDraftTypeFlt(new Set()) : setTypeFlt(new Set())}
                >
                  <ToggleChips
                    selected={mobile ? draftTypeFlt : typeFlt}
                    onToggle={(key) => (mobile ? setDraftTypeFlt : setTypeFlt)((prev) => toggleInSet(prev, key))}
                    options={typeChips}
                  />
                </FilterGroup>
              </>
            ),
          },
          hints: [
            ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
            ...(sort && sort !== 'status' ? [INV_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...[...stFlt],
            ...[...typeFlt],
          ],
          onClearHints: () => {
            setQ('');
            setSort('status');
            setStFlt(new Set());
            setTypeFlt(new Set());
            setLimit(PAGE);
          },
        }}
      />
    </>
  );
}
