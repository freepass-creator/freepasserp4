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
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { FileSignature, FileText, RotateCcw } from 'lucide-react';
import type { EntityRecord, Field } from '@/lib/intake/entities';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { isEsignUiAllowed } from '@/lib/auth-gate';
import { createFreepassDirectContract, type CreateFreepassDirectContractInput } from '@/lib/firebase/freepass-esign-client';
import {
  DEPOSIT_INSTALLMENT_NONE,
  ESIGN_CENTER_STAGES,
  depositInstallmentOptions,
  draftInputRecord,
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
import { esignPartnerChecks } from '@/lib/domain/esign-center';
import {
  contractKindFor,
  insuranceSideFromPolicy,
  templateForKindAndInsurance,
  standardTemplateSelectionError,
} from '@/lib/domain/esign-templates';
import { partnerUsesFreepassContract, policyReadiness } from '@/lib/domain/policy-tier';
import { partnerManagePartnerUrl, partnerPolicyManageUrl } from '@/lib/domain/policy-navigation';
import {
  policiesByProvider,
} from '@/lib/domain/esign-policy-selection';
import { partnerTypeLabel } from '@/lib/domain/partner';
import { partnerCompanyDisplayName } from '@/lib/domain/identity';
import {
  contractDriverAgeOptions,
  contractMileageOptions,
  contractRentForTerms,
  contractVehicleSnapshot,
  isContractAvailableVehicle,
  productContractKind,
  productKey,
  resolveVehiclePolicy,
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

// 약정주행거리·운전자 범위·정비상품은 카드 3 「조건」으로 올렸다 — 여기엔 두지 않는다(같은 칸이 두 곳에 있으면 어느 쪽이 실렸는지 못 본다).
const OPTIONAL_TERM_FIELDS: Field[] = [
  { key: 'buyoutPrice', label: '만기인수가·인수옵션', type: 'text', manual: true, note: '인수 조건이 있는 계약만 입력 · 비우면 만기 반납' },
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

/**
 * ★카드별 입력 — 1 차량번호 선택(공급사 필터·정책 포함) · 2 기간별 대여료 · 3 조건.
  *   계약서 종류 select 는 폐지했다: 차량 상품구분 + 정책 보험조건으로 유일하게 정해진다(templateForKindAndInsurance).
  */
const COMPANY_STEP_FIELDS: Field[] = [...SUPPLIER_FIELDS];
const VEHICLE_POLICY_FIELDS: Field[] = [...POLICY_FIELDS];
const TERM_CONDITION_FIELDS: Field[] = [
  { key: 'driverScope', label: '운전자 범위', type: 'text', manual: true, note: '비우면 계약정책 값이 실립니다' },
  { key: 'maintenanceProduct', label: '정비상품', type: 'text', manual: true, note: '비우면 계약정책 값이 실립니다' },
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
  '작성': '차량을 고르고 기간별 대여료·조건을 확정해 계약서를 만듭니다',
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
  // 검색어 표시는 즉시, 차량/계약 목록 전체를 훑는 작업은 뒤로 보낸다.
  const deferredVehicleQuery = useDeferredValue(vehicleQuery);
  const deferredQuery = useDeferredValue(query);
  const [queueFilter, setQueueFilter] = useState<EsignCenterQueueFilter>('all');
  const [selectedCode, setSelectedCode] = useState('');
  const [draft, setDraft] = useState<EsignDraftInput | null>(null);
  const [busy, setBusy] = useState(false);
  const policyReturnApplied = useRef(false);
  const linkedProductApplied = useRef(false);
  const erp5DraftApplied = useRef(false);
  // 네트워크 응답이 끊겨도 같은 생성 요청은 같은 private idempotency key로 다시 보낸다.
  // 입력이 바뀌면 fingerprint가 달라져 새 요청으로 분리한다.
  const directCreateRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  // 초안 카드 앵커 — 다음 카드가 열리는 순간 그 카드를 패널 맨 위로 올린다(표가 아래로만 자라지 않게).
  const vehicleStepRef = useRef<HTMLElement>(null);
  const rentStepRef = useRef<HTMLElement>(null);
  const condStepRef = useRef<HTMLElement>(null);
  const createRowRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (freshContracts = false) => {
    const store = getStore();
    const listFreshWithHealth = store.listFreshWithHealth;
    const contractsRead = freshContracts && typeof listFreshWithHealth === 'function'
      ? listFreshWithHealth.call(store, 'contract', companyId).then((health) => (
        health.complete ? health.rows : store.list('contract', companyId)
      ))
      : store.list('contract', companyId);
    const [contractRows, partnerRows, policyRows, productRows] = await Promise.all([
      contractsRead,
      store.list('partner', companyId).catch(() => [] as EntityRecord[]),
      store.list('policy', companyId).catch(() => [] as EntityRecord[]),
      store.list('product', companyId).catch(() => [] as EntityRecord[]),
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
  }, [basePath, contracts]);

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

    // 상품 카드에서 넘어온 차 — 여기서도 «차량이 정책을 데려온다»(사장님 2026-08-20). 계약서 종류는 파생값이 정한다.
    const providerCompanyCode = S(product.provider_company_code);
    const { policy } = resolveVehiclePolicy(product, policiesByProviderMap.get(providerCompanyCode) || []);
    setSelectedCode('');
    setVehicleQuery('');
    setVehiclePickerOpen(false);
    setDraft({
      ...emptyEsignDraftInput('direct', today()),
      providerCompanyCode,
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
    if (!draft.annualMileage) selectionChecks.push({ key: 'annual_mileage_snapshot', label: '약정주행거리', level: 'BLOCK', message: '기간에 맞는 약정주행거리와 가격근거를 선택해 주세요' });
    if (!draft.specialTermsChoice) selectionChecks.push({ key: 'special_terms_choice', label: '특약 확인', level: 'BLOCK', message: '특약사항 없음 또는 있음 여부를 확인해 주세요' });
    if (draft.specialTermsChoice === '있음' && !S(draft.specialTerms)) selectionChecks.push({ key: 'special_terms', label: '특약사항', level: 'BLOCK', message: '특약 내용을 입력해 주세요' });
    return [...checks, ...selectionChecks];
  }, [draft, draftPartner, draftPolicy, draftProduct]);
  const draftBlocks = draftChecks.filter((row) => row.level === 'BLOCK');
  const draftProblems = draftChecks.filter((row) => row.level !== 'PASS');
  const draftHasPolicyProblem = draftProblems.some((row) => row.key === 'policy' || row.key === 'policy_readiness' || row.key === 'additional_driver_cost');
  const draftPolicyReadiness = draftPolicy ? policyReadiness(draftPolicy, draftPartner) : null;
  const draftPolicyProblemField = draftPolicyReadiness?.salesMissing[0] || draftPolicyReadiness?.contractMissing[0];
  const draftPolicyField = draftPolicyProblemField?.key || (draftProblems.some((row) => row.key === 'additional_driver_cost') ? 'additional_driver_cost' : '');
  /**
   * ★계약서 종류는 «고르는 것»이 아니라 «정해지는 것»(사장님 2026-08-20).
   *   차량 상품구분(렌트/구독) × 정책 보험조건(포함/별도) → 표준계약서 3벌 중 하나가 유일하게 나온다.
   *   그래서 차량과 정책이 정해지기 전에는 계약서도 미정이고, 정해진 뒤에는 어긋날 일이 없다.
   */
  const draftTemplate = useMemo(() => (
    draftProduct && draftPolicy
      ? templateForKindAndInsurance(productContractKind(draftProduct), insuranceSideFromPolicy(draftPolicy))
      : null
  ), [draftProduct, draftPolicy]);
  const draftContractKind = draftTemplate && draft ? contractKindFor(draftTemplate, draft.maturity) : null;
  const draftTemplateError = draftTemplate && draftContractKind
    ? standardTemplateSelectionError(draftTemplate, draftContractKind, draftPolicy)
    : '';
  // 계약서 종류를 draft 에도 적어 둔다 — 저장·복원(정책 편집 다녀오기)에서 같은 값을 쓰게.
  useEffect(() => {
    const id = draftTemplate?.id || '';
    setDraft((current) => (current && current.standardTemplateId !== id ? { ...current, standardTemplateId: id } : current));
  }, [draftTemplate]);
  /** 정책 선택지 — 그 공급사 정책. 차량이 정해졌으면 그 차 상품구분에 맞는 것만. */
  const policiesForDraft = useMemo(() => {
    if (!draft?.providerCompanyCode) return [];
    const rows = policiesByProviderMap.get(draft.providerCompanyCode) || [];
    if (!draftProduct) return rows;
    const kind = productContractKind(draftProduct);
    return rows.filter((row) => {
      const type = S(row.policy_type);
      if (!type) return true;
      return kind === '구독' ? /구독/.test(type) : !/구독/.test(type);
    });
  }, [draft?.providerCompanyCode, draftProduct, policiesByProviderMap]);
  // 차량 후보는 «회사만» 정해지면 열린다 — 계약서 종류는 고른 차가 정한다.
  const vehicleResults = useMemo(() => searchContractVehicles(
    products,
    draft?.providerCompanyCode || '',
    null,
    deferredVehicleQuery,
  ), [deferredVehicleQuery, draft?.providerCompanyCode, products]);
  const companyVehicleCount = useMemo(() => searchContractVehicles(
    products,
    draft?.providerCompanyCode || '',
    null,
    '',
  ).length, [draft?.providerCompanyCode, products]);
  const availablePeriods = useMemo(() => draftProduct ? priceList(draftProduct) : [], [draftProduct]);
  const mileageOptions = useMemo(() => contractMileageOptions(
    draftProduct,
    Number(draft?.rentMonths) || 0,
    draftPolicy,
  ), [draft?.rentMonths, draftPolicy, draftProduct]);
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

  /** 공급사별 «계약서를 못 보내는 이유»(임대인 정보) — 회사만 골라도 알 수 있다. 목록 라벨과 카드 1 에 함께 쓴다. */
  const supplierBlockersByCode = useMemo(() => {
    const map = new Map<string, EsignCheck[]>();
    for (const row of partners) map.set(partnerKey(row), esignPartnerChecks(row).filter((c) => c.level === 'BLOCK'));
    return map;
  }, [partners]);
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
      const q = deferredQuery.trim().toLowerCase();
      if (!q) return true;
      return [row.customer_name, row.vehicle_name_snapshot, row.car_number_snapshot, row.contract_code]
        .some((value) => S(value).toLowerCase().includes(q));
    }), [contracts, deferredQuery]);

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
      // 정책만 바꾼다 — 차는 그대로 둔다(차가 정책을 데려오는 순서라 되돌아가지 않는다).
      //   다만 대여료·연령은 정책이 정하므로 다시 고르게 비운다.
      const chosen = policies.find((row) => policyKey(row) === value) || null;
      setDraft((current) => current ? {
        ...current,
        ...policyDraftPatch(chosen),
        rentMonths: '',
        rentAmount: '',
        depositAmount: '0',
        depositInstallment: '',
        driverAge: '',
      } : current);
      return;
    }
    if (key === 'providerCompanyCode') {
      // 회사가 바뀌면 차·정책을 모두 비운다. ★정책을 미리 찍지 않는다 — 차가 정한다(사장님 2026-08-20).
      setVehicleQuery('');
      setVehiclePickerOpen(false);
      setDraft((current) => current ? resetVehicleDraft(current, {
        providerCompanyCode: value,
        ...policyDraftPatch(null),
      }) : current);
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
    /**
     * ★차량이 정책을 데려온다(사장님 2026-08-20 「차량선택(정책없으면 정책까지 선택)」).
     *   ① 그 차의 정책코드로 찾고 ② 못 찾으면 그 상품구분의 공급사 정책이 하나뿐일 때만 그것 ③ 그래도 없으면 미정 → 카드 2에서 고른다.
     *   계약서 종류는 여기서 안 고른다 — 차량 상품구분 × 정책 보험조건으로 저절로 정해진다.
     */
    const providerPolicies = policiesByProviderMap.get(S(product.provider_company_code)) || [];
    const pick = resolveVehiclePolicy(product, providerPolicies);
    if (pick.policy) {
      if (pick.how === '공급사 정책') toast(`이 차에 매칭된 정책이 없어 공급사 정책 「${S(pick.policy.policy_name || pick.policy.policy_code)}」으로 맞췄습니다`, 'info');
    } else {
      toast('이 차에 매칭된 정책이 없습니다 — 계약정책을 골라 주세요', 'info');
    }
    setDraft((current) => current ? {
      ...resetVehicleDraft(current),
      providerCompanyCode: S(product.provider_company_code),
      ...snapshot,
      ...policyDraftPatch(pick.policy),
    } : current);
  };

  const selectPeriod = (months: number) => {
    if (!draftProduct) return;
    const age = Number(S(draft?.driverAge).match(/(\d{2})/)?.[1] || draftPolicy?.basic_driver_age || 0);
    const options = contractMileageOptions(draftProduct, months, draftPolicy);
    const selectedMileage = options.find((option) => option.label === draft?.annualMileage) || options[0];
    const price = contractRentForTerms(draftProduct, months, draftPolicy, age, selectedMileage);
    setDraft((current) => {
      if (!current || !price) return current;
      const depositOptions = depositInstallmentOptions(draftPolicy, price.deposit);
      return {
        ...current,
        rentMonths: String(months),
        rentAmount: String(price.rent),
        depositAmount: String(price.deposit),
        annualMileage: selectedMileage.label,
        priceVariantKey: price.priceVariantKey,
        mileageSurcharge: price.mileageSurcharge,
        ageSurcharge: price.ageSurcharge,
        depositInstallment: depositOptions.length === 1 ? depositOptions[0] : (depositOptions.includes(current.depositInstallment || '') ? current.depositInstallment : ''),
      };
    });
  };

  const selectMileage = (label: string) => {
    const mileage = mileageOptions.find((option) => option.label === label);
    const months = Number(draft?.rentMonths) || 0;
    const age = Number(S(draft?.driverAge).match(/(\d{2})/)?.[1] || draftPolicy?.basic_driver_age || 0);
    const price = contractRentForTerms(draftProduct, months, draftPolicy, age, mileage);
    setDraft((current) => current && mileage && price ? {
      ...current,
      annualMileage: mileage.label,
      priceVariantKey: price.priceVariantKey,
      mileageSurcharge: price.mileageSurcharge,
      ageSurcharge: price.ageSurcharge,
      rentAmount: String(price.rent),
      depositAmount: String(price.deposit),
    } : current);
  };

  const selectDriverAge = (age: number) => {
    const months = Number(draft?.rentMonths) || 0;
    const mileage = mileageOptions.find((option) => option.label === draft?.annualMileage) || mileageOptions[0];
    const price = contractRentForTerms(draftProduct, months, draftPolicy, age, mileage);
    const label = driverAgeOptions.find((option) => option.age === age)?.label || `만 ${age}세 이상`;
    setDraft((current) => current ? {
      ...current,
      driverAge: label,
      ...(price ? {
        rentAmount: String(price.rent), depositAmount: String(price.deposit),
        priceVariantKey: price.priceVariantKey, mileageSurcharge: price.mileageSurcharge, ageSurcharge: price.ageSurcharge,
      } : null),
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
      const driverAge = Number(S(draft.driverAge).match(/(\d{2})/)?.[1] || 0);
      const input: Omit<CreateFreepassDirectContractInput, 'requestId'> = {
        policyCode: draft.policyCode,
        contractDate: draft.contractDate,
        productCode: S(draft.productCode),
        rentMonths: Number(draft.rentMonths),
        annualMileage: S(draft.annualMileage),
        priceVariantKey: S(draft.priceVariantKey),
        driverAge,
        maturity: draft.maturity,
        depositInstallment: S(draft.depositInstallment),
        paymentTiming: draft.paymentTiming === '후불' ? '후불' : '선불',
        specialTermsChoice: draft.specialTermsChoice === '있음' ? '있음' : '없음',
        specialTerms: draft.specialTerms,
        buyoutPrice: draft.buyoutPrice,
        driverScope: draft.driverScope,
        maintenanceProduct: draft.maintenanceProduct,
      };
      const fingerprint = JSON.stringify(input);
      if (!directCreateRequest.current || directCreateRequest.current.fingerprint !== fingerprint) {
        directCreateRequest.current = {
          fingerprint,
          id: globalThis.crypto?.randomUUID?.()
            || `create-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
        };
      }
      const code = await createFreepassDirectContract({ requestId: directCreateRequest.current.id, ...input });
      await load(true);
      setSelectedCode(code);
      setDraft(null);
      directCreateRequest.current = null;
      toast('계약서를 만들었습니다. 계약서를 확인하고 링크를 만드세요.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '계약서를 만들지 못했습니다.', 'error');
    } finally { setBusy(false); }
  };

  const draftReachedReview = !!(
    draft?.productCode
    && draft.policyCode
    && draft.rentMonths
    && draft.rentAmount
    && draft.driverAge
    && draft.annualMileage
    && draft.specialTermsChoice
  );
  /** 회사만 골라도 아는 것 = 임대인 정보 · 정책까지 고르면 아는 것 = 정책 빈칸. 둘 다 그 카드에서 바로 보여 준다. */
  const draftSupplierBlockers = useMemo(() => (
    draft?.providerCompanyCode ? esignPartnerChecks(draftPartner).filter((c) => c.level === 'BLOCK') : []
  ), [draft?.providerCompanyCode, draftPartner]);
  const draftPolicyBlockers = draftPolicy
    ? draftChecks.filter((c) => c.level === 'BLOCK' && POLICY_PROBLEM_KEYS.has(c.key))
    : [];
  const draftBaseReady = !!draft?.providerCompanyCode;
  /** 차량 단계 완료 = 차 + 정책(그래야 계약서 종류까지 정해진다). */
  const draftVehicleReady = !!(draftProduct && draftPolicy && draftTemplate);
  const draftRentReady = !!(draftVehicleReady && draft?.rentMonths && draft.rentAmount);
  // 선택이 끝나 다음 카드가 «지금 할 차례»가 되면 그 카드를 위로 끌어올린다.
  // 1 차량(+공급사·정책) → 2 기간별 대여료 → 3 조건 → 「계약서 만들기」 줄.
  const draftStepKey = !draft ? ''
    : draftReachedReview ? 'create'
      : draftRentReady ? 'cond'
        : draftVehicleReady ? 'rent'
          : 'vehicle';
  const lastDraftStepKey = useRef('');
  useEffect(() => {
    if (lastDraftStepKey.current === draftStepKey) return;
    const advanced = !!lastDraftStepKey.current && lastDraftStepKey.current !== 'create';
    lastDraftStepKey.current = draftStepKey;
    if (!advanced) return;
    const target = draftStepKey === 'vehicle' ? vehicleStepRef.current
      : draftStepKey === 'rent' ? rentStepRef.current
        : draftStepKey === 'cond' ? condStepRef.current
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
  /** 정책은 파트너사관리에서 수정한다. 초안은 저장 전이라 왕복 중에만 세션에 보관한다. */
  const openPolicyEditor = (policyCode: string, providerCode: string) => {
    if (draft) sessionStorage.setItem(ESIGN_POLICY_DRAFT_SESSION_KEY, JSON.stringify(draft));
    router.push(partnerPolicyManageUrl(providerCode, policyCode));
  };
  /** 임대인 정보는 공유 기준정보이므로 파트너사관리에서만 수정한다. */
  const openPartnerManager = () => {
    if (draft) sessionStorage.setItem(ESIGN_POLICY_DRAFT_SESSION_KEY, JSON.stringify(draft));
    router.push(partnerManagePartnerUrl(draft?.providerCompanyCode || S(selected?.provider_company_code)));
  };
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
            anchorRef={vehicleStepRef}
            title="차량번호 선택"
            description="차량번호·차명을 바로 검색하거나, 공급사로 먼저 좁혀서 고를 수 있습니다"
            state={draftVehicleReady ? 'complete' : 'active'}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: 10 }}>
              <FormGrid
                fields={COMPANY_STEP_FIELDS}
                form={draft as unknown as EntityRecord}
                onChange={setDraftValue}
                cols={1}
                selectOptions={{
                  providerCompanyCode: contractSuppliers.map((row) => {
                    const code = partnerKey(row);
                    const blocked = (supplierBlockersByCode.get(code) || []).length;
                    // 고르기 «전에» 보이게 — 못 보내는 회사를 몰라서 세 단계를 다 채우고 알게 되면 안 된다.
                    return {
                      value: code,
                      label: `${partnerCompanyDisplayName(row) || '공급사명 미등록'} · 출고가능 ${(availableVehicleCountsByProvider.get(code) || 0).toLocaleString('ko-KR')}대${blocked ? ` · ⚠ 회사정보 ${blocked}개 필요` : ''}`,
                    };
                  }),
                }}
              />
              {/* ★못 보내는 이유는 «그걸 아는 단계»에서 바로 — 회사를 고르면 임대인 정보가 다 있는지 여기서 안다. */}
              {draftSupplierBlockers.length ? (
                <EsignProblemList
                  problems={draftSupplierBlockers}
                  header={`${partnerCompanyDisplayName(draftPartner) || '이 공급사'} — 계약서를 만들 수 없습니다`}
                  onFixPartner={openPartnerManager}
                  partnerName={partnerCompanyDisplayName(draftPartner) || ''}
                  footer={`${partnerCompanyDisplayName(draftPartner) || '이 공급사'}의 계약서 임대인 정보가 비어 있어 계약서를 만들 수 없습니다. 파트너사관리에서 채우면 바로 진행됩니다.`}
                />
              ) : null}
            </div>
              <div
                  style={{ position: 'relative', zIndex: vehiclePickerOpen ? 20 : undefined, display: 'grid', gap: 3 }}
                  onFocusCapture={() => setVehiclePickerOpen(true)}
                  onBlurCapture={(event) => {
                    const next = event.relatedTarget;
                    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setVehiclePickerOpen(false);
                  }}
                >
                  <div style={{ fontSize: FS.cap, color: C.mute }}>차량번호·차명<span style={{ color: C.danger }}> *</span></div>
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
                        <span>{partnerCompanyDisplayName(draftPartner) || '전체'} 출고가능 {companyVehicleCount.toLocaleString('ko-KR')}대</span>
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
                            : '출고가능한 차량이 없습니다.'}
                        </CenterNote>
                      )}
                    </div>
                  ) : null}
                </div>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
                {/* ★정책 — 차가 데려온다. 못 데려왔으면 여기서 고른다. 계약서 종류는 이 둘로 정해져 아래에 표시만 된다. */}
                {draftProduct ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <FormGrid
                      fields={VEHICLE_POLICY_FIELDS}
                      form={draft as unknown as EntityRecord}
                      onChange={setDraftValue}
                      cols={2}
                      selectOptions={{
                        policyCode: policiesForDraft.map((row) => ({ value: policyKey(row), label: policyOptionLabel(row) })),
                      }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: FS.sub, color: C.mute }}>
                      {draftTemplate ? (
                        <>
                          <Badge tone="blue" variant="quiet">
                            계약서 · {draftTemplate.contractKind === '렌탈' ? '렌트' : '구독'} · {draftTemplate.insuranceSide === '고객직접' ? '보험별도' : '보험포함'}
                          </Badge>
                          <span>차량 상품구분과 정책 보험조건으로 정해졌습니다</span>
                        </>
                      ) : (
                        <Badge tone="amber" variant="quiet">계약정책을 고르면 계약서 종류가 정해집니다</Badge>
                      )}
                      {draftTemplateError ? <Badge tone="red" variant="solid">{draftTemplateError}</Badge> : null}
                    </div>
                    {/* 정책을 고른 순간 그 정책의 빈칸을 여기서 말한다 — 마지막까지 채우고 알게 하지 않는다. */}
                    {draftPolicyBlockers.length ? (
                      <EsignProblemList
                        problems={draftPolicyBlockers}
                        header="이 정책에 빠진 값"
                        onFixPolicy={draft.policyCode ? () => openPolicyEditor(draft.policyCode, draft.providerCompanyCode) : null}
                        partnerName={partnerCompanyDisplayName(draftPartner) || ''}
                        footer="이 정책의 빈칸을 채워야 계약서를 만들 수 있습니다."
                      />
                    ) : null}
                  </div>
                ) : null}
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
          </ContractDraftStep>

          <ContractDraftStep
            number={2}
            anchorRef={rentStepRef}
            title="기간별 대여료"
            description={draftVehicleReady
              ? '기간을 고르면 그 차의 대여료·보증금이 채워집니다. 이 계약의 최종 금액으로 고칠 수 있습니다'
              : '차량과 정책이 정해지면 기간별 대여료를 불러옵니다'}
            state={!draftVehicleReady ? 'waiting' : draftRentReady ? 'complete' : 'active'}
          >
            {draftVehicleReady ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <div style={{ fontSize: FS.sub, color: C.mute, marginBottom: 6 }}>대여기간</div>
                  <ToggleChips
                    selected={new Set(draft.rentMonths ? [draft.rentMonths] : [])}
                    options={availablePeriods.map((price) => ({ key: String(price.m), label: `${price.m}개월` }))}
                    onToggle={(value) => selectPeriod(Number(value))}
                  />
                </div>
                {draft.rentMonths ? (
                  <div>
                    <div style={{ fontSize: FS.sub, color: C.mute, marginBottom: 6 }}>약정주행거리</div>
                    {mileageOptions.length ? (
                      <ToggleChips
                        selected={new Set(draft.annualMileage ? [draft.annualMileage] : [])}
                        options={mileageOptions.map((option) => ({
                          key: option.label,
                          label: `${option.label}${option.mileageSurcharge ? ` · 월 +${won(option.mileageSurcharge)}` : ''}`,
                        }))}
                        onToggle={selectMileage}
                      />
                    ) : (
                      <div style={{ fontSize: FS.sub, color: C.danger }}>이 기간의 약정주행거리 가격근거가 없습니다. 정책 또는 차량 가격표를 확인해 주세요.</div>
                    )}
                    {draft.annualMileage ? <div style={{ marginTop: 5, fontSize: FS.sub, color: C.mute }}>
                      {draft.priceVariantKey ? `차량 가격표 ${draft.priceVariantKey} 기준` : '정책 기본값 및 1만km 상향요금 기준'}
                    </div> : null}
                  </div>
                ) : null}
                {!erp5Mode ? <FormGrid
                  fields={RENT_PAYMENT_FIELDS}
                  form={draft as unknown as EntityRecord}
                  onChange={setDraftValue}
                  cols={3}
                  showNotes
                /> : null}
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
            ) : null}
          </ContractDraftStep>

          <ContractDraftStep
            number={3}
            anchorRef={condStepRef}
            title="조건"
            description={draftRentReady
              ? '운전자 연령을 고르면 정책 가산이 대여료에 반영됩니다. 특약도 없음·있음을 확인합니다'
              : '기간과 대여료를 정하면 조건을 고릅니다'}
            state={!draftRentReady ? 'waiting' : draftReachedReview ? 'complete' : 'active'}
          >
            {draftRentReady ? (
              <div style={{ display: 'grid', gap: 10 }}>
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
                {!erp5Mode ? <FormGrid
                  fields={TERM_CONDITION_FIELDS}
                  form={draft as unknown as EntityRecord}
                  onChange={setDraftValue}
                  cols={3}
                  showNotes
                /> : null}
                <>
                    <SectionLabel>특약사항</SectionLabel>
                    <ToggleChips
                      selected={new Set(draft.specialTermsChoice ? [draft.specialTermsChoice] : [])}
                      options={[{ key: '없음', label: '특약 없음' }, { key: '있음', label: '특약 있음 · 내용 입력' }]}
                      onToggle={(value) => setDraft((current) => current ? {
                        ...current,
                        specialTermsChoice: value === '있음' ? '있음' : '없음',
                        ...(value === '없음' ? { specialTerms: '' } : null),
                      } : current)}
                    />
                    {draft.specialTermsChoice === '있음' ? <Textarea
                      value={draft.specialTerms || ''}
                      onChange={(value) => setDraftValue('specialTerms', value)}
                      placeholder="이번 계약에만 적용할 특약을 입력하세요."
                      ariaLabel="특약사항"
                      rows={2}
                      full
                      style={{ background: C.taupeBg }}
                    /> : null}
                  </>
              </div>
            ) : null}
          </ContractDraftStep>

          {/* ── 3단계를 채우면 바로 만든다. 요약·정책값·추가 조건은 아래 접힘 — 펼쳐서 보고 싶을 때만. ── */}
          <div ref={createRowRef} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', scrollMarginTop: 8 }}>
            <Btn
              disabled={busy || !draftReachedReview || draftBlocks.length > 0 || !!draftTemplateError}
              title={!draftReachedReview
                ? '차량(공급사·정책)·대여료·조건을 채우면 바로 만들 수 있습니다'
                : draftBlocks.length ? `발송 전 확인 ${draftBlocks.length}건을 먼저 해결해 주세요` : '계약서를 만들고 발송 전 단계로'}
              onClick={() => void createDraft()}
            >
              <ButtonLabel icon={<FileText size={ICON.md} aria-hidden />}>
                {busy ? '계약서 만드는 중…' : draftReachedReview && draftBlocks.length ? `계약서 만들기 · 확인 ${draftBlocks.length}건` : '계약서 만들기'}
              </ButtonLabel>
            </Btn>
            {draftReachedReview && !draftProblems.length ? <Badge tone="green" variant="fill">만들 수 있습니다</Badge> : null}
            {!draftReachedReview ? <span style={{ fontSize: FS.sub, color: C.faint }}>차량(공급사·정책) → 대여료 → 조건을 채우면 바로 만들 수 있습니다</span> : null}
            <span style={{ flex: 1 }} />
            <Btn variant="ghost" size="sm" onClick={beginDirect}>
              <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>전체 입력 지우기</ButtonLabel>
            </Btn>
          </div>
          {draftReachedReview && draftProblems.length ? (
            <EsignProblemList
              problems={draftProblems}
              onFixPolicy={draftHasPolicyProblem && draft.policyCode ? () => openPolicyEditor(draft.policyCode, draft.providerCompanyCode) : null}
              onFixPartner={hasPartnerProblem(draftProblems) ? openPartnerManager : null}
              partnerName={partnerCompanyDisplayName(draftPartner) || ''}
            />
          ) : null}

          {draftVehicleReady && !erp5Mode ? (
            <details>
              <summary style={{ cursor: 'pointer', color: C.mute, fontSize: FS.sub }}>필요할 때만 추가 계약조건 입력 (계약일 · 대여기간 직접입력 · 만기 인수)</summary>
              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                <FormGrid fields={CONTRACT_META_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
                <FormGrid fields={OPTIONAL_TERM_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
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
            ? () => openPolicyEditor(S(selected.policy_code), S(selected.provider_company_code))
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
          description="목록에서 계약을 고르거나 「새 계약 만들기」로 시작하세요. 차량(공급사·정책) → 대여료 → 조건 세 칸을 채우면 링크를 만듭니다. 자세한 순서는 메뉴 「업무안내·QNA」에 있습니다."
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
            onCreateNewContract={beginDirect}
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
