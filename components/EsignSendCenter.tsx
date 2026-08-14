'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileSignature, FileText, RotateCcw } from 'lucide-react';
import type { EntityRecord, Field } from '@/lib/intake/entities';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { isAdminUiAllowed } from '@/lib/auth-gate';
import { createDirectEsignContract } from '@/lib/domain/deal';
import {
  draftInputRecord,
  draftTemplateFields,
  emptyEsignDraftInput,
  esignAdditionalDriverLimit,
  esignCenterBucket,
  esignContractSource,
  isEsignCenterContract,
  validateEsignCenterContract,
  type EsignCheck,
  type EsignDraftInput,
} from '@/lib/domain/esign-center';
import {
  contractKindFor,
  findTemplate,
  STANDARD_CONTRACT_TEMPLATES,
  standardTemplateSelectionError,
} from '@/lib/domain/esign-templates';
import { ALL_POLICY_FIELDS } from '@/lib/domain/policy-tier';
import {
  policiesByProvider,
  policiesForTemplate,
  preferredPolicyForTemplate,
} from '@/lib/domain/esign-policy-selection';
import { partnerTypeLabel } from '@/lib/domain/partner';
import { partnerCompanyDisplayName } from '@/lib/domain/identity';
import {
  contractDriverAgeOptions,
  contractRentForAge,
  contractVehicleSnapshot,
  productKey,
  searchContractVehicles,
} from '@/lib/domain/esign-vehicle-selection';
import { priceList } from '@/lib/domain/product';
import {
  ESIGN_POLICY_DRAFT_SESSION_KEY,
  ESIGN_POLICY_SELECTION_SESSION_KEY,
  type EsignPolicySelection,
} from '@/lib/domain/esign-policy-return';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { EsignCenterListRow, EsignCreateRow, EsignVehicleSelectRow } from '@/components/list-rows';
import { FreepassEsignLinkPane, FreepassEsignProgressPane } from '@/components/FreepassEsignPanes';
import { toast } from '@/components/Toaster';
import {
  Badge,
  Btn,
  ButtonLabel,
  C,
  CenterNote,
  DetailRow,
  FS,
  FormGrid,
  ICON,
  ListGroup,
  Loading,
  PaneBody,
  PaneHead,
  R,
  SearchInput,
  SectionLabel,
  Textarea,
  ToggleChips,
  won,
} from '@/components/ui';

const S = (value: unknown) => String(value ?? '').trim();
const today = () => {
  const date = new Date();
  const p2 = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
};

const CONTRACT_META_FIELDS: Field[] = [
  { key: 'contractDate', label: '계약일', type: 'date', required: true, manual: true, note: '오늘 날짜가 자동 입력됩니다. 다른 날짜일 때만 변경합니다' },
];

const BUSINESS_FIELDS: Field[] = [
  { key: 'customerIsBusiness', label: '사업자 계약', type: 'select', options: ['예', '아니오'], manual: true },
  { key: 'customerCompanyName', label: '법인/상호', type: 'text', manual: true },
  { key: 'customerBusinessNumber', label: '사업자등록번호', type: 'text', manual: true },
];

const OPTIONAL_TERM_FIELDS: Field[] = [
  { key: 'depositInstallment', label: '보증금 분납', type: 'text', manual: true },
  { key: 'annualMileage', label: '약정주행거리', type: 'text', manual: true, note: '비우면 선택 정책값 적용' },
  { key: 'buyoutPrice', label: '만기인수가·인수옵션', type: 'text', manual: true, note: '인수 조건이 있는 계약만 입력 · 비우면 만기 반납' },
  { key: 'driverScope', label: '운전자 범위', type: 'text', manual: true, note: '비우면 선택 정책값 적용' },
];

const EXTRA_TERM_FIELDS: Field[] = [
  { key: 'maintenanceProduct', label: '정비상품', type: 'text', manual: true },
];

const VEHICLE_CONTRACT_FIELDS: Field[] = [
  { key: 'vehicleName', label: '차종', type: 'text', required: true, manual: true, note: 'ERP에서 불러온 차종을 실제 계약서 표기에 맞게 수정할 수 있습니다' },
  { key: 'carNumber', label: '차량번호', type: 'text', manual: true, note: '신차는 비워 두면 차량번호 미정으로 표시됩니다' },
  { key: 'options', label: '옵션', type: 'text', manual: true, note: '계약서에 기재할 선택 옵션만 입력합니다' },
];

const RENT_CONTRACT_FIELDS: Field[] = [
  { key: 'rentMonths', label: '대여기간(개월)', type: 'number', required: true, manual: true, note: '위 기간 버튼은 빠른 선택이며 직접 수정할 수도 있습니다' },
  { key: 'rentAmount', label: '월 대여료(원)', type: 'number', required: true, manual: true, note: 'ERP 금액을 불러온 뒤 이번 계약의 최종 금액으로 수정합니다' },
  { key: 'depositAmount', label: '보증금(원)', type: 'number', manual: true, note: '무보증 계약은 0을 입력합니다' },
];

const PAYMENT_OVERRIDE_FIELDS: Field[] = [
  { key: 'paymentTiming', label: '대여료 납부 조건', type: 'select', options: ['선불', '후불'], required: true, manual: true, note: '정책값과 다른 계약만 변경합니다' },
];

const SUPPLIER_FIELDS: Field[] = [
  { key: 'providerCompanyCode', label: '회사선택', type: 'select', required: true, manual: true },
];

const POLICY_FIELDS: Field[] = [
  { key: 'policyCode', label: '계약정책', type: 'select', required: true, manual: true },
];

const TEMPLATE_FIELDS: Field[] = [
  { key: 'standardTemplateId', label: '계약서 종류', type: 'select', required: true, manual: true },
];

const CONTRACT_SELECTION_FIELDS: Field[] = [
  ...SUPPLIER_FIELDS,
  ...TEMPLATE_FIELDS,
  ...POLICY_FIELDS,
];

function contractKey(row: EntityRecord | null | undefined) {
  return S(row?.contract_code || row?._key);
}

function partnerKey(row: EntityRecord | null | undefined) {
  return S(row?.partner_code || row?._key || row?.provider_company_code);
}

function policyKey(row: EntityRecord | null | undefined) {
  return S(row?.policy_code || row?._key);
}

function resetVehicleDraft(current: EsignDraftInput, patch: Partial<EsignDraftInput> = {}): EsignDraftInput {
  return {
    ...current,
    productCode: '',
    vehicleName: '',
    carNumber: '',
    modelYear: '',
    fuel: '',
    options: '',
    colorExterior: '',
    currentMileage: '',
    rentMonths: '',
    rentAmount: '',
    depositAmount: '0',
    driverAge: '',
    ...patch,
  };
}

function policyDraftPatch(policy: EntityRecord | null): Partial<EsignDraftInput> {
  return {
    policyCode: policy ? policyKey(policy) : '',
    paymentTiming: policy ? (S(policy.payment_timing) === '후불' ? '후불' : '선불') : '',
    annualMileage: S(policy?.annual_mileage),
    driverScope: S(policy?.personal_driver_scope),
    maintenanceProduct: S(policy?.maintenance_service),
  };
}

const isSonogong = (row: EntityRecord | null | undefined) => {
  if (!row) return false;
  return partnerKey(row).toUpperCase() === 'RP012'
    || /손오공|sonogong/i.test(S(row.name || row.partner_name));
};

export function EsignSendCenter() {
  const router = useRouter();
  const companyId = getCompanyId();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [contracts, setContracts] = useState<EntityRecord[] | null>(null);
  const [partners, setPartners] = useState<EntityRecord[]>([]);
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const [products, setProducts] = useState<EntityRecord[]>([]);
  const [vehicleQuery, setVehicleQuery] = useState('');
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [draft, setDraft] = useState<EsignDraftInput | null>(null);
  const [createdDraft, setCreatedDraft] = useState<EsignDraftInput | null>(null);
  const [busy, setBusy] = useState(false);
  const policyReturnApplied = useRef(false);
  const inlineResultRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [contractRows, partnerRows, policyRows, productRows] = await Promise.all([
      getStore().list('contract', companyId),
      getStore().list('partner', companyId).catch(() => [] as EntityRecord[]),
      getStore().list('policy', companyId).catch(() => [] as EntityRecord[]),
      getStore().list('product', companyId).catch(() => [] as EntityRecord[]),
    ]);
    setContracts(contractRows);
    setPartners(partnerRows);
    setPolicies(policyRows);
    setProducts(productRows);
  }, [companyId]);

  useEffect(() => {
    if (!isAdminUiAllowed()) { router.replace('/'); return; }
    setAllowed(true);
    void load().catch(() => setContracts([]));
  }, [load, router]);

  useEffect(() => {
    if (contracts == null || policyReturnApplied.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('resume') !== 'policy') return;
    policyReturnApplied.current = true;
    try {
      const savedDraft = JSON.parse(sessionStorage.getItem(ESIGN_POLICY_DRAFT_SESSION_KEY) || 'null') as EsignDraftInput | null;
      const selection = JSON.parse(sessionStorage.getItem(ESIGN_POLICY_SELECTION_SESSION_KEY) || 'null') as EsignPolicySelection | null;
      if (savedDraft) {
        setSelectedCode('');
        setDraft({
          ...savedDraft,
          providerCompanyCode: selection?.providerCompanyCode || savedDraft.providerCompanyCode,
          policyCode: selection?.policyCode || savedDraft.policyCode,
        });
      }
    } catch {
      toast('정책 화면에서 작성 중이던 계약값을 복원하지 못했습니다.', 'error');
    } finally {
      sessionStorage.removeItem(ESIGN_POLICY_DRAFT_SESSION_KEY);
      sessionStorage.removeItem(ESIGN_POLICY_SELECTION_SESSION_KEY);
      window.history.replaceState(null, '', '/esign');
    }
  }, [contracts]);

  const selected = useMemo(
    () => (contracts || []).find((row) => contractKey(row) === selectedCode) || null,
    [contracts, selectedCode],
  );
  const partnerMap = useMemo(() => new Map(partners.map((row) => [partnerKey(row), row])), [partners]);
  const policyMap = useMemo(() => new Map(policies.map((row) => [policyKey(row), row])), [policies]);
  const productMap = useMemo(() => new Map(products.map((row) => [productKey(row), row])), [products]);
  const policiesByProviderMap = useMemo(() => policiesByProvider(policies), [policies]);
  const selectedPartner = selected ? partnerMap.get(S(selected.provider_company_code)) || null : null;
  const selectedPolicy = selected ? policyMap.get(S(selected.policy_code)) || null : null;

  const draftPartner = draft ? partnerMap.get(draft.providerCompanyCode) || null : null;
  const draftPolicy = draft ? policyMap.get(draft.policyCode) || null : null;
  const draftProduct = draft?.productCode ? productMap.get(draft.productCode) || null : null;
  const draftAdditionalDriverLimit = esignAdditionalDriverLimit(draftPolicy);
  const draftChecks = useMemo(() => {
    if (!draft) return [];
    const checks = validateEsignCenterContract(draftInputRecord(draft), draftPartner, draftPolicy);
    const selectionChecks: EsignCheck[] = [];
    if (!draft.productCode) selectionChecks.push({ key: 'erp_product', label: 'ERP 차량', level: 'BLOCK', message: 'ERP 재고 차량을 선택해 주세요' });
    if (!draft.driverAge) selectionChecks.push({ key: 'selected_driver_age', label: '운전자 연령', level: 'BLOCK', message: '운전자 연령을 선택해 주세요' });
    return [...checks, ...selectionChecks];
  }, [draft, draftPartner, draftPolicy]);
  const draftBlocks = draftChecks.filter((row) => row.level === 'BLOCK');
  const draftProblems = draftChecks.filter((row) => row.level !== 'PASS');
  const draftReachedReview = !!(
    draft?.productCode
    && draft.rentMonths
    && draft.driverAge
    && draft.rentAmount
  );
  const draftTemplate = draft ? findTemplate(draft.standardTemplateId) : null;
  const draftContractKind = draftTemplate && draft ? contractKindFor(draftTemplate, draft.maturity) : null;
  const draftTemplateError = draftTemplate && draftContractKind
    ? standardTemplateSelectionError(draftTemplate, draftContractKind, draftPolicy)
    : '사용할 계약서를 선택해 주세요.';
  const appliedPolicyRows = useMemo(() => {
    if (!draftPolicy) return [];
    return ALL_POLICY_FIELDS
      .filter((field) => field.exposure === 'contract')
      .map((field) => ({ ...field, value: S(draftPolicy[field.key]) }))
      .filter((field) => field.value);
  }, [draftPolicy]);

  const policiesForDraft = useMemo(() => {
    if (!draft?.providerCompanyCode || !draftTemplate) return [];
    return policiesForTemplate(
      policiesByProviderMap.get(draft.providerCompanyCode) || [],
      draft.providerCompanyCode,
      draftTemplate,
    );
  }, [draft?.providerCompanyCode, draft?.standardTemplateId, draftTemplate, policiesByProviderMap]);
  const vehicleResults = useMemo(() => searchContractVehicles(
    products,
    draft?.providerCompanyCode || '',
    draftTemplate,
    vehicleQuery,
  ), [draft?.providerCompanyCode, draftTemplate, products, vehicleQuery]);
  const companyVehicleCount = useMemo(() => searchContractVehicles(
    products,
    draft?.providerCompanyCode || '',
    draftTemplate,
    '',
  ).length, [draft?.providerCompanyCode, draftTemplate, products]);
  const availablePeriods = useMemo(() => draftProduct ? priceList(draftProduct) : [], [draftProduct]);
  const driverAgeOptions = useMemo(() => contractDriverAgeOptions(draftPolicy), [draftPolicy]);

  const policyOptionLabel = (row: EntityRecord) => S(row.policy_name || policyKey(row));

  const contractSuppliers = useMemo(() => {
    return partners.filter((row) => partnerTypeLabel(
      row.partner_type || row.type || row.role,
      partnerKey(row),
    ) === '공급사');
  }, [partners]);
  /** 이 발송센터에서 새로 만든 계약만 표시한다. 기존 ERP 계약원장은 섞지 않는다. */
  const sendRows = useMemo(() => (contracts || [])
    .filter(isEsignCenterContract)
    .filter((row) => ['direct', 'excel'].includes(esignContractSource(row)))
    .filter((row) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [row.customer_name, row.vehicle_name_snapshot, row.car_number_snapshot, row.contract_code]
        .some((value) => S(value).toLowerCase().includes(q));
    }), [contracts, query]);

  const sendAttention = useMemo(() => sendRows.filter((row) => {
    const checks = validateEsignCenterContract(
      row,
      partnerMap.get(S(row.provider_company_code)) || null,
      policyMap.get(S(row.policy_code)) || null,
    );
    return esignCenterBucket(row, checks) === '확인필요';
  }).length, [sendRows, partnerMap, policyMap]);

  const setDraftValue = (key: string, value: string) => {
    if (key === 'policyCode') {
      const chosen = policies.find((row) => policyKey(row) === value);
      setVehicleQuery('');
      setVehiclePickerOpen(false);
      setDraft((current) => current ? resetVehicleDraft(current, {
        ...policyDraftPatch(chosen || null),
      }) : current);
      return;
    }
    if (key === 'providerCompanyCode') {
      setVehicleQuery('');
      setVehiclePickerOpen(false);
      setDraft((current) => {
        if (!current) return current;
        const chosen = preferredPolicyForTemplate(
          policiesByProviderMap.get(value) || [],
          value,
          findTemplate(current.standardTemplateId),
        );
        return resetVehicleDraft(current, {
          providerCompanyCode: value,
          ...policyDraftPatch(chosen),
        });
      });
      return;
    }
    if (key === 'standardTemplateId') {
      setVehicleQuery('');
      setVehiclePickerOpen(false);
      setDraft((current) => {
        if (!current) return current;
        const chosen = preferredPolicyForTemplate(
          policiesByProviderMap.get(current.providerCompanyCode) || [],
          current.providerCompanyCode,
          findTemplate(value),
        );
        return resetVehicleDraft(current, {
          standardTemplateId: value,
          ...policyDraftPatch(chosen),
        });
      });
      return;
    }
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const selectVehicle = (product: EntityRecord) => {
    const snapshot = contractVehicleSnapshot(product);
    setVehicleQuery('');
    setVehiclePickerOpen(false);
    setDraft((current) => current ? {
      ...resetVehicleDraft(current),
      ...snapshot,
      annualMileage: S(draftPolicy?.annual_mileage),
      driverScope: S(draftPolicy?.personal_driver_scope),
      maintenanceProduct: S(draftPolicy?.maintenance_service),
    } : current);
  };

  const selectPeriod = (months: number) => {
    if (!draftProduct) return;
    const age = Number(S(draft?.driverAge).match(/(\d{2})/)?.[1] || draftPolicy?.basic_driver_age || 0);
    const price = contractRentForAge(draftProduct, months, draftPolicy, age);
    setDraft((current) => current && price ? {
      ...current,
      rentMonths: String(months),
      rentAmount: String(price.rent),
      depositAmount: String(price.deposit),
    } : current);
  };

  const selectDriverAge = (age: number) => {
    const months = Number(draft?.rentMonths) || 0;
    const price = contractRentForAge(draftProduct, months, draftPolicy, age);
    setDraft((current) => current ? {
      ...current,
      driverAge: `만 ${age}세 이상`,
      ...(price ? { rentAmount: String(price.rent), depositAmount: String(price.deposit) } : null),
    } : current);
  };

  const beginDirect = () => {
    setSelectedCode('');
    setCreatedDraft(null);
    setVehicleQuery('');
    setVehiclePickerOpen(false);
    setDraft({
      ...emptyEsignDraftInput('direct', today()),
      providerCompanyCode: '',
      policyCode: '',
      paymentTiming: '',
    });
  };

  const createDraft = async () => {
    if (!draft || busy) return;
    if (draftTemplateError || !draftTemplate || !draftContractKind) {
      toast(draftTemplateError || '계약서 종류와 만기를 확인해 주세요.', 'error');
      return;
    }
    if (draftBlocks.length) {
      toast(draftBlocks.map((row) => row.message).join(' · '), 'error');
      return;
    }
    setBusy(true);
    try {
      const code = await createDirectEsignContract({
        source: draft.source,
        importTemplateId: draft.importTemplateId,
        providerCompanyCode: draft.providerCompanyCode,
        policyCode: draft.policyCode,
        standardTemplateId: draftTemplate.id,
        contractKind: draftContractKind.key,
        maturity: draft.maturity,
        contractDate: draft.contractDate,
        customerName: draft.customerName,
        customerPhone: draft.customerPhone,
        customerAddress: draft.customerAddress,
        customerIsBusiness: draft.customerIsBusiness,
        customerCompanyName: draft.customerCompanyName,
        customerBusinessNumber: draft.customerBusinessNumber,
        productCode: draft.productCode,
        vehicleName: draft.vehicleName,
        carNumber: draft.carNumber,
        modelYear: draft.modelYear,
        fuel: draft.fuel,
        rentMonths: Number(draft.rentMonths),
        rentAmount: Number(draft.rentAmount),
        depositAmount: Number(draft.depositAmount),
        paymentTiming: draft.paymentTiming,
        driverAge: draft.driverAge,
        templateFields: draftTemplateFields(draft),
      });
      await load();
      setCreatedDraft(draft);
      setSelectedCode(code);
      setDraft(null);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => inlineResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      });
      toast('계약서를 만들었습니다. 아래에서 A4 확인과 계약 링크 생성을 이어가세요.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '전자계약 초안을 만들지 못했습니다.', 'error');
    } finally { setBusy(false); }
  };

  if (allowed == null || contracts == null) return <Loading />;

  const selectedChecks = selected ? validateEsignCenterContract(selected, selectedPartner, selectedPolicy) : [];
  const selectedProblems = selectedChecks.filter((check) => check.level !== 'PASS');
  const selectedIssued = !!selected && S(selected.esign_provider) === 'freepass' && !!S(selected.esign_id);
  const selectedCompleted = S(selected?.sign_status) === '서명완료';
  const selectedPendingReview = S(selected?.sign_status) === '검토대기';
  const selectedCurrentStepIndex = selectedCompleted ? 4 : selectedPendingReview ? 3 : selectedIssued ? 2 : 1;
  const workflowStep = selectedCompleted
    ? '완료'
    : selectedPendingReview
      ? '④ 관리자 확인'
      : selectedIssued
        ? '③ 링크 전달·진행'
        : '② 계약서 확인';
  const draftPane = draft ? (
    <>
      <PaneHead
        title={isSonogong(draftPartner) ? '손오공 계약서 작성' : '새 계약서 작성'}
        count={draftReachedReview ? (draftProblems.length ? `확인 ${draftProblems.length}` : '발송 준비') : '입력 중'}
      />
      <PaneBody pad>
        <SectionLabel>① 계약 기본 선택</SectionLabel>
        <FormGrid
          fields={CONTRACT_SELECTION_FIELDS}
          form={draft as unknown as EntityRecord}
          onChange={setDraftValue}
          cols={3}
          selectOptions={{
            providerCompanyCode: contractSuppliers.map((row) => ({
              value: partnerKey(row),
              label: partnerCompanyDisplayName(row) || '공급사명 미등록',
            })),
            standardTemplateId: STANDARD_CONTRACT_TEMPLATES.map((template) => ({
              value: template.id,
              label: `${template.contractKind === '렌탈' ? '렌트' : '구독'} · ${template.insuranceSide === '고객직접' ? '보험 별도' : '보험료 포함'}`,
            })),
            policyCode: policiesForDraft.map((row) => ({ value: policyKey(row), label: policyOptionLabel(row) })),
          }}
        />
        {draft.standardTemplateId && draftTemplateError ? (
          <div style={{ display: 'flex' }}>
            <Badge tone="red" variant="solid">{draftTemplateError}</Badge>
          </div>
        ) : null}

        <SectionLabel>② ERP 차량 선택</SectionLabel>
        {draft.providerCompanyCode && draftTemplate && draftPolicy ? (
          <>
            <div
              style={{ position: 'relative', zIndex: vehiclePickerOpen ? 20 : undefined }}
              onFocusCapture={() => setVehiclePickerOpen(true)}
              onBlurCapture={(event) => {
                const next = event.relatedTarget;
                if (!(next instanceof Node) || !event.currentTarget.contains(next)) setVehiclePickerOpen(false);
              }}
            >
              <SearchInput
                value={vehicleQuery}
                onChange={(value) => {
                  setVehicleQuery(value);
                  setVehiclePickerOpen(true);
                }}
                placeholder={draftProduct ? '다른 차량을 검색하거나 눌러서 변경' : '차량번호·차종 검색 또는 눌러서 선택'}
                full
              />
              {vehiclePickerOpen ? (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  maxHeight: 360, overflowY: 'auto',
                  border: `1px solid ${C.line}`, borderRadius: R,
                  background: C.bg, boxShadow: '0 8px 24px rgba(15, 23, 42, .14)',
                }}>
                  <div style={{
                    position: 'sticky', top: 0, zIndex: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '7px 10px', borderBottom: `1px solid ${C.line}`,
                    background: C.head, fontSize: FS.sub, color: C.mute,
                  }}>
                    <span>{partnerCompanyDisplayName(draftPartner) || '선택 회사'} 차량 {companyVehicleCount.toLocaleString('ko-KR')}대</span>
                    <span>{vehicleQuery ? `검색결과 ${vehicleResults.length.toLocaleString('ko-KR')}대` : '차량을 선택하세요'}</span>
                  </div>
                  {vehicleResults.length ? vehicleResults.map((product) => (
                    <EsignVehicleSelectRow
                      key={productKey(product)}
                      p={product}
                      selected={productKey(product) === draft.productCode}
                      onClick={selectVehicle}
                    />
                  )) : (
                    <CenterNote minHeight={0}>
                      {companyVehicleCount
                        ? '검색 조건에 맞는 차량이 없습니다.'
                        : '이 회사에 등록된 ERP 차량이 없습니다.'}
                    </CenterNote>
                  )}
                </div>
              ) : null}
            </div>
            {draftProduct ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <FormGrid
                  fields={VEHICLE_CONTRACT_FIELDS}
                  form={draft as unknown as EntityRecord}
                  onChange={setDraftValue}
                  cols={2}
                  showNotes
                />
                <div style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.5 }}>
                  연식·유종·출고 시 주행거리 등 나머지 차량정보는 선택한 ERP 차량값을 그대로 사용합니다.
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <CenterNote minHeight={0}>위에서 회사·계약서 종류·계약정책을 먼저 선택하세요.</CenterNote>
        )}

        <SectionLabel>③ 기간·운전자 연령·대여 조건</SectionLabel>
        {draftProduct ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <div style={{ fontSize: FS.sub, color: C.mute, marginBottom: 6 }}>대여기간</div>
              <ToggleChips
                selected={new Set(draft.rentMonths ? [draft.rentMonths] : [])}
                options={availablePeriods.map((price) => ({ key: String(price.m), label: `${price.m}개월` }))}
                onToggle={(value) => selectPeriod(Number(value))}
              />
            </div>
            <div>
              <div style={{ fontSize: FS.sub, color: C.mute, marginBottom: 6 }}>운전자 연령</div>
              <ToggleChips
                selected={new Set(draft.driverAge ? [String(Number(draft.driverAge.match(/(\d{2})/)?.[1] || 0))] : [])}
                options={driverAgeOptions.map((option) => ({
                  key: String(option.age),
                  label: `${option.label}${option.surcharge ? ` · 월 +${won(option.surcharge)}` : ''}`,
                }))}
                onToggle={(value) => selectDriverAge(Number(value))}
              />
            </div>
            <FormGrid
              fields={RENT_CONTRACT_FIELDS}
              form={draft as unknown as EntityRecord}
              onChange={setDraftValue}
              cols={3}
              showNotes
            />
            <ListGroup>
              <DetailRow label="운전자 조건" value={draft.driverAge || '연령을 선택해 주세요'} />
              <DetailRow label="주행·납부" value={[draft.annualMileage, draft.paymentTiming].filter(Boolean).join(' · ') || '정책 확인'} />
            </ListGroup>
          </div>
        ) : <CenterNote minHeight={0}>ERP 차량을 선택하면 가능한 기간과 가격이 표시됩니다.</CenterNote>}

        <SectionLabel>④ 특약사항</SectionLabel>
        <Textarea
          value={draft.specialTerms || ''}
          onChange={(value) => setDraftValue('specialTerms', value)}
          placeholder="이번 계약에만 적용할 특약이 있을 때 입력하세요. 없으면 비워 두세요."
          ariaLabel="특약사항"
          rows={3}
          full
          style={{ background: draft.specialTerms ? C.taupeBg : C.warnBg }}
        />
        <div style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.5 }}>
          비워 두면 계약서에는 ‘없음’으로 표시됩니다. 공통 보험·정산 조건은 선택한 계약정책에서 자동 적용됩니다.
        </div>

        {draftAdditionalDriverLimit ? (
          <Badge tone="gray" variant="fill">
            추가 운전자 최대 {draftAdditionalDriverLimit}명 · 고객이 계약 링크에서 직접 입력하고 면허증 첨부
          </Badge>
        ) : null}

        <details>
          <summary style={{ cursor: 'pointer', color: C.mute, fontSize: FS.sub }}>사업자·인수형 계약일 때만 추가 입력</summary>
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <SectionLabel>사업자 정보</SectionLabel>
            <FormGrid fields={BUSINESS_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
            <SectionLabel>건별 계약 조건</SectionLabel>
            <FormGrid fields={CONTRACT_META_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
            <FormGrid fields={PAYMENT_OVERRIDE_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
            <FormGrid fields={OPTIONAL_TERM_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
            <FormGrid fields={EXTRA_TERM_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
          </div>
        </details>
        {draftPartner && draftPolicy ? (
          <details>
            <summary style={{ cursor: 'pointer', color: C.mute, fontSize: FS.sub }}>자동 적용되는 회원사·정책값 확인</summary>
            <div style={{ marginTop: 10 }}>
              <ListGroup footer="이 값은 정책관리에서만 변경할 수 있습니다.">
                <DetailRow label="회원사" value={partnerCompanyDisplayName(draftPartner) || '공급사명 미등록'} />
                <DetailRow label="계약 정책" value={S(draftPolicy.policy_name || draftPolicy.policy_code)} />
                <DetailRow label="임대인" value={[draftPartner.ceo || draftPartner.ceo_name, draftPartner.phone].filter(Boolean).join(' · ') || '정책 확인 필요'} stacked />
                <DetailRow label="사업장" value={S(draftPartner.address) || '정책 확인 필요'} stacked />
                <DetailRow label="입금계좌" value={[draftPartner.bank_name, draftPartner.bank_account, draftPartner.bank_holder].filter(Boolean).join(' · ') || '정책 확인 필요'} stacked />
                {appliedPolicyRows.map((field) => (
                  <DetailRow key={field.key} label={field.label} value={field.value} stacked />
                ))}
              </ListGroup>
            </div>
          </details>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={beginDirect}>
            <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>전체 입력 지우기</ButtonLabel>
          </Btn>
        </div>
      </PaneBody>
    </>
  ) : null;

  const workflowPane = draftPane || (selected ? (
    <>
      <PaneHead title="전자계약 처리" count={workflowStep} />
      <PaneBody pad>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['① 입력', '② 계약서 확인', '③ 영업자 전달', '④ 관리자 확인'].map((label, index) => {
            const done = selectedCompleted || index < selectedCurrentStepIndex;
            const current = !selectedCompleted && index === selectedCurrentStepIndex;
            return <Badge key={label} tone={done ? 'green' : current ? 'blue' : 'gray'} variant={done || current ? 'fill' : 'line'}>{label}</Badge>;
          })}
        </div>
        {selectedProblems.length ? (
          <ListGroup header="발송 전 확인">
            {selectedProblems.map((check) => (
              <DetailRow
                key={check.key}
                label={check.label}
                value={<Badge tone={check.level === 'BLOCK' ? 'red' : 'amber'} variant={check.level === 'BLOCK' ? 'solid' : 'fill'}>{check.message}</Badge>}
              />
            ))}
          </ListGroup>
        ) : null}
        {selectedIssued ? (
          <FreepassEsignProgressPane contract={selected} onChanged={load} />
        ) : (
          <CenterNote minHeight={0}>오른쪽 계약서·링크 패널에서 A4 계약서를 확인하고 체결 방식을 선택하세요.</CenterNote>
        )}
      </PaneBody>
    </>
  ) : (
    <>
      <PaneHead title="전자계약 업무" />
      <PaneBody pad>
        <SectionLabel>직원 업무 순서</SectionLabel>
        <ListGroup>
          <DetailRow label="① 입력" value="차량·대여조건 입력" />
          <DetailRow label="② 확인" value="A4 계약서 확인" />
          <DetailRow label="③ 전달" value="계약 링크 생성·복사 후 영업자 전달" />
          <DetailRow label="④ 완료" value="서명 확인·승인·PDF 보관" />
        </ListGroup>
        <CenterNote minHeight={0}>왼쪽 맨 위의 새 계약서 작성을 누르면 입력부터 시작합니다.</CenterNote>
      </PaneBody>
    </>
  ));

  const documentPane = (
    <>
      <PaneHead
        title={draft ? '계약서 생성' : '계약서·계약 링크'}
        count={selectedCompleted ? '완료' : selectedIssued ? '링크 발행' : selected ? '발송 전' : draft ? '작성 중' : undefined}
      />
      <PaneBody pad>
        {draft ? (
          <>
            <SectionLabel>입력 내용 확인</SectionLabel>
            <ListGroup footer="입력 패널에서 값을 수정하면 이 요약에도 바로 반영됩니다.">
              <DetailRow label="계약회사" value={partnerCompanyDisplayName(draftPartner) || '선택 필요'} />
              <DetailRow label="계약서" value={draftTemplate?.label || '선택 필요'} stacked />
              <DetailRow label="계약정책" value={S(draftPolicy?.policy_name) || '선택 필요'} stacked />
              <DetailRow label="고객정보" value="고객이 계약 링크에서 직접 입력" stacked />
              <DetailRow label="차량" value={[draft.carNumber || (draft.productCode ? '차량번호 미정' : ''), draft.vehicleName].filter(Boolean).join(' · ') || '선택 필요'} stacked />
              <DetailRow
                label="대여조건"
                value={[
                  draft.rentMonths ? `${draft.rentMonths}개월` : '',
                  draft.rentAmount ? `월 ${won(Number(draft.rentAmount))}` : '',
                  draft.depositAmount !== '' ? `보증금 ${Number(draft.depositAmount) ? won(Number(draft.depositAmount)) : '0원'}` : '',
                  draft.driverAge,
                ].filter(Boolean).join(' · ') || '입력 필요'}
                stacked
              />
              <DetailRow
                label="추가 운전자"
                value={draftAdditionalDriverLimit
                  ? `고객이 계약 링크에서 선택·입력 (최대 ${draftAdditionalDriverLimit}명)`
                  : '해당 없음'}
                stacked
              />
              <DetailRow label="특약" value={draft.specialTerms || '없음'} stacked />
            </ListGroup>

            <SectionLabel>계약서 생성 전 확인</SectionLabel>
            {!draftReachedReview ? (
              <CenterNote minHeight={0}>입력 패널에서 회사·차량·기간·운전자 연령을 순서대로 선택하세요.</CenterNote>
            ) : draftProblems.length ? (
              <ListGroup footer="빨간 항목을 확인하면 계약서를 만들 수 있습니다.">
                {draftProblems.map((check) => (
                  <DetailRow
                    key={check.key}
                    label={check.label}
                    value={<Badge tone={check.level === 'BLOCK' ? 'red' : 'amber'} variant={check.level === 'BLOCK' ? 'solid' : 'fill'}>{check.message}</Badge>}
                  />
                ))}
              </ListGroup>
            ) : (
              <Badge tone="green" variant="fill">계약서 생성 준비가 완료되었습니다.</Badge>
            )}

            <Btn
              full
              disabled={busy}
              title={draftBlocks.length ? '확인할 필수 항목 보기' : '입력값으로 계약서 생성하기'}
              onClick={() => void createDraft()}
            >
              <ButtonLabel icon={<FileText size={ICON.md} aria-hidden />}>
                {busy ? '계약서 생성 중…' : draftBlocks.length ? `필수입력 ${draftBlocks.length}개 확인` : '계약서 생성하기'}
              </ButtonLabel>
            </Btn>
            <div style={{ fontSize: FS.cap, color: C.faint, lineHeight: 1.5 }}>
              계약서를 만든 뒤 이 패널에서 A4 확인·출력과 계약 링크 생성·복사를 이어서 처리하고 영업자에게 전달합니다.
            </div>
          </>
        ) : selected && createdDraft ? (
          <div ref={inlineResultRef} style={{ display: 'grid', gap: 12 }}>
            <SectionLabel>계약서 생성 완료</SectionLabel>
            <Badge tone="green" variant="fill">같은 패널에서 아래 순서대로 확인하고 링크를 만드세요.</Badge>
            <ListGroup>
              <DetailRow label="계약회사" value={partnerCompanyDisplayName(selectedPartner) || '—'} />
              <DetailRow label="차량" value={[createdDraft.carNumber || '차량번호 미정', createdDraft.vehicleName].filter(Boolean).join(' · ')} stacked />
              <DetailRow
                label="대여조건"
                value={[
                  `${createdDraft.rentMonths}개월`,
                  `월 ${won(Number(createdDraft.rentAmount))}`,
                  `보증금 ${Number(createdDraft.depositAmount) ? won(Number(createdDraft.depositAmount)) : '0원'}`,
                  createdDraft.driverAge,
                ].filter(Boolean).join(' · ')}
                stacked
              />
            </ListGroup>
            <FreepassEsignLinkPane contract={selected} policy={selectedPolicy} onChanged={load} />
          </div>
        ) : (
          <FreepassEsignLinkPane contract={selected} policy={selectedPolicy} onChanged={load} />
        )}
      </PaneBody>
    </>
  );

  const panes: WorkPane[] = [
    { key: 'workflow', title: '계약 진행', icon: FileSignature, node: workflowPane },
    { key: 'document', title: '계약서·링크', icon: FileText, node: documentPane },
  ];

  const contractList = sendRows.length ? sendRows.map((row) => {
    const checks = validateEsignCenterContract(
      row,
      partnerMap.get(S(row.provider_company_code)) || null,
      policyMap.get(S(row.policy_code)) || null,
    );
    return (
      <EsignCenterListRow
        key={contractKey(row)}
        contract={row}
        bucket={esignCenterBucket(row, checks)}
        providerName={S(partnerMap.get(S(row.provider_company_code))?.name)}
        selected={selectedCode === contractKey(row)}
        onClick={() => { setCreatedDraft(null); setDraft(null); setSelectedCode(contractKey(row)); }}
      />
    );
  }) : <CenterNote minHeight={0}>새로 만든 전자계약이 여기에 표시됩니다.</CenterNote>;

  const list = (
    <>
      <EsignCreateRow selected={!!draft} onClick={beginDirect} />
      {contractList}
    </>
  );

  return (
    <>
      <WorkPage
        title="전자계약"
        statusLabel="계약목록"
        statusCount={sendRows.length}
        attentionLabel="확인"
        attentionCount={sendAttention}
        listCount={sendRows.length}
        list={list}
        panes={panes}
        selected={!!selected || !!draft}
        onBack={() => { setCreatedDraft(null); setSelectedCode(''); setDraft(null); }}
        backKind={draft ? 'cancel' : 'list'}
        search={{ value: query, onChange: setQuery, placeholder: '고객·차량·계약번호 검색' }}
        mobileLayout="swap"
        contextTitle={draft ? (partnerCompanyDisplayName(draftPartner) || '새 계약서') : S(selected?.customer_name)}
        listMaxWidth={360}
      />
    </>
  );
}
