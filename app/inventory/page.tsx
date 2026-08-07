'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { PRODUCT_TYPES, type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor } from '@/lib/domain/deal';
import { VEHICLE_DISPLAY_STATUSES, canonProductType, normalizeVehicleDisplayStatus, vehicleName } from '@/lib/domain/product';
import { PaneHead, PaneBody, Btn, ButtonLabel, C, Loading, CenterNote, Badge, Page, ToggleChips, FilterGroup, PageActions, FW, FS, ICON, FeedRowSkeleton } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { toast } from '@/components/Toaster';
import { buildJonghapTsv } from '@/lib/domain/jonghap';
import { useResolvedLinkPhotos } from '@/components/use-product-photos';
import dynamic from 'next/dynamic';
import { useIsMobile } from '@/lib/use-mobile';
import { NAV_LABEL } from '@/lib/tabbar';
import { toggleInSet } from '@/lib/set';
import { useInventoryResults, type InventorySort as InvSort } from '@/features/inventory/useInventoryResults';
import { InventoryListPanel, type InventoryListPanelModel } from '@/features/inventory/InventoryListPanel';
import {
  InventoryFixedPane, InventoryVariablePane, type InventoryEditorModel,
} from '@/features/inventory/InventoryEditorPanes';
import { useInventoryVehicleTools } from '@/features/inventory/useInventoryVehicleTools';
import { useInventoryEditorLifecycle } from '@/features/inventory/useInventoryEditorLifecycle';
import { useInventoryAccessEffects, useInventoryData } from '@/features/inventory/useInventoryData';
import { copyText } from '@/lib/clipboard';
import { retainVisibleSelection } from '@/features/work-list-display';
import { RefreshCw, Table2 } from 'lucide-react';
import { exportInventoryToSheet } from '@/lib/firebase/inventory-sheet-export-client';
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
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState(''); // 검색창 즉시 반영(입력·힌트·조건해제)
  const [debouncedQ, setDebouncedQ] = useState(''); // 디바운스된 검색 — 목록 필터에만 사용
  const [sort, setSort] = useState<InvSort | ''>('');
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
    normalizeVehicle,
    applyMasterPick,
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

  // 재고 → 영업자용 구글시트. 누를 때마다 새 탭이 맨 왼쪽에 생기고 지난 회차는 이력으로 남는다.
  const [exporting, setExporting] = useState(false);
  const exportToSheet = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await exportInventoryToSheet();
      toast(`시트 반영 완료 — ${result.count}대 · 「${result.tab}」 탭`, 'ok');
      window.open(result.url, '_blank', 'noopener');
    } catch (error) {
      toast(error instanceof Error ? error.message : '시트 반영에 실패했습니다.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const copyJonghap = async () => {
    const role = getRole();
    const [prodsAll, polsAll] = await Promise.all([getStore().list('product', co), getStore().list('policy', co)]);
    const me = role === 'provider' ? actor('provider').code : '';
    const prods = role === 'provider'
      ? prodsAll.filter((p) => String(p.provider_company_code || '') === me)
      : prodsAll;
    // 정책 = 자기 전용 + 공용(연결 가능 범위와 동일)
    const pols = role === 'provider'
      ? polsAll.filter((pl) => {
          const ppc = String(pl.provider_company_code || '');
          return !ppc || ppc === me;
        })
      : polsAll;
    const { tsv, count } = buildJonghapTsv(prods, pols);
    const copied = await copyText(tsv);
    toast(copied ? `종합표 ${count}행 복사됨 — 구글시트 종합탭에 붙여넣기` : '클립보드 복사에 실패했습니다', copied ? 'ok' : 'error');
  };

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
    onReset: resetForm,
    onCopy: copyForm,
    onPaste: pasteForm,
    onOcrFiles: runOcr,
    onMasterPick: applyMasterPick,
    onRematch: normalizeVehicle,
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
      <PaneHead title="공급사 연동" />
      <PaneBody pad>
        <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5, marginBottom: 12 }}>
          전체 공급사 시트·홈페이지 검증과 반영은 개발도구에서 합니다.
          거기서 확인한 뒤 재고에 반영하세요.
        </div>
        <Btn href="/dev?tool=sync" size="md">
          <ButtonLabel icon={<RefreshCw size={ICON.md} aria-hidden />}>개발도구 · 공급사 상품 연동</ButtonLabel>
        </Btn>
        <div style={{ height: 1, background: C.line2, margin: '14px 0' }} />
        <Btn size="md" onClick={exportToSheet} disabled={exporting}>
          <ButtonLabel icon={<Table2 size={ICON.md} aria-hidden />}>
            {exporting ? '시트 반영 중…' : '영업자 시트 반영 (ERP→구글시트)'}
          </ButtonLabel>
        </Btn>
        <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5, margin: '8px 0 14px' }}>
          누를 때마다 새 탭이 맨 왼쪽에 생깁니다. 지난 탭은 그대로 남으니 필요 없으면 지우세요.
        </div>
        <Btn size="sm" variant="ghost" onClick={copyJonghap}>종합표 TSV 복사 (ERP→시트)</Btn>
      </PaneBody>
    </>
  ) : (
    <>
      <PaneHead title="내 공급사 연동·반영" />
      <PaneBody pad>
        <div style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.mute }}>
          내 회사 원본 검증 후 반영
        </div>
        <SheetSync co={co} onImported={() => load(getRole())} />
        <div style={{ height: 1, background: C.line2, margin: '2px 0' }} />
        <Btn size="sm" variant="ghost" onClick={copyJonghap}>종합표 TSV 복사 (ERP→시트)</Btn>
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
      <WorkPage title={NAV_LABEL.inventory} statusLabel="전체매물"
        statusCount={rows === null ? null : rows.length}
        countSuffix="대"
        listCount={rows === null ? null : filtered.length}
        list={rows === null ? <FeedRowSkeleton /> : listEl} panes={panes} selected={selectedIsVisible} onBack={clearSel}
        contextTitle={selectedIsVisible ? (creating ? '신규 상품' : (vehicleName(form) || String(form.car_number || '상품'))) : undefined}
        search={{ value: q, onChange: setQ, placeholder: '차번·차명·옵션·공급사·메모…' }}
        actions={dockActions}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '차번·차명·옵션·공급사·메모…' },
          sort: { value: sort, onChange: (v) => setSort(v as InvSort | ''), options: INV_SORTS },
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
              <>
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
            ...(sort ? [INV_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...[...stFlt],
            ...[...typeFlt],
          ],
          onClearHints: () => {
            setQ('');
            setSort('');
            setStFlt(new Set());
            setTypeFlt(new Set());
            setLimit(PAGE);
          },
        }}
      />
    </>
  );
}
