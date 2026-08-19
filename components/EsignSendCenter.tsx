'use client';

/**
 * 계약서관리(전자계약) — 관리자가 계약서를 만들어 링크를 보내고, 서명을 검토·승인해 PDF까지 받는 화면.
 *
 * 정본: docs/ESIGN_SEND_CENTER_REDESIGN_2026-08-19.md
 *   · 사장님 2026-08-19 «4칸»: 목록(1) | 계약 진행(2·3, 넓게) | 계약서·링크(4). 상태는 useFreepassEsign 한 번만 읽어 두 칸이 나눠 쓴다.
 *   · 단계 축 하나(작성 → 발송 전 → 고객 작성 중 → 검토 대기 → 완료). 목록 뱃지·스테퍼·필터 칩이 같은 말.
 *   · 「확인 필요」는 단계가 아니라 플래그(발송 차단 사유) — 목록엔 빨간 뱃지, 작업면엔 「발송 전 확인」 표 하나.
 *   · 초안(작성)은 카드 1·2·3·4 가 작업면 가로폭을 다 쓰고 세로로 이어진다(사장님 2026-08-19).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { FileSignature, FileText, RotateCcw } from 'lucide-react';
import type { EntityRecord, Field } from '@/lib/intake/entities';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { isAdminUiAllowed, isEsignUiAllowed } from '@/lib/auth-gate';
import { createDirectEsignContract } from '@/lib/domain/deal';
import {
  DEPOSIT_INSTALLMENT_NONE,
  ESIGN_CENTER_STAGES,
  depositInstallmentOptions,
  draftInputRecord,
  draftTemplateFields,
  emptyEsignDraftInput,
  esignAdditionalDriverLimit,
  esignCenterFlagLabel,
  esignCenterFlags,
  esignCenterStage,
  esignContractSource,
  isEsignCenterContract,
  validateEsignCenterContract,
  type EsignCenterQueueFilter,
  type EsignCenterStage,
  type EsignCheck,
  type EsignDraftInput,
} from '@/lib/domain/esign-center';
import {
  contractKindFor,
  findTemplate,
  STANDARD_CONTRACT_TEMPLATES,
  standardTemplateSelectionError,
} from '@/lib/domain/esign-templates';
import { partnerUsesFreepassContract, policyReadiness } from '@/lib/domain/policy-tier';
import { policyEditUrl } from '@/lib/domain/policy-navigation';
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
  isContractAvailableVehicle,
  productKey,
  searchContractVehicles,
} from '@/lib/domain/esign-vehicle-selection';
import { isStockedProduct, priceList } from '@/lib/domain/product';
import {
  ESIGN_POLICY_DRAFT_SESSION_KEY,
  ESIGN_POLICY_SELECTION_SESSION_KEY,
  type EsignPolicySelection,
} from '@/lib/domain/esign-policy-return';
import { NAV_LABEL } from '@/lib/tabbar';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { EsignCenterListRow, EsignCreateRow, EsignVehicleSelectRow } from '@/components/list-rows';
import {
  EsignContractContentPane,
  EsignDocumentPlaceholder,
  EsignProblemList,
  EsignStageCard,
  EsignStageStepper,
  FreepassEsignDocumentPane,
  FreepassEsignStagePane,
  PARTNER_PROBLEM_KEYS,
  POLICY_PROBLEM_KEYS,
  useFreepassEsign,
} from '@/components/FreepassEsignPanes';
import { toast } from '@/components/Toaster';
import {
  Badge,
  Btn,
  ButtonLabel,
  C,
  CenterNote,
  DetailRow,
  FilterChips,
  FormGrid,
  FS,
  FW,
  ICON,
  ListGroup,
  Loading,
  PaneBody,
  PaneHead,
  R,
  SearchInput,
  SectionLabel,
  SH,
  Textarea,
  ToggleChips,
  won,
} from '@/components/ui';

const S = (value: unknown) => String(value ?? '').trim();

/** 초안 카드 — 번호는 스테퍼가 아니라 «작성 안의 순서». 카드는 작업면 가로폭을 다 쓴다. */
function ContractDraftStep({
  number,
  title,
  description,
  state,
  children,
  anchorRef,
}: {
  number: number;
  title: string;
  description: string;
  state: 'waiting' | 'active' | 'complete';
  children?: ReactNode;
  /** 이 카드가 «지금 할 차례»가 되면 패널 맨 위로 끌어올린다(사장님 2026-08-19 「선택하면 그 부분이 촥 위로」). */
  anchorRef?: RefObject<HTMLElement>;
}) {
  return (
    <section ref={anchorRef} style={{
      scrollMarginTop: 8,
      overflow: 'visible',
      border: `1px solid ${state === 'active' ? C.brand : C.line}`,
      borderRadius: R,
      background: C.bg,
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 10,
        padding: '11px 13px',
        background: state === 'active' ? C.head : C.taupeBg,
      }}>
        <Badge tone={state === 'complete' ? 'green' : state === 'active' ? 'blue' : 'gray'} variant={state === 'waiting' ? 'line' : 'fill'}>
          {number}
        </Badge>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink }}>{title}</div>
          <div style={{ marginTop: 2, fontSize: FS.sub, color: C.mute }}>{description}</div>
        </div>
        {state === 'complete' ? <Badge tone="green" variant="fill">완료</Badge> : null}
      </div>
      {children ? (
        <div style={{ padding: 13, borderTop: `1px solid ${C.line}` }}>{children}</div>
      ) : null}
    </section>
  );
}

const today = () => {
  const date = new Date();
  const p2 = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
};

const CONTRACT_META_FIELDS: Field[] = [
  { key: 'contractDate', label: '계약일', type: 'date', required: true, manual: true, note: '오늘 날짜가 자동 입력됩니다. 다른 날짜일 때만 변경합니다' },
  { key: 'rentMonths', label: '대여기간(개월)', type: 'number', required: true, manual: true, note: '기간 선택값을 직접 수정해야 할 때만 입력합니다' },
];

const OPTIONAL_TERM_FIELDS: Field[] = [
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

const RENT_PAYMENT_FIELDS: Field[] = [
  { key: 'rentAmount', label: '월 대여료(원)', type: 'number', required: true, manual: true, note: 'ERP 금액을 불러온 뒤 이번 계약의 최종 금액으로 수정합니다' },
  { key: 'depositAmount', label: '보증금(원)', type: 'number', manual: true, note: '무보증 계약은 0을 입력합니다' },
  { key: 'paymentTiming', label: '대여료 납부 조건', type: 'select', options: ['선불', '후불'], required: true, manual: true, note: '정책값과 다른 계약만 변경합니다' },
];

// 용어표(정본 §2-3): 차량을 대는 회사는 어디서나 «공급사».
const SUPPLIER_FIELDS: Field[] = [
  { key: 'providerCompanyCode', label: '공급사', type: 'select', required: true },
];

const POLICY_FIELDS: Field[] = [
  { key: 'policyCode', label: '계약정책', type: 'select', required: true },
];

const TEMPLATE_FIELDS: Field[] = [
  { key: 'standardTemplateId', label: '계약서 종류', type: 'select', required: true },
];

const CONTRACT_SELECTION_FIELDS: Field[] = [
  ...SUPPLIER_FIELDS,
  ...TEMPLATE_FIELDS,
  ...POLICY_FIELDS,
];

const QUEUE_FILTERS: Array<{ key: EsignCenterQueueFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: '발송 전', label: '발송 전' },
  { key: '고객 작성 중', label: '고객 작성 중' },
  { key: '검토 대기', label: '검토 대기' },
  { key: '완료', label: '완료' },
  { key: 'attention', label: '확인 필요' },
];

/** 선택 없음 상태의 단계 안내 — 이름은 스테퍼와 같은 표에서 온다. */
const STAGE_GUIDE: Record<EsignCenterStage, string> = {
  '작성': '공급사·계약서·정책 → 차량 → 대여조건을 입력하고 계약서를 만듭니다',
  '발송 전': 'A4로 확인하고 고객 링크를 만들어 복사·전달합니다',
  '고객 작성 중': '고객이 본인확인·계약조건 확인·서명을 진행합니다',
  '검토 대기': '제출된 면허증·셀카·서명을 확인하고 승인 또는 보완 요청합니다',
  '완료': '승인 순간 봉인 PDF가 만들어집니다 · 인도일 확정',
};

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

type QueueEntry = { stage: EsignCenterStage; flagLabel: string; problems: EsignCheck[] };

export function EsignSendCenter({
  basePath = '/esign',
}: {
  basePath?: string;
} = {}) {
  const router = useRouter();
  const erp5Mode = basePath.startsWith('/erp5');
  const companyId = getCompanyId();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [contracts, setContracts] = useState<EntityRecord[] | null>(null);
  const [partners, setPartners] = useState<EntityRecord[]>([]);
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const [products, setProducts] = useState<EntityRecord[]>([]);
  const [vehicleQuery, setVehicleQuery] = useState('');
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [queueFilter, setQueueFilter] = useState<EsignCenterQueueFilter>('all');
  const [selectedCode, setSelectedCode] = useState('');
  const [draft, setDraft] = useState<EsignDraftInput | null>(null);
  const [busy, setBusy] = useState(false);
  const policyReturnApplied = useRef(false);
  const linkedProductApplied = useRef(false);
  const erp5DraftApplied = useRef(false);
  // 초안 카드 앵커 — 다음 카드가 열리는 순간 그 카드를 패널 맨 위로 올린다(표가 아래로만 자라지 않게).
  const vehicleStepRef = useRef<HTMLElement>(null);
  const termsStepRef = useRef<HTMLElement>(null);
  const createRowRef = useRef<HTMLDivElement>(null);

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
    if (!isEsignUiAllowed()) { router.replace(`/login?next=${encodeURIComponent(basePath)}`); return; }
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
      window.history.replaceState(null, '', basePath);
    }
  }, [contracts]);

  const selected = useMemo(
    () => (contracts || []).find((row) => contractKey(row) === selectedCode) || null,
    [contracts, selectedCode],
  );
  // 선택된 계약의 전자계약 상태(세션·제출물·이력) — 두 칸이 같은 값을 본다. 초안 중엔 selected 가 null 이라 조용하다.
  const esign = useFreepassEsign(selected, load);
  const partnerMap = useMemo(() => new Map(partners.map((row) => [partnerKey(row), row])), [partners]);
  const policyMap = useMemo(() => new Map(policies.map((row) => [policyKey(row), row])), [policies]);
  const productMap = useMemo(() => new Map(products.map((row) => [productKey(row), row])), [products]);
  const policiesByProviderMap = useMemo(() => policiesByProvider(policies), [policies]);

  // ERP5 상품 카드의 「계약 만들기」에서 넘어온 차량은 다시 검색하지 않도록
  // 공급사·기본 렌트계약서·해당 공급사의 우선 정책까지 한 번에 이어 붙인다.
  useEffect(() => {
    if (contracts == null || linkedProductApplied.current || !products.length) return;
    const params = new URLSearchParams(window.location.search);
    const linkedProductCode = S(params.get('product'));
    if (!linkedProductCode) return;
    linkedProductApplied.current = true;
    const product = productMap.get(linkedProductCode);
    if (!product) return;

    const standardTemplateId = 'freepass-rent-standard';
    const template = findTemplate(standardTemplateId);
    const providerCompanyCode = S(product.provider_company_code);
    const policy = preferredPolicyForTemplate(
      policiesByProviderMap.get(providerCompanyCode) || [],
      providerCompanyCode,
      template,
    );
    setSelectedCode('');
    setVehicleQuery('');
    setVehiclePickerOpen(false);
    setDraft({
      ...emptyEsignDraftInput('direct', today()),
      providerCompanyCode,
      standardTemplateId,
      ...policyDraftPatch(policy),
      ...contractVehicleSnapshot(product),
    });
    window.history.replaceState(null, '', basePath);
  }, [basePath, contracts, policiesByProviderMap, productMap, products.length]);

  const selectedPartner = selected ? partnerMap.get(S(selected.provider_company_code)) || null : null;
  const selectedPolicy = selected ? policyMap.get(S(selected.policy_code)) || null : null;

  const draftPartner = draft ? partnerMap.get(draft.providerCompanyCode) || null : null;
  const draftPolicy = draft ? policyMap.get(draft.policyCode) || null : null;
  const draftProduct = draft?.productCode ? productMap.get(draft.productCode) || null : null;
  const draftAdditionalDriverLimit = esignAdditionalDriverLimit(draftPolicy);
  const draftChecks = useMemo(() => {
    if (!draft) return [];
    // product 를 넘겨야 출고가능 판정이 된다 — 안 넘기면 «연결된 ERP 차량을 찾을 수 없습니다» BLOCK 이 상시 붙는다.
    const checks = validateEsignCenterContract(draftInputRecord(draft), draftPartner, draftPolicy, draftProduct);
    const selectionChecks: EsignCheck[] = [];
    if (!draft.productCode) selectionChecks.push({ key: 'erp_product', label: '차량 선택', level: 'BLOCK', message: '출고가능 차량을 선택해 주세요' });
    if (!draft.driverAge) selectionChecks.push({ key: 'selected_driver_age', label: '운전자 연령 선택', level: 'BLOCK', message: '운전자 연령을 선택해 주세요' });
    return [...checks, ...selectionChecks];
  }, [draft, draftPartner, draftPolicy, draftProduct]);
  const draftBlocks = draftChecks.filter((row) => row.level === 'BLOCK');
  const draftProblems = draftChecks.filter((row) => row.level !== 'PASS');
  const draftHasPolicyProblem = draftProblems.some((row) => row.key === 'policy' || row.key === 'policy_readiness' || row.key === 'additional_driver_cost');
  const draftPolicyReadiness = draftPolicy ? policyReadiness(draftPolicy, draftPartner) : null;
  const draftPolicyProblemField = draftPolicyReadiness?.salesMissing[0] || draftPolicyReadiness?.contractMissing[0];
  const draftPolicyField = draftPolicyProblemField?.key || (draftProblems.some((row) => row.key === 'additional_driver_cost') ? 'additional_driver_cost' : '');
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
  const draftRentAmount = Number(draft?.rentAmount) || 0;
  const driverAgeOptions = useMemo(() => contractDriverAgeOptions(draftPolicy, draftRentAmount), [draftPolicy, draftRentAmount]);

  const policyOptionLabel = (row: EntityRecord) => S(row.policy_name || policyKey(row));

  const availableVehicleCountsByProvider = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) {
      const providerCode = S(product.provider_company_code);
      if (!providerCode || !isContractAvailableVehicle(product) || !isStockedProduct(product)) continue;
      counts.set(providerCode, (counts.get(providerCode) || 0) + 1);
    }
    return counts;
  }, [products]);

  const contractSuppliers = useMemo(() => {
    return partners.filter((row) => {
      const code = partnerKey(row);
      return partnerTypeLabel(row.partner_type || row.type || row.role, code) === '공급사'
        && partnerUsesFreepassContract(row, policiesByProviderMap.get(code) || []);
    });
  }, [partners, policiesByProviderMap]);
  /** 이 화면에서 새로 만든 계약만 표시한다. 기존 ERP 계약원장은 섞지 않는다. */
  const sendRows = useMemo(() => (contracts || [])
    .filter(isEsignCenterContract)
    .filter((row) => ['direct', 'excel'].includes(esignContractSource(row)))
    .filter((row) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [row.customer_name, row.vehicle_name_snapshot, row.car_number_snapshot, row.contract_code]
        .some((value) => S(value).toLowerCase().includes(q));
    }), [contracts, query]);

  // 단계·플래그·문제 목록을 행마다 한 번만 계산한다 — 목록 뱃지·필터 칩·상단바 건수·작업면이 같은 값을 본다.
  const queueMap = useMemo(() => new Map<string, QueueEntry>(sendRows.map((row) => {
    const checks = validateEsignCenterContract(
      row,
      partnerMap.get(S(row.provider_company_code)) || null,
      policyMap.get(S(row.policy_code)) || null,
      productMap.get(S(row.product_code)) || null,
    );
    const problems = checks.filter((check) => check.level !== 'PASS');
    const stage = esignCenterStage(row);
    const flagLabel = esignCenterFlagLabel(esignCenterFlags(row, checks));
    return [contractKey(row), { stage, flagLabel, problems }] as const;
  })), [sendRows, partnerMap, policyMap, productMap]);
  const queueCounts = useMemo(() => {
    const entries = [...queueMap.values()];
    const counts: Record<EsignCenterQueueFilter, number> = {
      all: entries.length,
      attention: entries.filter((entry) => entry.flagLabel).length,
      '발송 전': 0, '고객 작성 중': 0, '검토 대기': 0, '완료': 0,
    };
    for (const entry of entries) if (entry.stage !== '작성') counts[entry.stage] += 1;
    return counts;
  }, [queueMap]);
  const visibleSendRows = useMemo(() => sendRows.filter((row) => {
    const entry = queueMap.get(contractKey(row));
    if (!entry) return true;
    if (queueFilter === 'all') return true;
    if (queueFilter === 'attention') return !!entry.flagLabel;
    return entry.stage === queueFilter;
  }), [queueFilter, queueMap, sendRows]);

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
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      if (key === 'depositAmount') {
        // 보증금이 바뀌면 납부 방식 선택지도 바뀐다 — 0원이면 무보증, 선택지가 하나면 그것으로.
        const options = depositInstallmentOptions(draftPolicy, value);
        next.depositInstallment = options.length === 1 ? options[0] : (options.includes(next.depositInstallment || '') ? next.depositInstallment : '');
      }
      return next;
    });
  };

  const selectVehicle = (product: EntityRecord) => {
    const snapshot = contractVehicleSnapshot(product);
    setVehicleQuery('');
    setVehiclePickerOpen(false);
    // ★차량에 등록된 정책이 있으면 그 정책으로 맞춘다(사장님 2026-08-19 「전자계약이 정책이랑 연결 — 등록된 차량을 불러와야」).
    //   판매시트·재고의 정책코드가 그 차의 조건이다. 같은 공급사·같은 계약서 종류의 정책일 때만 바꾸고, 아니면 고른 정책을 둔다.
    const vehiclePolicy = S(product.policy_code)
      ? policiesForDraft.find((row) => policyKey(row) === S(product.policy_code)) || null
      : null;
    const policyForVehicle = vehiclePolicy || draftPolicy;
    if (vehiclePolicy && (!draftPolicy || policyKey(vehiclePolicy) !== policyKey(draftPolicy))) {
      toast(`차량에 등록된 정책 「${S(vehiclePolicy.policy_name || vehiclePolicy.policy_code)}」으로 맞췄습니다`, 'info');
    }
    setDraft((current) => current ? {
      ...resetVehicleDraft(current),
      ...snapshot,
      ...(vehiclePolicy ? policyDraftPatch(vehiclePolicy) : null),
      annualMileage: S(policyForVehicle?.annual_mileage),
      driverScope: S(policyForVehicle?.personal_driver_scope),
      maintenanceProduct: S(policyForVehicle?.maintenance_service),
    } : current);
  };

  const selectPeriod = (months: number) => {
    if (!draftProduct) return;
    const age = Number(S(draft?.driverAge).match(/(\d{2})/)?.[1] || draftPolicy?.basic_driver_age || 0);
    const price = contractRentForAge(draftProduct, months, draftPolicy, age);
    setDraft((current) => {
      if (!current || !price) return current;
      const options = depositInstallmentOptions(draftPolicy, price.deposit);
      return {
        ...current,
        rentMonths: String(months),
        rentAmount: String(price.rent),
        depositAmount: String(price.deposit),
        depositInstallment: options.length === 1 ? options[0] : (options.includes(current.depositInstallment || '') ? current.depositInstallment : ''),
      };
    });
  };

  const selectDriverAge = (age: number) => {
    const months = Number(draft?.rentMonths) || 0;
    const price = contractRentForAge(draftProduct, months, draftPolicy, age);
    const label = driverAgeOptions.find((option) => option.age === age)?.label || `만 ${age}세 이상`;
    setDraft((current) => current ? {
      ...current,
      driverAge: label,
      ...(price ? { rentAmount: String(price.rent), depositAmount: String(price.deposit) } : null),
    } : current);
  };

  const beginDirect = () => {
    setSelectedCode('');
    setVehicleQuery('');
    setVehiclePickerOpen(false);
    setDraft({
      ...emptyEsignDraftInput('direct', today()),
      providerCompanyCode: '',
      policyCode: '',
      paymentTiming: '',
    });
  };

  useEffect(() => {
    if (!erp5Mode || contracts == null || erp5DraftApplied.current || linkedProductApplied.current || draft || selectedCode) return;
    if (new URLSearchParams(window.location.search).get('product')) return;
    erp5DraftApplied.current = true;
    beginDirect();
  }, [contracts, draft, erp5Mode, selectedCode]);

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
      setSelectedCode(code);
      setDraft(null);
      toast('계약서를 만들었습니다. 계약서를 확인하고 링크를 만드세요.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '계약서를 만들지 못했습니다.', 'error');
    } finally { setBusy(false); }
  };

  const draftBaseReady = !!(
    draft?.providerCompanyCode
    && draftTemplate
    && draftPolicy
  );
  const draftVehicleReady = !!draftProduct;
  // 선택이 끝나 다음 카드가 «지금 할 차례»가 되면 그 카드를 위로 끌어올린다.
  // 1 계약 기준 완료 → 2 차량 / 차량 선택 → 3 대여조건 / 대여조건 완료 → 「계약서 만들기」 줄.
  const draftStepKey = !draft ? '' : draftReachedReview ? 'create' : draftVehicleReady ? 'terms' : draftBaseReady ? 'vehicle' : 'base';
  const lastDraftStepKey = useRef('');
  useEffect(() => {
    if (lastDraftStepKey.current === draftStepKey) return;
    const advanced = !!lastDraftStepKey.current && lastDraftStepKey.current !== 'create';
    lastDraftStepKey.current = draftStepKey;
    if (!advanced) return;
    const target = draftStepKey === 'vehicle' ? vehicleStepRef.current
      : draftStepKey === 'terms' ? termsStepRef.current
        : draftStepKey === 'create' ? createRowRef.current
          : null;
    if (!target) return;
    window.requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [draftStepKey]);

  if (allowed == null || contracts == null) return <Loading />;

  const selectedEntry: QueueEntry | null = selected
    ? (queueMap.get(contractKey(selected)) || { stage: esignCenterStage(selected), flagLabel: '', problems: [] })
    : null;
  const selectedProviderName = partnerCompanyDisplayName(selectedPartner) || '';
  const openPolicyEditor = (policyCode: string, field: string) => {
    if (draft) {
      // 초안은 저장 전이라 세션에 두고 정책 화면을 다녀온다(resume=policy).
      sessionStorage.setItem(ESIGN_POLICY_DRAFT_SESSION_KEY, JSON.stringify(draft));
    }
    router.push(policyEditUrl(policyCode, field));
  };
  // 공급사 정보(대표자·주소·등록번호·계좌)는 파트너사관리에서만 채운다 — 사장님 2026-08-19.
  const openPartnerManager = () => router.push('/members?tab=partner');
  const hasPolicyProblem = (problems: EsignCheck[]) => problems.some((row) => POLICY_PROBLEM_KEYS.has(row.key));
  const hasPartnerProblem = (problems: EsignCheck[]) => problems.some((row) => PARTNER_PROBLEM_KEYS.has(row.key));

  // ── 작성(초안) — 카드 1·2·3 이 작업면 가로폭을 다 쓰고 세로로 이어진다 ──
  const draftPane = draft ? (
    <>
      {!erp5Mode ? <PaneHead
        title="새 계약 만들기"
        count={draftReachedReview ? (draftBlocks.length ? `확인 ${draftBlocks.length}` : '만들 수 있음') : '입력 중'}
      /> : null}
      <PaneBody pad>
        <div style={{ display: 'grid', gap: 12, width: '100%' }}>
          <EsignStageStepper current="작성" />
          <ContractDraftStep
            number={1}
            title="계약 기준"
            description="공급사를 고르면 그 공급사의 계약서와 정책만 이어서 선택됩니다"
            state={draftBaseReady ? 'complete' : 'active'}
          >
            <div style={{ display: 'grid', gap: 10 }}>
              <FormGrid
                fields={CONTRACT_SELECTION_FIELDS}
                form={draft as unknown as EntityRecord}
                onChange={setDraftValue}
                cols={3}
                selectOptions={{
                  providerCompanyCode: contractSuppliers.map((row) => ({
                    value: partnerKey(row),
                    label: `${partnerCompanyDisplayName(row) || '공급사명 미등록'} · 출고가능 ${(availableVehicleCountsByProvider.get(partnerKey(row)) || 0).toLocaleString('ko-KR')}대`,
                  })),
                  // 계약서 종류 표기 = 템플릿 label 그대로(렌트·보험포함 / 구독·보험포함 / 구독·보험별도).
                  standardTemplateId: STANDARD_CONTRACT_TEMPLATES.map((template) => ({
                    value: template.id,
                    label: `${template.contractKind === '렌탈' ? '렌트' : '구독'} · ${template.insuranceSide === '고객직접' ? '보험별도' : '보험포함'}`,
                  })),
                  policyCode: policiesForDraft.map((row) => ({ value: policyKey(row), label: policyOptionLabel(row) })),
                }}
              />
              {draft.standardTemplateId && draftTemplateError ? (
                <div style={{ display: 'flex' }}>
                  <Badge tone="red" variant="solid">{draftTemplateError}</Badge>
                </div>
              ) : null}
              {isAdminUiAllowed() ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Btn href="/members?tab=partner" size="sm" variant="ghost">공급사·계약정책 관리</Btn>
                </div>
              ) : null}
            </div>
          </ContractDraftStep>

          <ContractDraftStep
            number={2}
            anchorRef={vehicleStepRef}
            title="차량"
            description={draftBaseReady
              ? `${partnerCompanyDisplayName(draftPartner) || '선택 공급사'}의 출고가능 차량만 검색합니다`
              : '계약 기준을 선택하면 그 공급사의 차량만 열립니다'}
            state={!draftBaseReady ? 'waiting' : draftVehicleReady ? 'complete' : 'active'}
          >
            {draftBaseReady ? (
              <div style={{ display: 'grid', gap: 10 }}>
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
                    placeholder={draftProduct ? '다른 출고가능 차량을 검색하거나 눌러서 변경' : '출고가능 차량번호·차종 검색 또는 눌러서 선택'}
                    full
                  />
                  {vehiclePickerOpen ? (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                      maxHeight: 360, overflowY: 'auto',
                      border: `1px solid ${C.line}`, borderRadius: R,
                      background: C.bg, boxShadow: SH.menu,
                    }}>
                      <div style={{
                        position: 'sticky', top: 0, zIndex: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        padding: '7px 10px', borderBottom: `1px solid ${C.line}`,
                        background: C.head, fontSize: FS.sub, color: C.mute,
                      }}>
                        <span>{partnerCompanyDisplayName(draftPartner) || '선택 공급사'} 출고가능 {companyVehicleCount.toLocaleString('ko-KR')}대</span>
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
                            : '이 공급사에 출고가능한 차량이 없습니다.'}
                        </CenterNote>
                      )}
                    </div>
                  ) : null}
                </div>
                {draftProduct && !erp5Mode ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <FormGrid
                      fields={VEHICLE_CONTRACT_FIELDS}
                      form={draft as unknown as EntityRecord}
                      onChange={setDraftValue}
                      cols={3}
                      showNotes
                    />
                    <div style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.5 }}>
                      연식·유종·출고 시 주행거리 등 나머지 차량정보는 선택한 차량값을 그대로 사용합니다.
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </ContractDraftStep>

          <ContractDraftStep
            number={3}
            anchorRef={termsStepRef}
            title="대여조건"
            description={draftVehicleReady
              ? '기간과 운전자 연령을 고르면 대여료가 채워집니다. 필요하면 금액을 이 계약의 최종값으로 고칩니다'
              : '차량을 선택하면 가능한 기간과 대여료를 불러옵니다'}
            state={!draftVehicleReady ? 'waiting' : draftReachedReview ? 'complete' : 'active'}
          >
            {draftProduct ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
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
                  <div>
                    {/* 정책은 「가능 여부·최대 회차」, 계약서엔 이 계약의 납부 방식이 굳어야 한다(사장님 2026-08-19). */}
                    <div style={{ fontSize: FS.sub, color: C.mute, marginBottom: 6 }}>
                      보증금 납부{draftPolicy ? <span style={{ color: C.faint }}> · 정책 {S(draftPolicy.deposit_installment) || '분납 미정'}</span> : null}
                    </div>
                    <ToggleChips
                      selected={new Set(draft.depositInstallment ? [draft.depositInstallment] : [])}
                      options={depositInstallmentOptions(draftPolicy, draft.depositAmount).map((option) => ({ key: option, label: option }))}
                      onToggle={(value) => setDraftValue('depositInstallment', value)}
                    />
                  </div>
                </div>
                {!erp5Mode ? <FormGrid
                  fields={RENT_PAYMENT_FIELDS}
                  form={draft as unknown as EntityRecord}
                  onChange={setDraftValue}
                  cols={3}
                  showNotes
                /> : null}
                {!erp5Mode ? (
                  <>
                    <SectionLabel>특약사항</SectionLabel>
                    <Textarea
                      value={draft.specialTerms || ''}
                      onChange={(value) => setDraftValue('specialTerms', value)}
                      placeholder="이번 계약에만 적용할 특약이 있을 때 입력하세요. 비워 두면 계약서에는 ‘없음’으로 표시됩니다."
                      ariaLabel="특약사항"
                      rows={2}
                      full
                      style={{ background: draft.specialTerms ? C.taupeBg : C.warnBg }}
                    />
                  </>
                ) : null}
              </div>
            ) : null}
          </ContractDraftStep>

          {/* ── 3장 채우면 바로 만든다(사장님 2026-08-19). 요약·정책값·추가 조건은 아래 접힘 — 펼쳐서 보고 싶을 때만. ── */}
          <div ref={createRowRef} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', scrollMarginTop: 8 }}>
            <Btn
              disabled={busy || !draftReachedReview || draftBlocks.length > 0 || !!draftTemplateError}
              title={!draftReachedReview
                ? '공급사·차량·대여조건을 채우면 바로 만들 수 있습니다'
                : draftBlocks.length ? `발송 전 확인 ${draftBlocks.length}건을 먼저 해결해 주세요` : '계약서를 만들고 발송 전 단계로'}
              onClick={() => void createDraft()}
            >
              <ButtonLabel icon={<FileText size={ICON.md} aria-hidden />}>
                {busy ? '계약서 만드는 중…' : draftReachedReview && draftBlocks.length ? `계약서 만들기 · 확인 ${draftBlocks.length}건` : '계약서 만들기'}
              </ButtonLabel>
            </Btn>
            {draftReachedReview && !draftProblems.length ? <Badge tone="green" variant="fill">만들 수 있습니다</Badge> : null}
            {!draftReachedReview ? <span style={{ fontSize: FS.sub, color: C.faint }}>공급사·차량·대여조건을 채우면 바로 만들 수 있습니다</span> : null}
            <span style={{ flex: 1 }} />
            <Btn variant="ghost" size="sm" onClick={beginDirect}>
              <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>전체 입력 지우기</ButtonLabel>
            </Btn>
          </div>
          {draftReachedReview && draftProblems.length ? (
            <EsignProblemList
              problems={draftProblems}
              onFixPolicy={draftHasPolicyProblem && draft.policyCode ? () => openPolicyEditor(draft.policyCode, draftPolicyField) : null}
              onFixPartner={hasPartnerProblem(draftProblems) ? openPartnerManager : null}
              partnerName={partnerCompanyDisplayName(draftPartner) || ''}
            />
          ) : null}

          {draftVehicleReady && !erp5Mode ? (
            <details>
              <summary style={{ cursor: 'pointer', color: C.mute, fontSize: FS.sub }}>필요할 때만 추가 계약조건 입력 (계약일 · 약정주행거리 · 만기 인수 · 운전자 범위 · 정비상품)</summary>
              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                <FormGrid fields={CONTRACT_META_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
                <FormGrid fields={OPTIONAL_TERM_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
                <FormGrid fields={EXTRA_TERM_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
              </div>
            </details>
          ) : null}

        </div>
      </PaneBody>
    </>
  ) : null;

  // ── 칸 2·3 저장된 계약 — 스테퍼 · 발송 전 확인 · 현재 단계 카드 · 요약 · 이력 (FreepassEsignStagePane) ──
  const workPane = draftPane || (selected && selectedEntry ? (
    <>
      {!erp5Mode ? <PaneHead
        title={S(selected.customer_name) || S(selected.vehicle_name_snapshot) || S(selected.contract_code)}
        count={selectedEntry.flagLabel ? `${selectedEntry.stage} · ${selectedEntry.flagLabel}` : selectedEntry.stage}
      /> : null}
      <PaneBody pad>
        <FreepassEsignStagePane
          key={contractKey(selected)}
          esign={esign}
          policy={selectedPolicy}
          providerName={selectedProviderName}
          problems={selectedEntry.problems}
          onFixPolicy={hasPolicyProblem(selectedEntry.problems) && S(selected.policy_code)
            ? () => openPolicyEditor(S(selected.policy_code), '')
            : null}
          onFixPartner={hasPartnerProblem(selectedEntry.problems) ? openPartnerManager : null}
        />
      </PaneBody>
    </>
  ) : (
    <>
      {!erp5Mode ? <PaneHead title={NAV_LABEL.esign} /> : null}
      <PaneBody pad>
        <EsignStageCard
          tone="quiet"
          title="계약서를 만들어 링크로 보내고, 서명을 검토·승인해 PDF를 받는 곳입니다"
          description="목록에서 계약을 고르거나 「새 계약 만들기」로 시작하세요. 단계는 다섯입니다."
        >
          <ListGroup>
            {ESIGN_CENTER_STAGES.map((stage, index) => (
              <DetailRow key={stage} label={`${index + 1}. ${stage}`} value={STAGE_GUIDE[stage]} stacked />
            ))}
          </ListGroup>
        </EsignStageCard>
      </PaneBody>
    </>
  ));

  // ── 칸 4 계약서·링크 — A4 미리보기 · 링크 만들기/복사/해지 · 모바일 미리보기 · 완료 PDF ──
  const documentPane = (
    <>
      {!erp5Mode ? <PaneHead title={draft ? '계약내용 확인' : '계약서·링크'} count={selected && selectedEntry && !draft ? selectedEntry.stage : undefined} /> : null}
      <PaneBody pad>
        {selected && selectedEntry && !draft ? (
          <FreepassEsignDocumentPane
            key={contractKey(selected)}
            esign={esign}
            policy={selectedPolicy}
            partner={selectedPartner}
            providerName={selectedProviderName}
            problems={selectedEntry.problems}
            basePath={basePath}
          />
        ) : draft && draftBaseReady ? (
          // 초안: 선택한 공급사·계약서·정책이 어떤 조건인지 접지 않고 쭉 펼친다(사장님 2026-08-19).
          <EsignContractContentPane
            partner={draftPartner}
            policy={draftPolicy}
            template={draftTemplate}
            summary={[
              { label: '공급사', value: partnerCompanyDisplayName(draftPartner) || '선택 필요' },
              { label: '계약서', value: draftTemplate?.label || '선택 필요', stacked: true },
              { label: '계약정책', value: S(draftPolicy?.policy_name) || '선택 필요', stacked: true },
              { label: '고객', value: '미지정 · 링크를 받은 사람이 직접 입력', stacked: true },
              { label: '차량', value: [draft.carNumber || (draft.productCode ? '차량번호 미정' : ''), draft.vehicleName].filter(Boolean).join(' · ') || '선택 필요', stacked: true },
              {
                label: '대여조건',
                value: [
                  draft.rentMonths ? `${draft.rentMonths}개월` : '',
                  draft.rentAmount ? `월 ${won(Number(draft.rentAmount))}` : '',
                  draft.depositAmount !== '' ? `보증금 ${Number(draft.depositAmount) ? won(Number(draft.depositAmount)) : '0원'}` : '',
                  draft.depositInstallment && draft.depositInstallment !== DEPOSIT_INSTALLMENT_NONE ? draft.depositInstallment : '',
                  draft.paymentTiming,
                  draft.driverAge,
                ].filter(Boolean).join(' · ') || '입력 필요',
                stacked: true,
              },
              { label: '약정주행거리 · 운전자 범위', value: [draft.annualMileage, draft.driverScope].filter(Boolean).join(' · ') || '계약정책 적용', stacked: true },
              { label: '추가 운전자', value: draftAdditionalDriverLimit ? `고객이 링크에서 입력 (최대 ${draftAdditionalDriverLimit}명) · 면허증 첨부` : '해당 없음', stacked: true },
              { label: '특약', value: draft.specialTerms || '없음', stacked: true },
            ]}
          />
        ) : <EsignDocumentPlaceholder drafting={!!draft} />}
      </PaneBody>
    </>
  );

  const panes: WorkPane[] = [
    { key: 'workflow', title: '계약 진행', icon: FileSignature, node: workPane },
    // 계약서·링크 칸은 한 칸 폭(목록과 같은 360). 넓은 폭은 계약 진행이 쓴다(사장님 4칸 배치).
    { key: 'document', title: '계약서·링크', icon: FileText, node: documentPane, width: 360 },
  ];

  const contractList = visibleSendRows.length ? visibleSendRows.map((row) => {
    const entry = queueMap.get(contractKey(row));
    return (
      <EsignCenterListRow
        key={contractKey(row)}
        contract={row}
        stage={entry?.stage || '발송 전'}
        flagLabel={entry?.flagLabel || ''}
        providerName={partnerCompanyDisplayName(partnerMap.get(S(row.provider_company_code)) || null)}
        selected={selectedCode === contractKey(row)}
        onClick={() => { setDraft(null); setSelectedCode(contractKey(row)); }}
      />
    );
  }) : <CenterNote minHeight={0}>{sendRows.length ? '이 단계의 계약이 없습니다.' : '새로 만든 계약이 여기에 표시됩니다.'}</CenterNote>;

  const list = (
    <>
      <EsignCreateRow selected={!!draft} onClick={beginDirect} />
      {contractList}
    </>
  );
  const listHeader = (
    <div style={{ padding: '6px 10px 4px', borderBottom: `1px solid ${C.line}`, background: C.bg }}>
      <FilterChips<EsignCenterQueueFilter>
        value={queueFilter}
        onChange={setQueueFilter}
        clearKey="all"
        options={QUEUE_FILTERS.map((option) => ({ ...option, count: queueCounts[option.key] }))}
      />
    </div>
  );

  const clearSelection = () => {
    setSelectedCode('');
    setDraft(null);
  };

  return (
    <WorkPage
      title={erp5Mode ? '계약서 보내기' : NAV_LABEL.esign}
      statusLabel="계약목록"
      statusCount={sendRows.length}
      attentionLabel="확인 필요"
      attentionCount={queueCounts.attention}
      listCount={sendRows.length}
      list={list}
      listHeader={listHeader}
      panes={panes}
      selected={!!selected || !!draft}
      onBack={clearSelection}
      backKind={draft ? 'cancel' : 'list'}
      search={{ value: query, onChange: setQuery, placeholder: '고객·차량·계약번호 검색' }}
      mobileLayout="stack"
      mobileBreakpoint={960}
      paneRatio={2}
      contextTitle={draft ? '새 계약 만들기' : (S(selected?.customer_name) || S(selected?.vehicle_name_snapshot))}
      listMaxWidth={360}
      hideList={erp5Mode}
      hideWebDock={erp5Mode}
    />
  );
}
