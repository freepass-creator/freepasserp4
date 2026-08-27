'use client';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { getStore, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, type EntityRecord } from '@/lib/intake/entities';
import { newId } from '@/lib/domain/ids';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { PaneHead, PaneBody, Btn, WorkFields, WorkModeBanner, WorkDock, workMode, Loading, CenterNote, Page, FilterChips, FilterGroup, Message, FeedRowSkeleton } from '@/components/ui';
import { PolicyCreateRow, PolicyListRow } from '@/components/list-rows';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { confirmDialog, toast } from '@/components/Toaster';
import { matchPolicyQuery } from '@/lib/domain/search';
import { haptic } from '@/lib/haptics';
import { NAV_LABEL } from '@/lib/tabbar';
import { canIssueContract, CONTRACT_LAYER, policyReadiness, type PolicyField, type PolicyReadinessStatus } from '@/lib/domain/policy-tier';
import { FREEPASS_POLICY_PACK, POLICY_DEFAULTS, applyPolicyDefaults } from '@/lib/domain/policy-defaults';
import { retainVisibleSelection } from '@/features/work-list-display';
import { providerNameMap } from '@/lib/domain/identity';
import { scopeManagedPolicies } from '@/lib/domain/policy-access';
import { partnerTypeLabel } from '@/lib/domain/partner';
import {
  ESIGN_POLICY_SELECTION_SESSION_KEY,
  type EsignPolicySelection,
} from '@/lib/domain/esign-policy-return';

// 정책 목록·기본 조건을 볼 때는 전자계약 필수서류 편집기가 필요 없다.
// 전자계약 섹션을 선택한 뒤에만 준비해 정책관리의 첫 입력/검색 반응을 유지한다.
const PolicyRequiredDocumentsEditor = dynamic(() => import('@/components/PolicyRequiredDocumentsEditor').then((m) => m.PolicyRequiredDocumentsEditor), {
  ssr: false,
  loading: () => <Loading label="필수 서류 설정을 여는 중…" />,
});

type PolSort = 'name' | 'code' | 'type';
type PolScope = 'all' | 'incomplete' | 'mine' | 'shared';
type PolicySection = 'basic' | 'terms' | 'ins' | 'esign';
type ProviderPolicyIssue = {
  code: string;
  name: string;
  status: PolicyReadinessStatus | '정책 없음';
  policy: EntityRecord | null;
};
const POL_SORTS: { value: PolSort; label: string }[] = [
  { value: 'name', label: '이름순' },
  { value: 'code', label: '코드순' },
  { value: 'type', label: '유형순' },
];
const POL_SCOPE: { key: PolScope; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'incomplete', label: '입력 부족' },
  { key: 'mine', label: '전용' },
  { key: 'shared', label: '공용' },
];

// 정책관리 = [목록 | 기본·심사 | 계약조건 | 보험 | 전자계약]. 스키마 SSOT(ENTITIES.policy) + WorkFields.
// 공급사 = 자기 정책만 편집. 공용(provider_company_code 빈값)은 목록에 안 띄움(재고 Select에서만 연결).
// 필드 그룹 SSOT — detailSections(심사/계약조건/보험)과 동일 골격. 미지정 필드는 보험 패널이 흡수(누락 방지).
const G_BASIC = ['policy_code', 'policy_name', 'provider_company_code', 'policy_type', 'screening_criteria', 'disqualification_conditions', 'sales_notes', 'credit_grade', 'basic_driver_age', 'driver_age_lowering', 'driver_age_upper_limit', 'license_period', 'age_lowering_cost'];
const G_TERMS = ['annual_mileage', 'mileage_upcharge_per_10000km', 'payment_method', 'payment_timing', 'payment_due_date', 'rental_region', 'delivery_fee', 'deposit_installment', 'deposit_card_payment', 'insurance_included', 'personal_driver_scope', 'business_driver_scope', 'additional_driver_allowance_count', 'additional_driver_cost', 'maintenance_service', 'commission_clawback_condition'];
/**
 * 전자계약 패널 — **계약서를 우리가 쓰는 공급사만** 채운다.
 *
 * 목록을 여기 손으로 적지 않고 `CONTRACT_LAYER` 에서 뽑는다.
 * 두 벌로 두면 어긋난다 — 실제로 「초과 주행요금」이 계약 층에 정의돼 있는데
 * 화면에서는 계약조건 패널에 있었다(패널티인데 가격표 옆에 서 있었다).
 * 근거: `docs/POLICY-LAYERS.md` · SSOT: `lib/domain/policy-tier.ts`
 */
const G_ESIGN = [
  'contract_authoring',
  'esign_required_documents',
  ...CONTRACT_LAYER.map((f) => f.key).filter((key) => ![
    'insurer_name',
    'payment_due_date',
    'designated_garage',
    'self_damage_exclusions',
    'replacement_car_policy',
  ].includes(key)),
];

type PolicyInputGroup = {
  title: string;
  hint: string;
  keys: string[];
};

const POLICY_INPUT_GROUPS: Record<PolicySection, PolicyInputGroup[]> = {
  basic: [
    { title: '정책 기본정보', hint: '정책을 구분하고 계약회사에 연결하는 정보입니다.', keys: ['policy_code', 'policy_name', 'provider_company_code', 'policy_type'] },
    { title: '심사 · 상담 기준', hint: '영업 상담과 계약 검토에 사용하는 내부 기준입니다. 손님 화면·계약서엔 나가지 않습니다.', keys: ['screening_criteria', 'disqualification_conditions', 'sales_notes', 'credit_grade'] },
    { title: '운전자 자격', hint: '기본 연령과 면허 요건, 연령 하향 가능 여부를 정합니다.', keys: ['basic_driver_age', 'driver_age_lowering', 'driver_age_upper_limit', 'license_period', 'age_lowering_cost'] },
  ],
  terms: [
    { title: '운행 조건', hint: '약정 주행거리와 이용 가능 지역, 차량 인도 조건입니다.', keys: ['annual_mileage', 'mileage_upcharge_per_10000km', 'rental_region', 'delivery_fee'] },
    { title: '납부 조건', hint: '대여료와 보증금의 결제 방법을 정합니다.', keys: ['payment_method', 'payment_timing', 'payment_due_date', 'deposit_installment', 'deposit_card_payment'] },
    { title: '운전자 범위', hint: '계약 형태별 운전자 범위와 추가 운전자 비용입니다.', keys: ['personal_driver_scope', 'business_driver_scope', 'additional_driver_allowance_count', 'additional_driver_cost'] },
    { title: '포함 서비스·정산', hint: '보험·정비 포함 여부와 수수료 환수 기준입니다.', keys: ['insurance_included', 'maintenance_service', 'commission_clawback_condition'] },
  ],
  ins: [
    { title: '대인·대물', hint: '사고 시 상대방의 인적·물적 피해 보상과 면책 기준입니다.', keys: ['injury_compensation_limit', 'injury_deductible', 'property_compensation_limit', 'property_deductible'] },
    { title: '운전자·무보험차', hint: '운전자 상해와 무보험 차량 사고의 보상 기준입니다.', keys: ['self_body_accident', 'self_body_deductible', 'uninsured_damage', 'uninsured_deductible'] },
    { title: '자차', hint: '대여 차량 손해의 보상 여부와 자기부담 기준입니다.', keys: ['own_damage_compensation', 'own_damage_repair_ratio', 'own_damage_min_deductible', 'own_damage_max_deductible', 'self_damage_exclusions'] },
    { title: '보험·사고 지원', hint: '가입 보험사와 긴급출동, 대차 및 지정 정비 조건입니다.', keys: ['insurer_name', 'annual_roadside_assistance', 'replacement_car_policy', 'designated_garage'] },
  ],
  esign: [
    { title: '주행·승계', hint: '계약서에 표시할 초과 주행요금과 승계 조건입니다.', keys: ['over_mileage_rate_domestic', 'over_mileage_rate_imported', 'succession_allowed', 'succession_fee'] },
    { title: '해지·연체', hint: '중도해지와 연체 발생 시 적용할 기준입니다.', keys: ['early_termination_rate_under1y', 'early_termination_rate_over1y', 'accident_termination_count', 'late_fee_rate'] },
    { title: '반환·보관·회수', hint: '계약 종료 또는 미납 시 반환과 차량 회수 절차입니다.', keys: ['deposit_return_days', 'impound_keep_days', 'impound_fee', 'engine_control_overdue_days', 'auto_terminate_overdue_days', 'deposit_overdue_rounds'] },
    { title: '연장·인수·장치', hint: '계약 연장과 차량 인수 통지, 장착 장치 기준입니다.', keys: ['claim_basis', 'renewal_notice_days', 'buyout_notice_days', 'gps_installed', 'contract_authoring'] },
  ],
};

export default function PolicyMgmt() {
  const co = getCompanyId();
  const [launchKey, setLaunchKey] = useState<string | null>(null);
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [partnerRows, setPartnerRows] = useState<EntityRecord[]>([]);
  const [providerAliases, setProviderAliases] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);
  const [ok, setOk] = useState<boolean | null>(null);
  const [sort, setSort] = useState<PolSort | ''>('name');
  const [scope, setScope] = useState<PolScope>('all');
  /** 신규 작성 / 보기 → 수정 눌러야 편집 (재고·멤버와 동일) */
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<PolicySection>('basic');
  const suppressListResetUntil = useRef(0);
  const launchApplied = useRef(false);
  const [launchRequest, setLaunchRequest] = useState<{
    newProvider: string;
    policy: string;
    field: string;
    section: PolicySection | '';
    edit: boolean;
    returnToEsign: boolean;
    /** 파트너사관리에서 들어옴 — 이 공급사 정책만 보이고, 등록도 이 공급사 것으로(사장님 2026-08-19). */
    providerScope: string;
  } | null>(null);
  const providerScope = launchRequest?.providerScope || '';

  const load = async (r?: Role) => {
    const role = r || getRole();
    const [all, partners] = await Promise.all([
      getStore().list('policy', co),
      getStore().list('partner', co).catch(() => []),
    ]);
    // 표시명은 별도 맵으로 보강한다. 행 데이터에 합치면 편집 저장 시 provider_name이
    // 정책 레코드에 의도치 않게 영속화되므로, 원본 policy는 건드리지 않는다.
    setProviderAliases(providerNameMap(partners));
    setPartnerRows(partners);
    // 공급사는 자기 전용만 관리. 공용 템플릿은 재고 연결용(편집은 admin).
    const mine = scopeManagedPolicies(all, role, role === 'provider' ? actor('provider').code : '');
    setRows(mine);
    return mine;
  };
  const selectP = (p: EntityRecord) => {
    setSel(String(p.policy_code));
    // 비어 있는 칸도 화면·계약에서 같은 답을 내도록 프리패스 표준을 유효값으로 보여 준다.
    // 공급사가 직접 정한 값은 applyPolicyDefaults가 절대 덮지 않는다.
    setForm(applyPolicyDefaults(p).next as EntityRecord);
    setDirty(false);
    setCreating(false);
    setEditing(false);
    setSection('basic');
  };
  const clearSel = () => {
    setSel(null);
    setForm({});
    setDirty(false);
    setCreating(false);
    setEditing(false);
  };

  const newP = (providerCode = '', initialSection: PolicySection = 'basic') => {
    const c = newId('policy');
    const role = getRole();
    const base = applyPolicyDefaults({ policy_code: c }).next as EntityRecord;
    if (role === 'provider') base.provider_company_code = actor('provider').code;
    else if (providerCode) base.provider_company_code = providerCode;
    setSel(c);
    setForm(base);
    setDirty(true);
    setCreating(true);
    setEditing(true);
    setSection(initialSection);
  };

  useEffect(() => {
    setLaunchKey(window.location.search);
  }, []);

  useEffect(() => {
    if (launchKey === null) return;
    const params = new URLSearchParams(launchKey);
    launchApplied.current = false;
    setLaunchRequest({
      newProvider: params.get('new') === '1' ? String(params.get('provider') || '').trim() : '',
      policy: String(params.get('policy') || '').trim(),
      field: String(params.get('field') || '').trim(),
      section: String(params.get('section') || '') as PolicySection | '',
      edit: params.get('edit') === '1',
      returnToEsign: params.get('return') === 'esign',
      providerScope: String(params.get('provider') || '').trim(),
    });
  }, [launchKey]);

  useEffect(() => {
    (async () => {
      // SSR의 로딩 골격이 먼저 hydration을 마치게 한다. 로컬 store가 즉시 응답하면
      // 첫 커밋 전에 목록으로 바뀌어 서버의 Loading과 충돌할 수 있다.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await seedIfEmpty(co);
      const r = getRole();
      if (r !== 'admin' && r !== 'provider') {
        setOk(false);
        setRows([]);
        return;
      }
      setOk(true);
      await load(r);
    })();
    const on = () => {
      const r = getRole();
      if (r !== 'admin' && r !== 'provider') { setOk(false); setRows([]); clearSel(); return; }
      setOk(true);
      load(r).then(() => {
        if (Date.now() >= suppressListResetUntil.current) clearSel();
      });
    };
    window.addEventListener('fp:role', on);
    return () => window.removeEventListener('fp:role', on);
    /* eslint-disable-next-line */
  }, []);

  useEffect(() => {
    if (!ok || !rows || !launchRequest || launchApplied.current) return;
    launchApplied.current = true;
    if (launchRequest.newProvider) {
      suppressListResetUntil.current = Date.now() + 5_000;
      newP(launchRequest.newProvider, 'ins');
      return;
    }
    if (launchRequest.policy) {
      const target = rows.find((policy) => String(policy.policy_code || policy._key) === launchRequest.policy);
      if (!target) return;
      suppressListResetUntil.current = Date.now() + 5_000;
      selectP(target);
      if (['basic', 'terms', 'ins', 'esign'].includes(launchRequest.section)) setSection(launchRequest.section as PolicySection);
      if (launchRequest.edit) setEditing(true);
      return;
    }
    // 업무 목록 공통 규격 — 일반 진입은 목록부터, 사용자가 행을 선택해야 상세를 연다.
    clearSel();
    // `newP`/`selectP` are state transition helpers. The launch request is immutable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, rows, launchRequest]);

  // 전자계약의 누락 항목에서 들어온 경우 해당 입력칸까지 이동한다.
  // data-field 값을 직접 비교해 selector 문자열 삽입과 브라우저별 CSS.escape 의존을 피한다.
  useEffect(() => {
    if (!sel || !editing || !launchRequest?.field) return;
    const timer = window.setTimeout(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-field]'))
        .find((element) => element.dataset.field === launchRequest.field);
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sel, editing, section, launchRequest?.field]);

  // 메뉴에서 정책관리 재진입 → 목록
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail !== '/policy') return;
      if (Date.now() < suppressListResetUntil.current) return;
      clearSel();
    };
    window.addEventListener('fp:work-list', on);
    return () => window.removeEventListener('fp:work-list', on);
  }, []);

  const onChange = (k: string, v: string) => {
    // 공급사는 귀속코드 고정
    if (k === 'provider_company_code' && getRole() === 'provider') return;
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    if (!String(form.policy_code || '').trim()) { toast('정책코드는 필수입니다', 'error'); return; }
    const role = getRole();
    // 최초 패키지만 자동 보충한다. 이미 패키지를 적용한 뒤 공급사가 지운 값은 그대로 둔다.
    // 명시 입력값과 삭제·미사용 의사가 항상 기본값보다 우선한다.
    let patch = applyPolicyDefaults(form).next as EntityRecord;
    if (role === 'provider') {
      const me = actor('provider').code;
      if (!me) { toast('공급사 코드가 없습니다 — 설정·로그인을 확인하세요', 'error'); return; }
      // 타사·공용 정책 덮어쓰기 차단
      const existing = await getStore().get('policy', co, String(form.policy_code));
      if (existing && String(existing.provider_company_code || '') !== me) {
        toast('다른 공급사·공용 정책은 수정할 수 없습니다', 'error');
        return;
      }
      patch = { ...patch, provider_company_code: me };
    }
    try {
      await getStore().save('policy', co, [patch]);
      await getStore().update('policy', co, String(patch.policy_code), patch);
    } catch (e) {
      toast(`저장 실패: ${String((e as Error)?.message || e)}`, 'error');
      return;
    }
    await load(role);
    setDirty(false);
    setCreating(false);
    setEditing(false);
    setSel(String(patch.policy_code));
    setForm(patch);
    haptic.success();
    toast('저장되었습니다', 'ok');
    if (launchRequest?.returnToEsign) {
      const selection: EsignPolicySelection = {
        providerCompanyCode: String(patch.provider_company_code || ''),
        policyCode: String(patch.policy_code || ''),
      };
      sessionStorage.setItem(ESIGN_POLICY_SELECTION_SESSION_KEY, JSON.stringify(selection));
      window.location.assign('/esign?resume=policy');
    }
  };

  const removeP = async () => {
    if (!sel || !form.policy_code) return;
    const role = getRole();
    const exists = (rows || []).some((p) => String(p.policy_code) === String(form.policy_code));
    if (!exists) { clearSel(); return; } // 아직 안 저장된 신규 → 목록으로
    if (role === 'provider') {
      const me = actor('provider').code;
      if (String(form.provider_company_code || '') !== me) {
        toast('다른 공급사·공용 정책은 삭제할 수 없습니다', 'error');
        return;
      }
    }
    if (!await confirmDialog({ title: '정책 삭제', message: `정책 「${form.policy_name || form.policy_code}」을(를) 삭제할까요?\n휴지통에서 복구할 수 있습니다.`, danger: true, okLabel: '삭제' })) return;
    try {
      await getStore().remove('policy', co, String(form.policy_code), '정책관리 삭제');
    } catch (e) {
      toast(`삭제 실패: ${String((e as Error)?.message || e)}`, 'error');
      return;
    }
    clearSel();
    await load(role);
    haptic.success();
    toast('정책이 삭제되었습니다', 'ok');
  };

  const cancelEdit = () => {
    if (launchRequest?.returnToEsign) {
      window.location.assign('/esign?resume=policy');
      return;
    }
    if (creating) { clearSel(); return; }
    const row = (rows || []).find((p) => String(p.policy_code) === sel);
    if (row) { setForm(applyPolicyDefaults(row).next as EntityRecord); setDirty(false); setEditing(false); }
    else clearSel();
  };
  const startEdit = () => { setEditing(true); haptic.tap(); };

  const partnerByCode = useMemo(() => new Map(partnerRows.map((partner) => [
    String(partner.partner_code || partner._key || '').trim(),
    partner,
  ])), [partnerRows]);

  const shown = useMemo(() => (rows || [])
    // 공급사 스코프(파트너사관리에서 옴) — 그 회사 정책만
    .filter((p) => !providerScope || String(p.provider_company_code || '').trim() === providerScope)
    .filter((p) => matchPolicyQuery({
      ...p,
      provider_name: providerAliases[String(p.provider_company_code || '').trim()] || p.provider_name,
    }, deferredQ))
    .filter((p) => {
      if (scope === 'all') return true;
      if (scope === 'incomplete') {
        const providerCode = String(p.provider_company_code || '').trim();
        const partner = partnerByCode.get(providerCode);
        return policyReadiness(p, partner).status !== '완료';
      }
      const has = !!String(p.provider_company_code || '').trim();
      return scope === 'mine' ? has : !has;
    })
    .slice()
    .sort((a, b) => {
      if (!sort) return 0;
      if (sort === 'code') return String(a.policy_code || '').localeCompare(String(b.policy_code || ''), 'ko');
      if (sort === 'type') return String(a.policy_type || '').localeCompare(String(b.policy_type || ''), 'ko')
        || String(a.policy_name || '').localeCompare(String(b.policy_name || ''), 'ko');
      return String(a.policy_name || a.policy_code || '').localeCompare(String(b.policy_name || b.policy_code || ''), 'ko');
    }), [rows, deferredQ, scope, sort, providerAliases, partnerByCode, providerScope]);

  const policySelectOptions = useMemo(() => ({
    provider_company_code: Object.entries(providerAliases)
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko')),
  }), [providerAliases]);

  const readinessByCode = useMemo(() => new Map((rows || []).map((policy) => {
    const code = String(policy.policy_code || policy._key || '').trim();
    const partner = partnerByCode.get(String(policy.provider_company_code || '').trim());
    return [code, policyReadiness(policy, partner)] as const;
  })), [rows, partnerByCode]);
  const providerIssues = useMemo<ProviderPolicyIssue[]>(() => {
    const role = getRole();
    const ownCode = role === 'provider' ? actor('provider').code : '';
    const providers = role === 'provider'
      ? [{ code: ownCode, partner: partnerByCode.get(ownCode) }]
      : partnerRows
        .filter((partner) => partnerTypeLabel(partner.partner_type, partner.partner_code || partner._key) === '공급사')
        .map((partner) => ({ code: String(partner.partner_code || partner._key || '').trim(), partner }));
    return providers.flatMap<ProviderPolicyIssue>(({ code, partner }): ProviderPolicyIssue[] => {
      if (!code) return [];
      const policies = (rows || []).filter((policy) => String(policy.provider_company_code || '').trim() === code);
      const name = providerAliases[code] || String(partner?.name || partner?.partner_name || code);
      if (!policies.length) return [{ code, name, status: '정책 없음' as const, policy: null }];
      const salesProblem = policies.find((policy) => readinessByCode.get(String(policy.policy_code || policy._key || '').trim())?.status === '판매조건 부족');
      const contractProblem = policies.find((policy) => readinessByCode.get(String(policy.policy_code || policy._key || '').trim())?.status === '계약조건 부족');
      const policy = salesProblem || contractProblem;
      if (!policy) return [];
      const status = readinessByCode.get(String(policy.policy_code || policy._key || '').trim())!.status;
      return [{ code, name, status, policy }];
    }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [rows, partnerRows, partnerByCode, providerAliases, readinessByCode]);

  // 검색·필터에서 선택 행이 사라지면 읽기 상세도 함께 정리한다.
  // 신규/수정 중 값은 자동으로 버리지 않는다.
  useEffect(() => {
    if (!sel || dirty || creating) return;
    const visible = shown.map((policy) => String(policy.policy_code));
    if (retainVisibleSelection(sel, visible) === sel) return;
    clearSel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, sel, dirty, creating]);

  if (ok === false) {
    return (
      <Page title={NAV_LABEL.policy}>
        <CenterNote>공급사·관리자만 정책을 관리할 수 있습니다</CenterNote>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <Btn title="홈으로" href="/" size="sm">홈으로</Btn>
        </div>
      </Page>
    );
  }
  if (ok !== true) return <Loading />;

  // 등록 진입점은 목록 맨 위 행 하나로(재고·회원과 동일). 헤더 우측 버튼과 두 갈래로 두지 않는다.
  const scopeAlias = providerScope ? (providerAliases[providerScope] || providerScope) : '';
  const listEl = (
    <>
      <PolicyCreateRow selected={creating} onClick={() => newP(providerScope)} />
      {shown.length === 0
        ? <CenterNote>{q || scope !== 'all' ? '검색 결과 없음.' : providerScope ? `${scopeAlias}의 정책이 없습니다. 위 「정책 등록」으로 추가하세요.` : '등록된 정책이 없습니다. 파트너사 관리에서 회사별 정책을 추가하세요.'}</CenterNote>
        : <div>{shown.map((p) => {
            const on = String(p.policy_code) === sel;
            return (
              <PolicyListRow
                key={String(p.policy_code)}
                selected={on}
                onClick={() => selectP(p)}
                p={p}
                providerName={providerAliases[String(p.provider_company_code || '').trim()]}
                readiness={readinessByCode.get(String(p.policy_code || p._key || '').trim())}
              />
            );
          })}</div>}
    </>
  );

  // 전자계약 필드를 여기 넣지 않으면 보험 패널이 흡수해 버린다(미지정 필드 흡수 규칙).
  const grouped = new Set([...G_BASIC, ...G_TERMS, ...G_ESIGN]);
  const fieldsIn = (keys: string[]) => {
    let keys2 = keys;
    // 공급사는 귀속코드 필드 숨김(자동 스탬프)
    if (getRole() === 'provider') keys2 = keys.filter((k) => k !== 'provider_company_code');
    return ENTITIES.policy.fields.filter((f) => keys2.includes(f.key));
  };
  const insFields = ENTITIES.policy.fields.filter((f) => !grouped.has(f.key));

  /**
   * 전자계약 패널의 안내 — «지금 이 정책으로 계약서를 보낼 수 있는가»를 그 자리에서 말한다.
   * 빈칸을 남긴 채 발송하면 서명 뒤에 봉인되어 고치지 못하므로, 여기서 미리 세어 보인다.
   */
  /**
   * 프리패스 표준값 채우기 — 지금 나가는 계약서와 «같은 값»을 한 번에 넣는다.
   * 이미 값이 있는 칸은 덮지 않는다. 공급사가 다르게 정한 것을 표준으로 되돌리면 안 된다.
   */
  const fillDefaults = () => {
    const { next, filled } = applyPolicyDefaults(form);
    if (!filled.length) { toast('이미 다 채워져 있습니다', 'ok'); return; }
    setForm(next);
    setDirty(true);
    toast(`${filled.length}개 항목에 표준값을 넣었습니다 — 저장해야 반영됩니다`, 'ok');
  };

  const selectedPolicyPartner = partnerRows.find((partner) => (
    String(partner.partner_code || partner._key || '').trim() === String(form.provider_company_code || '').trim()
  )) || null;
  const esignGate = canIssueContract(form, selectedPolicyPartner);
  const esignHint = esignGate.layer !== 'contract'
    ? '파트너사 관리에서 프리패스 전자계약이 미사용으로 설정되어 있습니다.'
    : esignGate.ok
      ? '전자계약 발송 가능 — 아래 값이 계약서와 약관에 그대로 실립니다.'
      : `전자계약 발송 불가 — ${esignGate.missing.length}개 항목이 비어 있습니다: ${esignGate.missing.map((m: PolicyField) => m.label).join(' · ')}`;

  const canEdit = creating || editing;
  const mode = workMode(creating, editing);
  const policyDefaultState = applyPolicyDefaults(form);
  // 공급사가 확인할 빈칸을 채워도 프리패스가 제공한 확정 기본값 개수는 달라지지 않는다.
  const decidedDefaultCount = POLICY_DEFAULTS.filter((item) => item.value !== null).length;
  const pendingDefaultLabels = policyDefaultState.pending.map((item) => item.label);
  const modeBanner = (
    <WorkModeBanner
      mode={mode}
      create={`프리패스 기본정책 ${decidedDefaultCount}개 자동 입력 · ${FREEPASS_POLICY_PACK}`}
    />
  );
  // 하단바 = 편집 컨텍스트만(수정·삭제 / 취소·저장). 등록은 상단 툴바(listTools.action).
  const dockActions = (
    <WorkDock
      mode={mode}
      selected={!!sel}
      dirty={dirty}
      onCancel={cancelEdit}
      onSave={save}
      onEdit={startEdit}
      onRemove={removeP}
    />
  );

  const paneCount = creating ? '신규 입력' : editing ? '수정 중' : sel ? '조회' : undefined;
  const editPane = (sectionKey: PolicySection, title: string, fields: typeof ENTITIES.policy.fields, hint?: string) => {
    const formFields = title === '전자계약'
      ? fields.filter((field) => field.key !== 'esign_required_documents')
      : fields;
    const configuredGroups = POLICY_INPUT_GROUPS[sectionKey];
    const configuredKeys = new Set(configuredGroups.flatMap((group) => group.keys));
    const inputGroups = configuredGroups
      .map((group) => ({ ...group, fields: formFields.filter((field) => group.keys.includes(field.key)) }))
      .filter((group) => group.fields.length > 0);
    const remainingFields = formFields.filter((field) => !configuredKeys.has(field.key));
    if (remainingFields.length > 0) {
      inputGroups.push({
        title: '기타 조건',
        hint: '위 구간에 포함되지 않은 추가 정책 조건입니다.',
        keys: remainingFields.map((field) => field.key),
        fields: remainingFields,
      });
    }
    const firstPane = sectionKey === 'basic';
    return (
    <>
      <PaneHead title={title} count={paneCount} />
      <PaneBody pad>
        {sel ? (
          <>
            {firstPane ? modeBanner : null}
            {firstPane && launchRequest?.returnToEsign ? (
              <Message variant="info">저장하거나 취소하면 작성 중인 전자계약으로 돌아갑니다.</Message>
            ) : null}
            {firstPane && canEdit && pendingDefaultLabels.length > 0 ? (
              <Message variant="warning">
                공급사 확인 필요 {pendingDefaultLabels.length}개 · {pendingDefaultLabels.slice(0, 4).join(' · ')}
                {pendingDefaultLabels.length > 4 ? ` 외 ${pendingDefaultLabels.length - 4}개` : ''}
                {' '}— 계약회사별 실제 보험증권·탁송 조건을 확인해 입력하세요.
              </Message>
            ) : null}
            {title === '전자계약' && canEdit ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Btn title="프리패스 표준값 채우기" size="sm" variant="ghost" onClick={fillDefaults}>
                  프리패스 표준값 채우기
                </Btn>
              </div>
            ) : null}
            {inputGroups.map((group, index) => {
              const accent = sectionKey === 'basic' ? 'main' as const : 'sub' as const;
              return (
                <WorkFields
                  key={group.title}
                  mode={mode}
                  title={group.title}
                  hint={index === 0 && hint ? hint : group.hint}
                  accent={accent}
                  fields={group.fields}
                  form={form}
                  onChange={onChange}
                  cols={2}
                  selectOptions={policySelectOptions}
                />
              );
            })}
            {title === '전자계약' ? (
              <PolicyRequiredDocumentsEditor
                value={form.esign_required_documents}
                disabled={!canEdit}
                onChange={(value) => onChange('esign_required_documents', value)}
              />
            ) : null}
          </>
        ) : (
          <CenterNote>정책을 선택하세요.</CenterNote>
        )}
      </PaneBody>
    </>
    );
  };
  const panes: WorkPane[] = [
    {
      key: 'basic',
      title: '기본·심사',
      node: editPane('basic', '기본·심사', fieldsIn(G_BASIC), '정책 신원·심사 기준'),
    },
    {
      key: 'terms',
      title: '계약조건',
      node: editPane('terms', '계약조건', fieldsIn(G_TERMS), '운행·납부·특약'),
    },
    {
      key: 'ins',
      title: '보험',
      node: editPane('ins', '보험', insFields, '보험·부가 조건'),
    },
    {
      key: 'esign',
      title: '전자계약',
      node: editPane('esign', '전자계약', fieldsIn(G_ESIGN), esignHint),
    },
  ];
  return (
    <>
      <WorkPage title={providerScope ? `${scopeAlias} 정책관리` : NAV_LABEL.policy} listCount={rows === null ? null : shown.length} list={rows === null ? <FeedRowSkeleton /> : listEl} panes={panes} selected={!!sel} onBack={clearSel}
        attentionLabel="확인 필요"
        attentionCount={providerScope ? 0 : providerIssues.length}
        mobileSwapKey={section}
        onMobileSwapKeyChange={(key) => setSection(key as PolicySection)}
        contextTitle={sel ? (creating ? '신규 정책' : String(form.policy_name || form.policy_code || '')) : undefined}
        actions={dockActions}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '정책명·코드·심사·지역…' },
          // 등록은 목록 맨 위 PolicyCreateRow 하나로 — 헤더 우측 버튼과 두 갈래로 두지 않는다.
          filter: {
            count: (scope === 'all' ? 0 : 1) + (sort !== 'name' ? 1 : 0),
            title: '조건 검색',
            onClear: () => { setScope('all'); setSort('name'); },
            body: (
              <>
                <FilterGroup
                  title="정렬"
                  count={sort !== 'name' ? 1 : 0}
                  defaultOpen
                  first
                  onClear={() => setSort('name')}
                >
                  <FilterChips
                    value={sort || 'name'}
                    onChange={(value) => setSort(value)}
                    options={POL_SORTS.map((option) => ({ key: option.value, label: option.label }))}
                    clearKey="name"
                  />
                </FilterGroup>
                <FilterGroup
                  title="귀속"
                  count={scope === 'all' ? 0 : 1}
                  defaultOpen
                  onClear={() => setScope('all')}
                >
                  <FilterChips value={scope} onChange={setScope} options={POL_SCOPE} />
                </FilterGroup>
              </>
            ),
          },
          hints: [
            ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
            ...(sort && sort !== 'name' ? [POL_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...(scope !== 'all' ? [POL_SCOPE.find((o) => o.key === scope)?.label || scope] : []),
          ],
          onClearHints: () => { setQ(''); setSort('name'); setScope('all'); },
        }}
      />
    </>
  );
}
