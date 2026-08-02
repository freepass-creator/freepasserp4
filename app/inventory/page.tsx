'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { VEHICLE_STATES, PRODUCT_TYPES, type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor } from '@/lib/domain/deal';
import { vehicleName } from '@/lib/domain/product';
import { PaneHead, PaneBody, Btn, C, Loading, CenterNote, Badge, Page, FilterChips, FilterGroup, PageActions, FW, FS, FeedRowSkeleton } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { toast } from '@/components/Toaster';
import { haptic } from '@/lib/haptics';
import { buildJonghapTsv } from '@/lib/domain/jonghap';
import { useResolvedLinkPhotos } from '@/components/use-product-photos';
import dynamic from 'next/dynamic';
import { useIsMobile } from '@/lib/use-mobile';
import { NAV_LABEL } from '@/lib/tabbar';
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
const INV_SORTS: { value: InvSort; label: string }[] = [
  { value: 'status', label: '상태순' },
  { value: 'name', label: '차명순' },
  { value: 'plate', label: '차번순' },
  { value: 'code', label: '코드순' },
];
const PAGE = 100; // 첫 화면·더보기 단위(파인더와 동일)
const INV_STATUS_CHIPS = [
  { key: 'all' as const, label: '전체' },
  ...VEHICLE_STATES.map((s) => ({ key: s, label: s })),
];
const INV_TYPE_CHIPS = [
  { key: 'all' as const, label: '전체' },
  ...PRODUCT_TYPES.map((t) => ({ key: t, label: t })),
];

const SheetSync = dynamic(() => import('@/components/SheetSync').then((m) => m.SheetSync), {
  ssr: false,
  loading: () => <CenterNote>시트 연동 불러오는 중…</CenterNote>,
});

// 재고관리 = [매물 목록 | 매물 편집 | 공급사 소스 연동]. 파인더와 같은 데이터의 "편집 렌즈".
// 목록에서 선택 = 차종마스터 규격으로 맞춤(high·중 DB 반영). 공급사=자기 매물만.

export default function Inventory() {
  const co = getCompanyId();
  const mobile = useIsMobile();
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
  const [stFlt, setStFlt] = useState<string>('all');
  const [typeFlt, setTypeFlt] = useState<string>('all');
  const [draftStFlt, setDraftStFlt] = useState<string>('all');
  const [draftTypeFlt, setDraftTypeFlt] = useState<string>('all');
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
    companyId: co,
    form,
    setSelectedCode: setSel,
    setForm,
    setRows,
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
  const handleRowClick = useCallback((p: EntityRecord) => { haptic.tap(); selectPRef.current(p); }, []);
  useInventoryAccessEffects({
    companyId: co,
    mobile,
    loadProducts: load,
    setPolicies,
    setAccess: setOk,
    setGateMessage: setGateMsg,
    loadMaster,
    selectProduct: selectP,
    clearSelection: clearSel,
  });

  // 검색 디바운스 — 편집 폼 타이핑과 무관하게, 목록 검색 타이핑마다 전량 filter/sort 하지 않게(파인더와 동일 패턴).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 180);
    return () => clearTimeout(t);
  }, [q]);

  // 검색·필터·정렬 바뀌면 더보기 리셋
  useEffect(() => { setLimit(PAGE); }, [debouncedQ, stFlt, typeFlt, sort]);

  const { filtered, draftPreviewCount } = useInventoryResults({
    rows,
    query: debouncedQ,
    liveQuery: q,
    status: stFlt,
    productType: typeFlt,
    draftStatus: draftStFlt,
    draftProductType: draftTypeFlt,
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
    hasConditions: !!(q || stFlt !== 'all' || typeFlt !== 'all'),
    onSelect: handleRowClick,
    onCreate: newP,
    onClearConditions: () => { setQ(''); setStFlt('all'); setTypeFlt('all'); },
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
    isAdmin: getRole() === 'admin',
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
  const syncPane = (
    <>
      <PaneHead title="공급사 업로드" />
      <PaneBody pad>
        {/* 전수 차종변환 = /dev 개발도구. 여기는 공급사 시트 취합만. 모바일 panes에서 제외. */}
        <div style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.mute }}>공급사 시트 취합</div>
        <SheetSync co={co} onImported={() => load(getRole())} />
        <div style={{ height: 1, background: C.line2, margin: '2px 0' }} />
        <Btn size="sm" variant="ghost" onClick={copyJonghap}>종합표 TSV 복사 (ERP→시트)</Btn>
      </PaneBody>
    </>
  );

  // 데스크톱 = 기본·운영·업로드 3패널. 모바일 = 업로드 페인 제외(시트 취합은 웹).
  const panes: WorkPane[] = [
    { key: 'fixed', title: '기본', node: fixedPane },
    { key: 'var', title: '운영', node: varPane },
    ...(mobile ? [] : [{ key: 'sync', title: '업로드', node: syncPane }]),
  ];
  // 하단바 = 편집 컨텍스트만(수정·삭제 / 취소·저장). 등록 = 목록 맨 위 행(InventoryCreateRow).
  const dockActions = creating || editing ? (
    <PageActions cancel={{ onClick: cancelEdit, disabled: saving }} save={{ onClick: save, disabled: !dirty || saving, label: saving ? '저장 중…' : undefined }} />
  ) : selectedIsVisible ? (
    <PageActions edit={{ onClick: startEdit }} remove={{ onClick: removeP }} />
  ) : undefined;
  const fltCount = (stFlt !== 'all' ? 1 : 0) + (typeFlt !== 'all' ? 1 : 0);
  return (
    <>
      {/* 상단바 라벨은 상태칩과 동명이면 안 된다 — 칩 「출고가능」은 한 상태고, 이 수는 즉시출고+출고가능 합계다. */}
      <WorkPage title={NAV_LABEL.inventory} statusLabel="가용재고"
        statusCount={rows === null ? null : rows.filter((p) => {
          const st = String(p.vehicle_status || '');
          return st === '즉시출고' || st === '출고가능';
        }).length}
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
            dirty: draftStFlt !== stFlt || draftTypeFlt !== typeFlt,
            capture: () => {
              setDraftStFlt(stFlt);
              setDraftTypeFlt(typeFlt);
            },
            restore: () => {
              setDraftStFlt(stFlt);
              setDraftTypeFlt(typeFlt);
            },
            commit: () => {
              setStFlt(draftStFlt);
              setTypeFlt(draftTypeFlt);
            },
            onClear: () => {
              if (mobile) {
                setDraftStFlt('all');
                setDraftTypeFlt('all');
              } else {
                setStFlt('all');
                setTypeFlt('all');
              }
            },
            body: (
              <>
                <FilterGroup
                  title="상품상태"
                  count={(mobile ? draftStFlt : stFlt) === 'all' ? 0 : 1}
                  defaultOpen
                  first={!mobile}
                  onClear={() => mobile ? setDraftStFlt('all') : setStFlt('all')}
                >
                  <FilterChips value={mobile ? draftStFlt : stFlt} onChange={mobile ? setDraftStFlt : setStFlt} options={INV_STATUS_CHIPS} />
                </FilterGroup>
                <FilterGroup
                  title="상품구분"
                  count={(mobile ? draftTypeFlt : typeFlt) === 'all' ? 0 : 1}
                  defaultOpen
                  onClear={() => mobile ? setDraftTypeFlt('all') : setTypeFlt('all')}
                >
                  <FilterChips value={mobile ? draftTypeFlt : typeFlt} onChange={mobile ? setDraftTypeFlt : setTypeFlt} options={INV_TYPE_CHIPS} />
                </FilterGroup>
              </>
            ),
          },
          hints: [
            ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
            ...(sort ? [INV_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...(stFlt !== 'all' ? [stFlt] : []),
            ...(typeFlt !== 'all' ? [typeFlt] : []),
          ],
          onClearHints: () => { setQ(''); setSort(''); setStFlt('all'); setTypeFlt('all'); setLimit(PAGE); },
        }}
      />
    </>
  );
}
