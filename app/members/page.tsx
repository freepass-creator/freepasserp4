'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, ROLE_LABEL_RAW, ROLES, rangeErrors, type EntityRecord, type Field } from '@/lib/intake/entities';
import { isAdminUiAllowed } from '@/lib/auth-gate';
import { approveUser, adminSetUserActive, adminUpdateUserIdentity } from '@/lib/firebase/auth';
import { readAllPartnersPrivate, readAllUsersPrivate, writePartnerPrivate, writeUserPrivate } from '@/lib/domain/private-fields';
import { newId } from '@/lib/domain/ids';
import {
  PaneHead, PaneBody, Btn, Badge, DetailRow, FormGrid, FormReadList, FormCard,
  ButtonLabel, C, NUM, Loading, CenterNote, FilterChips, FilterGroup, Message, PageActions, FW, FS, ICON,
} from '@/components/ui';
import { RotateCcw, UserCheck, UserRoundX } from 'lucide-react';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { confirmDialog, toast } from '@/components/Toaster';
import { haptic } from '@/lib/haptics';
import { useIsMobile } from '@/lib/use-mobile';
import { NAV_LABEL } from '@/lib/tabbar';
import {
  MEMBER_ACTIVE_OPTIONS as MEM_ACTIVE,
  MEMBER_PARTNER_TYPE_OPTIONS as MEM_PARTNER_TYPES,
  MEMBER_ROLE_OPTIONS as MEM_ROLES,
  MEMBER_SORT_OPTIONS as MEM_SORTS,
  MEMBER_TAB_OPTIONS as MEM_TABS,
  filterMembers,
  memberAccountState,
  memberRoleGroup,
  memberTypeLabel,
  pendingMemberCount,
  PERSONAL_AGENT_COMPANY,
  PERSONAL_AGENT_LABEL,
  PERSONAL_AGENT_NAME,
  type MemberActiveFilter as MemActive,
  type MemberSort as MemSort,
  type MemberTab as Tab,
} from '@/features/members/member-filter';
import { MembersList } from '@/features/members/MembersList';
import { retainVisibleSelection } from '@/features/work-list-display';
import { partnerTypeLabel } from '@/lib/domain/partner';
import { partnerCompanyDisplayName } from '@/lib/domain/identity';
import { businessRegistrationNumberOf, normalizeBusinessRegistrationNumber } from '@/lib/domain/business-identity';
import { parseDepositRule } from '@/lib/domain/sheet-import';
import { isAutoplusPartner } from '@/lib/domain/sheet-autoplus';
import { canIssueContract, partnerUsesFreepassContract } from '@/lib/domain/policy-tier';
import { PartnerPolicyEditor } from '@/components/PartnerPolicyEditor';
import { isContractAvailableVehicle } from '@/lib/domain/esign-vehicle-selection';
import { isStockedProduct } from '@/lib/domain/product';
import { missingProviderContractIdentity, providerContractIdentity } from '@/lib/domain/esign-template-profile';
// 사용자·파트너 관리(관리자) — 역할·활성·영업지급율(user) / 유형·공급사수수료율(partner). 여기 율이 정산 R1/R2 SSOT.
// status(가입승인)는 폼에서 제외 — v4 오버레이가 아니라 approveUser 로 "최상위"에 기록해야 게이트가 인식. 아래 승인 버튼 전용.
const idFieldOf = (t: Tab) => (t === 'user' ? 'uid' : 'partner_code');
const ratePct = (value: unknown) => {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return '';
  return `${Math.round(n * 100)}%`;
};
const strOf = (value: unknown) => String(value ?? '');
const affiliationNameKey = (value: unknown) => String(value || '')
  .toLowerCase()
  .replace(/주식회사|\(주\)|㈜|렌터카|렌트카|모빌리티|[^0-9a-z가-힣]/g, '');
const memberBelongsToPartner = (row: EntityRecord, partnerCode: string, partners: EntityRecord[]) => {
  const codeMatches = [row.company_code, row.agent_channel_code]
    .some((value) => String(value || '').trim() === partnerCode);
  if (codeMatches) return true;

  const memberCompanyName = affiliationNameKey(row.company_name);
  if (!memberCompanyName) return false;

  // 레거시 회원은 소속코드 없이 회사명만 남아 있다. 이름 fallback은 동일 정규화명이
  // 파트너 한 곳에만 매칭될 때만 허용해 동명 회사 두 곳에 회원이 중복 연결되는 것을 막는다.
  const candidateCodes = new Set(partners.flatMap((candidate) => {
    const names = [candidate.name, candidate.alias, partnerCompanyDisplayName(candidate)]
      .map(affiliationNameKey)
      .filter(Boolean);
    if (!names.includes(memberCompanyName)) return [];
    const code = String(candidate.partner_code || candidate._key || '').trim();
    return code ? [code] : [];
  }));
  return candidateCodes.size === 1 && candidateCodes.has(partnerCode);
};
const depositRuleLabel = (value: unknown) => {
  const rule = String(value ?? '');
  if (rule === 'months_per_year') return '기간 1년당 월대여료 1개월치';
  if (rule === 'rent_multiple') return '국산 2개월치 · 수입 3개월치';
  return '미설정 · 시트 보증금만 사용';
};

export default function Members() {
  const co = getCompanyId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab: Tab = searchParams.get('tab') === 'partner' ? 'partner' : 'user';
  const mobile = useIsMobile();
  const [ok, setOk] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>(requestedTab);
  const [rows, setRows] = useState<EntityRecord[]>([]);
  const [affiliationPartners, setAffiliationPartners] = useState<EntityRecord[]>([]);
  const [policyRows, setPolicyRows] = useState<EntityRecord[]>([]);
  const [productRows, setProductRows] = useState<EntityRecord[]>([]);
  const [memberRows, setMemberRows] = useState<EntityRecord[]>([]);
  const [contractRows, setContractRows] = useState<EntityRecord[]>([]);
  const [partnerReferenceLoadError, setPartnerReferenceLoadError] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<MemSort | ''>('name');
  const [roleFlt, setRoleFlt] = useState<'all' | 'sales' | 'provider'>('all');
  const [activeFlt, setActiveFlt] = useState<MemActive>('all');
  const [ptypeFlt, setPtypeFlt] = useState('all');
  /** 신규 작성 / 보기 → 수정 눌러야 편집 (재고·정책과 동일) */
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);

  // 민감필드 enrich — 관리자 화면은 private 노드(fee_rate·email 등)를 병합해 목록/폼/검색에 채운다.
  //  private 비활성·미마이그레이션이면 {} → 본노드 값 그대로(무변경). private 우선(마이그레이션 후 본노드에서 빠진 값 복원).
  const enrichPrivate = async (t: Tab, list: EntityRecord[]): Promise<EntityRecord[]> => {
    try {
      if (t === 'partner') {
        const priv = await readAllPartnersPrivate();
        if (!priv || !Object.keys(priv).length) return list;
        return list.map((r) => { const pv = priv[String(r.partner_code || r._key || '')]; return pv ? { ...r, ...pv } : r; });
      }
      const priv = await readAllUsersPrivate();
      if (!priv || !Object.keys(priv).length) return list;
      return list.map((r) => { const pv = priv[String(r.uid || r._key || '')]; return pv ? { ...r, ...pv } : r; });
    } catch { return list; }
  };
  const load = async (t: Tab) => {
    const referenceFailures: string[] = [];
    const loadPartnerReference = async (entity: string, label: string) => {
      try { return await getStore().list(entity, co); }
      catch {
        referenceFailures.push(label);
        return [] as EntityRecord[];
      }
    };
    const [baseRows, partners, policies, products, members, contracts] = t === 'partner'
      ? await Promise.all([
          getStore().list(t, co),
          Promise.resolve([] as EntityRecord[]),
          loadPartnerReference('policy', '정책'),
          loadPartnerReference('product', '차량'),
          loadPartnerReference('user', '회원'),
          loadPartnerReference('contract', '계약'),
        ])
      : await Promise.all([
          getStore().list(t, co),
          getStore().list('partner', co).catch(() => [] as EntityRecord[]),
          Promise.resolve([] as EntityRecord[]),
          Promise.resolve([] as EntityRecord[]),
          Promise.resolve([] as EntityRecord[]),
          Promise.resolve([] as EntityRecord[]),
        ]);
    const all = await enrichPrivate(t, baseRows);
    const managedRows = t === 'user'
      ? all.filter((row) => memberRoleGroup(row.role) !== 'operator')
      : all.filter((row) => partnerTypeLabel(row.partner_type, row.partner_code || row._key) !== '운영사');
    setRows(managedRows);
    setAffiliationPartners((t === 'partner' ? baseRows : partners).filter((row) => (
      partnerTypeLabel(row.partner_type, row.partner_code || row._key) !== '운영사'
    )));
    setPolicyRows(policies);
    setProductRows(products);
    setMemberRows(members.filter((row) => memberRoleGroup(row.role) !== 'operator'));
    setContractRows(contracts);
    setPartnerReferenceLoadError(t === 'partner' ? referenceFailures.join(' · ') : '');
    return managedRows;
  };
  // 회원·파트너 = 관리자 전용(요율·역할을 바꾸는 화면).
  // 둘러보기는 세션이 없어 getRole()이 localStorage 값을 읽는다 → fp4_role 조작으로 통과 가능하므로 함께 차단.
  // ※ 화면 게이트는 방어의 일부일 뿐 — 실제 강제는 RTDB 규칙에서 해야 한다(현재 v4 오버레이 규칙 미비, 별도 과제).
  useEffect(() => { (async () => { if (!isAdminUiAllowed()) { router.replace('/'); return; } await seedIfEmpty(co); await load(tab); setOk(true); })(); /* eslint-disable-next-line */ }, []);

  const switchTab = async (t: Tab) => {
    if (t === tab) return;
    if (dirty && !await confirmDialog({ title: '수정 취소', message: '수정 중인 내용이 있습니다. 저장하지 않고 이동할까요?', danger: true, okLabel: '이동' })) return;
    router.replace(`/members?tab=${t}`, { scroll: false });
    setTab(t); setSel(null); setForm({}); setRows([]); setAffiliationPartners([]); setPolicyRows([]); setProductRows([]); setMemberRows([]); setContractRows([]); setPartnerReferenceLoadError(''); setDirty(false); setCreating(false); setEditing(false); setQ('');
    setRoleFlt('all'); setActiveFlt('all'); setPtypeFlt('all'); setSort('name');
    return await load(t);
  };
  useEffect(() => {
    if (!ok || requestedTab === tab) return;
    void switchTab(requestedTab);
    // URL 쿼리가 파트너사/회원 관리의 진입점을 결정한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, requestedTab]);
  const select = (r: EntityRecord) => {
    setSel(String(r._key));
    setForm({ ...r });
    setDirty(false);
    setCreating(false);
    setEditing(false);
  };
  // ?partner=코드 — 정책 편집(/policy?provider=…)에서 「파트너사관리로」 돌아오면 그 공급사가 열린 채로(사장님 2026-08-19).
  const requestedPartner = String(searchParams.get('partner') || '').trim();
  const partnerParamApplied = useRef('');
  useEffect(() => {
    if (!ok || tab !== 'partner' || !requestedPartner || !rows.length) return;
    if (partnerParamApplied.current === requestedPartner) return;
    partnerParamApplied.current = requestedPartner;
    const row = rows.find((r) => String(r.partner_code || r._key || '').trim() === requestedPartner);
    if (row) select(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, rows, requestedPartner]);
  /**
   * 운영정책 패널 안 인라인 정책 편집기(사장님 2026-08-19 「정책관리 페이지 없어졌으니 파트너사관리 안에서 · 그 패널에서 아래로 열리게」).
   *   한 번에 하나만 연다 — 줄의 「수정」은 그 줄 아래로, 「정책 추가」는 목록 아래로.
   */
  const [policyEditor, setPolicyEditor] = useState<{ mode: 'new' } | { mode: 'edit'; code: string } | null>(null);
  const requestedPolicy = String(searchParams.get('policy') || '').trim();
  const policyParamApplied = useRef('');
  const refreshPolicies = async () => {
    const fresh = await getStore().list('policy', co).catch(() => null);
    if (fresh) setPolicyRows(fresh);
  };
  /** 파트너사관리에서 정책 삭제(사장님 2026-08-19 「파트너사관리에서 정책 등록·수정·삭제」). 휴지통 복구 가능. */
  const removePartnerPolicy = async (policy: EntityRecord) => {
    const code = String(policy.policy_code || policy._key || '').trim();
    if (!code) return;
    if (!await confirmDialog({ title: '정책 삭제', message: `정책 「${String(policy.policy_name || code)}」을(를) 삭제할까요?\n휴지통에서 복구할 수 있습니다.`, danger: true, okLabel: '삭제' })) return;
    try {
      await getStore().remove('policy', co, code, '파트너사관리 삭제');
    } catch (e) {
      toast(`삭제 실패: ${String((e as Error)?.message || e)}`, 'error');
      return;
    }
    const fresh = await getStore().list('policy', co).catch(() => null);
    setPolicyRows(fresh || policyRows.filter((p) => String(p.policy_code || p._key || '').trim() !== code));
    if (policyEditor?.mode === 'edit' && policyEditor.code === code) setPolicyEditor(null);
    haptic.success();
    toast('정책이 삭제되었습니다', 'ok');
  };
  const openAffiliatedMember = async (row: EntityRecord) => {
    const uid = String(row.uid || row._key || '').trim();
    if (!uid) return;
    const loaded = await switchTab('user');
    const target = loaded?.find((item) => String(item.uid || item._key || '').trim() === uid);
    if (target) select(target);
  };
  const clearSel = () => {
    setSel(null);
    setForm({});
    setDirty(false);
    setCreating(false);
    setEditing(false);
  };
  const onChange = (k: string, v: string) => {
    setForm((current) => {
      if (tab === 'user' && k === 'role') {
        const before = memberRoleGroup(current.role);
        const after = memberRoleGroup(v);
        return before === after
          ? { ...current, role: v }
          : { ...current, role: v, company_code: '', company_name: '', agent_channel_code: '' };
      }
      if (tab === 'user' && k === 'company_code') {
        const group = memberRoleGroup(current.role);
        if (v === PERSONAL_AGENT_COMPANY) {
          return {
            ...current,
            company_code: v,
            company_name: PERSONAL_AGENT_NAME,
            agent_channel_code: group === 'sales' ? String(current.user_code || current.uid || '') : '',
          };
        }
        const partner = affiliationPartners.find((row) => String(row.partner_code || row._key || '').trim() === v);
        return {
          ...current,
          company_code: v,
          company_name: partner ? partnerCompanyDisplayName(partner) : '',
          agent_channel_code: group === 'sales' ? v : '',
        };
      }
      return { ...current, [k]: v };
    });
    setDirty(true);
  };
  // 가입 승인/해제 — approveUser 가 "최상위" users/{uid}/status 에 기록(게이트가 읽는 곳). v4 폼저장으로는 승인 안 됨.
  const doApprove = async (active: boolean) => {
    const uid = String(form.uid || form._key || '');
    if (!uid) { toast('uid 없음 — 승인 불가', 'error'); return; }
    if (approveBusy) return;
    setApproveBusy(true);
    try {
      haptic.select();
      const result = await approveUser(uid, active);
      const approvedPatch = !active
        ? { status: 'pending' }
        : {
            status: 'active',
            is_active: '예',
            ...(result.role ? { role: result.role } : {}),
            ...(result.company_code ? { company_code: result.company_code } : {}),
            ...(!result.matched && result.company_code === PERSONAL_AGENT_COMPANY
              ? {
                  company_name: PERSONAL_AGENT_NAME,
                  agent_channel_code: String(form.user_code || uid),
                }
              : {}),
          };
      const all = await load(tab);
      const row = all.find((item) => String(item.uid || item._key || '').trim() === uid);
      if (row) setForm({ ...row, ...approvedPatch });
      else setForm((f) => ({ ...f, ...approvedPatch }));
      toast(
        !active
          ? '승인 취소(대기)'
          : (!result.matched && result.company_code === PERSONAL_AGENT_COMPANY)
            ? '가입 승인 · 개인영업자로 배정했습니다'
            : '가입 승인 완료',
        'ok',
      );
    } catch (e) { toast(String((e as Error)?.message || e), 'error'); }
    finally { setApproveBusy(false); }
  };
  const newRec = () => {
    // uid는 Firebase Auth가 발급한 인증키, user_code는 ERP5 업무관계용 불변코드다.
    // 관리자가 회원을 직접 등록할 때는 실제 Auth uid를 입력하고 내부코드는 자동 발급한다.
    if (tab === 'user') { const c = newId('user'); setForm({ uid: '', user_code: c, role: 'agent', is_active: '예' }); }
    else { const c = newId('partner'); setForm({ partner_code: c, partner_type: '공급사', esign_contract_enabled: '미사용' }); }
    setSel('new');
    setDirty(true);
    setCreating(true);
    setEditing(true);
  };
  const cancelEdit = () => {
    if (creating) { clearSel(); return; }
    const row = rows.find((r) => String(r._key) === sel);
    if (row) { setForm({ ...row }); setDirty(false); setEditing(false); }
    else clearSel();
  };
  const startEdit = () => {
    setForm((current) => {
      if (tab === 'user' && !String(current.company_code || '').trim()) {
        const group = memberRoleGroup(current.role);
        const expectedType = group === 'provider' ? '공급사' : group === 'sales' ? '영업채널' : '';
        const companyNameKey = affiliationNameKey(current.company_name);
        const affiliation = expectedType && companyNameKey
          ? affiliationPartners.find((row) => (
              partnerTypeLabel(row.partner_type, row.partner_code || row._key) === expectedType
              && [row.name, row.alias, partnerCompanyDisplayName(row)].some((name) => affiliationNameKey(name) === companyNameKey)
            ))
          : null;
        if (affiliation) {
          const companyCode = String(affiliation.partner_code || affiliation._key || '').trim();
          return {
            ...current,
            company_code: companyCode,
            company_name: partnerCompanyDisplayName(affiliation),
            agent_channel_code: group === 'sales' ? companyCode : '',
          };
        }
      }
      if (tab !== 'partner') {
        return current;
      }
      const normalizedType = partnerTypeLabel(current.partner_type, current.partner_code || current._key);
      const normalized = normalizedType === '공급사' || normalizedType === '영업채널'
        ? { ...current, partner_type: normalizedType }
        : current;
      if (normalizedType !== '공급사' || String(current.esign_contract_enabled || '').trim()) return normalized;
      const partnerCode = String(current.partner_code || current.code || '').trim();
      const linkedPolicies = policyRows.filter((policy) => String(policy.provider_company_code || policy.provider_code || '').trim() === partnerCode);
      return {
        ...normalized,
        esign_contract_enabled: partnerUsesFreepassContract(current, linkedPolicies) ? '사용' : '미사용',
      };
    });
    setEditing(true);
    haptic.tap();
  };
  const referencesForPartner = (partnerCode: string) => {
    const matches = (value: unknown) => String(value || '').trim() === partnerCode;
    return {
      members: memberRows.filter((row) => memberBelongsToPartner(row, partnerCode, affiliationPartners)).length,
      policies: policyRows.filter((row) => matches(row.provider_company_code) || matches(row.provider_code)).length,
      products: productRows.filter((row) => matches(row.provider_company_code) || matches(row.partner_code)).length,
      contracts: contractRows.filter((row) => matches(row.provider_company_code) || matches(row.partner_code)).length,
    };
  };
  const save = async () => {
    const id = idFieldOf(tab); if (!String(form[id] || '').trim()) { toast('식별자는 필수입니다', 'error'); return; }
    const missingRequired = ENTITIES[tab].fields.filter((field) => (
      field.required && !String(form[field.key] ?? '').trim()
    ));
    if (missingRequired.length) {
      toast(`${missingRequired.map((field) => field.label).join(' · ')} 항목은 필수입니다`, 'error');
      return;
    }
    if (!String(form.name || '').trim()) { toast(`${tab === 'user' ? '회원 이름' : '파트너사 상호'}은 필수입니다`, 'error'); return; }
    if (tab === 'user') {
      const group = memberRoleGroup(form.role);
      if (group === 'unknown' || group === 'operator') { toast('회원구분을 영업자 또는 공급사 직원으로 선택하세요', 'error'); return; }
      const companyCode = String(form.company_code || '').trim();
      const personal = group === 'sales' && companyCode === PERSONAL_AGENT_COMPANY;
      const affiliation = affiliationPartners.find((row) => String(row.partner_code || row._key || '').trim() === companyCode);
      const requiredType = group === 'sales' ? '영업채널' : '공급사';
      if (!personal && (!affiliation || partnerTypeLabel(affiliation.partner_type, affiliation.partner_code || affiliation._key) !== requiredType)) {
        toast(`${memberTypeLabel(form.role, form.company_code)}의 소속 ${requiredType}를 선택하세요`, 'error');
        return;
      }
    } else {
      const nextType = partnerTypeLabel(form.partner_type, form.partner_code || form._key);
      if (nextType === '분류 필요' || nextType === '운영사') { toast('파트너 유형을 공급사 또는 영업채널로 선택하세요', 'error'); return; }
      const partnerCode = String(form.partner_code || form._key || '').trim();
      const original = rows.find((row) => String(row._key || row.partner_code || '').trim() === partnerCode);
      const originalType = original ? partnerTypeLabel(original.partner_type, original.partner_code || original._key) : '';
      if (original && originalType !== '분류 필요' && originalType !== nextType) {
        if (partnerReferenceLoadError) {
          toast(`연결 데이터(${partnerReferenceLoadError})를 확인하지 못해 유형을 바꿀 수 없습니다`, 'error');
          return;
        }
        const refs = referencesForPartner(partnerCode);
        const total = refs.members + refs.policies + refs.products + refs.contracts;
        if (total > 0) {
          toast(`연결 데이터가 있어 유형을 바꿀 수 없습니다 · 회원 ${refs.members} · 정책 ${refs.policies} · 차량 ${refs.products} · 계약 ${refs.contracts}`, 'error');
          return;
        }
      }
      if (nextType === '공급사' && String(form.esign_contract_enabled || '') === '사용') {
        const missing = missingProviderContractIdentity(providerContractIdentity(form, partnerCode));
        if (missing.length) {
          toast(`전자계약 사용 전 회사정보를 채워주세요: ${missing.join(' · ')}`, 'error');
          return;
        }
      }
    }
    // 율 범위 게이트 — 수수료율(0.1) 자리에 10 이 들어가면 정산액이 100배로 나간다(QA RATE-1).
    //  엔진(normalizeRate)은 최후 방어일 뿐이고, 잘못된 값이 저장되는 것 자체를 여기서 막는다.
    const badRange = rangeErrors(ENTITIES[tab].fields, form);
    if (badRange.length) { toast(badRange[0], 'error'); return; }
    if (saving) return;
    setSaving(true);
    try {
      // 공급사 수수료율(상업기밀)은 private 노드로 라우팅. 이관 성공 시 본노드 쓰기에서 제외(공개 read 차단).
      //  실패(규칙 미게시·no-db)면 본노드에 그대로 남긴다(유실·머니율 누락 방지) — 폴백이 기존 동작 보존.
      let mainForm: EntityRecord = form;
      if (tab === 'partner') {
        const depositRule = parseDepositRule(form.deposit_rule);
        mainForm = { ...form, deposit_rule: depositRule || null };
        const code = String(form.partner_code || form._key || '').trim();
        // 사업자번호는 숫자만 저장한다 — 가입 매칭(matchBizNo)이 숫자 기준으로 찾으므로
        //  '123-45-67890' 로 저장하면 입력해도 영영 매칭되지 않는다.
        const biz = normalizeBusinessRegistrationNumber(form.business_number);
        if (biz) {
          mainForm = { ...form, business_number: biz };
          // 같은 번호를 가진 다른 파트너가 있으면 알린다. **막지는 않는다** — 지점·역할분리(공급사/영업채널)로
          //  정당하게 겹칠 수 있다. 다만 모르고 두 벌 만드는 걸 막아야 한다(실제로 11쌍이 그렇게 생겼다).
          const dup = (rows || []).filter((r) => String(r._key) !== code
            && businessRegistrationNumberOf(r, 'partner') === biz
            && r._deleted !== true && String(r.status || '') !== 'deleted');
          if (dup.length) {
            toast(`사업자번호 ${biz} 를 쓰는 파트너가 이미 있습니다 — ${dup.map((d) => String(d.name || d._key)).join(', ')}. 역할이 다르면 그대로 두고, 같은 역할이면 한쪽으로 합치세요.`, 'info');
          }
        }
        const moved = await writePartnerPrivate(code, { fee_rate: (mainForm as EntityRecord).fee_rate });
        // 이관 성공 시 본노드(v4)에서 fee_rate를 null로 제거 — 단순 제외(delete)는 merge라 옛값이 잔존해
        //  base/private divergence + 마이그레이션 revert를 유발. null로 명시 삭제. (resolveRates·마이그레이션 모두 private-first)
        //  ※ form 이 아니라 mainForm 을 이어받아야 한다 — form 으로 되돌리면 위에서 정규화한 사업자번호가 날아간다.
        if (moved) mainForm = { ...mainForm, fee_rate: null };
      }
      if (tab === 'user') {
        const companyCode = String(form.company_code || '').trim();
        const sales = memberRoleGroup(form.role) === 'sales';
        const personal = sales && companyCode === PERSONAL_AGENT_COMPANY;
        const affiliation = affiliationPartners.find((row) => String(row.partner_code || row._key || '').trim() === companyCode);
        mainForm = {
          ...mainForm,
          company_code: companyCode,
          company_name: personal
            ? PERSONAL_AGENT_NAME
            : affiliation ? partnerCompanyDisplayName(affiliation) : String(form.company_name || ''),
          agent_channel_code: sales
            ? (personal ? String(form.user_code || form.uid || '') : companyCode)
            : '',
        };
        // 이메일(PII)도 같은 계약이다. 이 화면은 private 을 «병합해» 폼을 채우므로 그대로 저장하면
        // 이관해 둔 이메일이 본노드로 되돌아온다 — 회원 한 명 고칠 때마다 조용히 다시 새는 셈이다.
        const uid = String(form.uid || form._key || '').trim();
        const movedEmail = await writeUserPrivate(uid, { email: (mainForm as EntityRecord).email });
        // 실패(규칙 미게시·no-db)면 본노드에 그대로 둔다 — 폴백 계약(유실 방지)이 먼저다.
        if (movedEmail) mainForm = { ...mainForm, email: null };
      }
      const previous = rows.find((row) => String(row._key || row[id] || '') === String(form._key || form[id] || ''));
      await getStore().save(tab, co, [mainForm]); await getStore().update(tab, co, String(form[id]), mainForm);
      // 신원 게이트 필드(role/company_code/agent_channel_code)는 세션(initAuth)·RLS·approveUser 가 읽는 "최상위" users/{uid} 에 직접 반영.
      //  v4 오버레이에만 쓰면 강등·재배정이 조용히 무효(desync) → approveUser 와 동일 노드로 SSOT 정합. status 는 approveUser 전용이라 제외.
      if (tab === 'user') {
        const uid = String(form.uid || form._key || '').trim();
        if (uid) {
          try {
            await adminUpdateUserIdentity(uid, {
              role: mainForm.role != null ? String(mainForm.role) : undefined,
              company_code: mainForm.company_code != null ? String(mainForm.company_code) : undefined,
              agent_channel_code: mainForm.agent_channel_code != null ? String(mainForm.agent_channel_code) : undefined,
              name: mainForm.name != null ? String(mainForm.name) : undefined,
              company_name: mainForm.company_name != null ? String(mainForm.company_name) : undefined,
              user_code: mainForm.user_code != null ? String(mainForm.user_code) : undefined,
              agent_payout_rate: mainForm.agent_payout_rate != null ? String(mainForm.agent_payout_rate) : undefined,
              is_team_manager: mainForm.is_team_manager != null ? String(mainForm.is_team_manager) : undefined,
              is_active: mainForm.is_active != null ? String(mainForm.is_active) : undefined,
            });
          } catch (identityError) {
            try {
              if (previous) {
                await getStore().save('user', co, [previous]);
                await getStore().update('user', co, uid, previous);
              } else {
                await getStore().remove('user', co, uid, '회원 신원 동기화 실패 롤백');
              }
            } catch { /* 원래 오류를 우선 보고한다. */ }
            throw new Error(`권한정보 동기화에 실패해 회원 변경을 되돌렸습니다: ${String((identityError as Error)?.message || identityError)}`);
          }
        }
      }
      setDirty(false);
      setCreating(false);
      setEditing(false);
      const all = await load(tab);
      const key = String(form._key || form[id]);
      const row = all.find((r) => String(r._key || r[id]) === key);
      if (row) setForm({ ...row });
      setSel(key);
      haptic.success();
      toast('저장되었습니다', 'ok');
    } catch (e) {
      toast(`저장 실패: ${String((e as Error)?.message || e)}`, 'error');
    } finally {
      setSaving(false);
    }
  };
  const removeRec = async () => {
    if (!sel || creating) { clearSel(); return; }
    if (tab === 'user') { toast('회원은 삭제하지 않고 사용중지로 관리합니다', 'info'); return; }
    const id = idFieldOf(tab);
    const key = String(form._key || form[id] || '');
    if (!key) return;
    const label = String(form.name || key);
    if (partnerReferenceLoadError) {
      toast(`연결 데이터(${partnerReferenceLoadError})를 확인하지 못해 삭제할 수 없습니다`, 'error');
      return;
    }
    const refs = referencesForPartner(key);
    if (refs.members + refs.policies + refs.products + refs.contracts > 0) {
      toast(`연결 데이터가 있어 삭제할 수 없습니다 · 회원 ${refs.members} · 정책 ${refs.policies} · 차량 ${refs.products} · 계약 ${refs.contracts}`, 'error');
      return;
    }
    if (!await confirmDialog({ title: '파트너사 삭제', message: `「${label}」을(를) 삭제할까요?\n연결 데이터가 없는 파트너사만 삭제할 수 있습니다.`, danger: true, okLabel: '삭제' })) return;
    try {
      await getStore().remove(tab, co, key, '회원·파트너 삭제');
    } catch (e) {
      toast(`삭제 실패: ${String((e as Error)?.message || e)}`, 'error');
      return;
    }
    clearSel();
    await load(tab);
    haptic.success();
    toast('삭제되었습니다', 'ok');
  };

  const setMemberActive = async (active: boolean) => {
    if (tab !== 'user' || !sel || creating || saving) return;
    const uid = String(form.uid || form._key || '').trim();
    if (!uid) return;
    if (!active && !await confirmDialog({
      title: '회원 사용중지',
      message: `${String(form.name || uid)} 회원의 ERP 접근을 즉시 중지할까요?\n계약·정산 기록과 소속 이력은 보존됩니다.`,
      danger: true,
      okLabel: '사용중지',
    })) return;
    setSaving(true);
    const value = active ? '예' : '아니오';
    try {
      // 차단은 권한 SSOT부터 내려야 중간 실패에도 접근이 열려 있지 않다.
      if (!active) await adminSetUserActive(uid, false);
      await getStore().update('user', co, uid, { is_active: value });
      if (active) {
        try { await adminSetUserActive(uid, true); }
        catch (error) {
          await getStore().update('user', co, uid, { is_active: '아니오' }).catch(() => undefined);
          throw error;
        }
      }
      const all = await load('user');
      const row = all.find((item) => String(item._key || item.uid || '') === uid);
      if (row) setForm({ ...row });
      haptic.success();
      toast(active ? '회원 사용을 다시 시작했습니다' : '회원 사용을 중지했습니다', 'ok');
    } catch (error) {
      toast(`${active ? '사용재개' : '사용중지'} 실패: ${String((error as Error)?.message || error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetSheetMapping = async () => {
    if (tab !== 'partner' || !sel || saving) return;
    const code = String(form.partner_code || form._key || '').trim();
    if (!code) return;
    if (!await confirmDialog({
      title: '시트 컬럼 매핑 초기화',
      message: `${String(form.name || code)}의 저장된 컬럼 매핑과 헤더 서명을 지울까요?\n구글시트 원본은 변경되지 않으며, 다음 불러오기에서 헤더를 다시 판독합니다.`,
      danger: true,
      okLabel: '매핑 초기화',
    })) return;
    setSaving(true);
    try {
      await getStore().update('partner', co, code, {
        mapping_profile: null,
        mapping_header_signature: null,
      });
      const all = await load('partner');
      const row = all.find((item) => String(item._key || item.partner_code || '') === code);
      if (row) setForm({ ...row });
      setDirty(false);
      toast('시트 매핑을 초기화했습니다. 재고 화면에서 데이터 검증을 다시 실행하세요.', 'ok');
    } catch (error) {
      toast(`매핑 초기화 실패: ${String((error as Error).message || error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const shown = useMemo(() => filterMembers({
    rows, tab, query: q, sort, role: roleFlt, active: activeFlt, partnerType: ptypeFlt,
  }), [rows, tab, q, sort, roleFlt, activeFlt, ptypeFlt]);

  const selectedPartnerCode = tab === 'partner'
    ? String(form.partner_code || form._key || '').trim()
    : '';
  const linkedPolicies = useMemo(() => selectedPartnerCode
    ? policyRows.filter((policy) => String(policy.provider_company_code || '').trim() === selectedPartnerCode)
    : [], [policyRows, selectedPartnerCode]);
  useEffect(() => { setPolicyEditor(null); }, [selectedPartnerCode]);
  useEffect(() => {
    // ?partner=코드&policy=코드 — 그 공급사의 그 정책이 편집기로 열린 채(계약서관리 「정책 수정」에서 올 때)
    if (!requestedPolicy || !selectedPartnerCode || policyParamApplied.current === requestedPolicy) return;
    if (!linkedPolicies.some((p) => String(p.policy_code || p._key || '').trim() === requestedPolicy)) return;
    policyParamApplied.current = requestedPolicy;
    setPolicyEditor({ mode: 'edit', code: requestedPolicy });
  }, [requestedPolicy, selectedPartnerCode, linkedPolicies]);
  const availableVehicleCount = useMemo(() => selectedPartnerCode
    ? productRows.filter((product) => (
        String(product.provider_company_code || '').trim() === selectedPartnerCode
        && isContractAvailableVehicle(product)
        && isStockedProduct(product)
      )).length
    : 0, [productRows, selectedPartnerCode]);
  const contractReadyPolicyCount = useMemo(() => linkedPolicies.filter((policy) => (
    canIssueContract(policy, form).ok
  )).length, [form, linkedPolicies]);
  const partnerContractEnabled = tab === 'partner'
    && partnerUsesFreepassContract(form, linkedPolicies);
  const selectedPartnerType = tab === 'partner'
    ? partnerTypeLabel(form.partner_type, form.partner_code || form._key)
    : '';
  const selectedPartnerReferences = selectedPartnerCode
    ? referencesForPartner(selectedPartnerCode)
    : { members: 0, policies: 0, products: 0, contracts: 0 };
  const affiliatedMembers = useMemo(() => {
    if (!selectedPartnerCode) return [];
    return memberRows
      .filter((row) => memberBelongsToPartner(row, selectedPartnerCode, affiliationPartners))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  }, [memberRows, selectedPartnerCode, affiliationPartners]);
  const contractIdentity = providerContractIdentity(form, selectedPartnerCode);
  const missingContractIdentity = selectedPartnerType === '공급사'
    ? missingProviderContractIdentity(contractIdentity)
    : [];
  const contractIdentityReady = missingContractIdentity.length === 0;

  // 검색·필터에서 선택 행이 사라지면 읽기 상세도 함께 정리한다.
  // 신규/수정 중 값과 저장 중 상태는 자동으로 버리지 않는다.
  useEffect(() => {
    if (!sel || dirty || creating || saving) return;
    const visible = shown.map((row) => String(row._key));
    if (retainVisibleSelection(sel, visible) === sel) return;
    clearSel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, sel, dirty, creating, saving]);

  if (ok === null) return <Loading />;

  const listEl = (
    <MembersList
      tab={tab}
      rows={shown}
      selected={sel}
      creating={creating}
      draft={form}
      filtered={!!(q || roleFlt !== 'all' || activeFlt !== 'all' || ptypeFlt !== 'all')}
      onSelect={select}
      onCreate={newRec}
      onClearConditions={() => {
        setQ('');
        setRoleFlt('all');
        setActiveFlt('all');
        setPtypeFlt('all');
      }}
    />
  );

  // 승인대기 카운트 + 대기 전용 필터칩(관리자가 신규 가입 처리대상을 한눈에)
  const pendingCount = pendingMemberCount(rows, tab);
  const activeOptions: { key: MemActive; label: string }[] = tab === 'user'
    ? MEM_ACTIVE.map((option) => option.key === 'pending'
      ? { ...option, label: pendingCount ? `승인대기 ${pendingCount}` : '승인대기' }
      : option)
    : MEM_ACTIVE;

  const roleKey = strOf(form.role);
  const roleGroup = memberRoleGroup(roleKey);
  const byKey = Object.fromEntries(ENTITIES[tab].fields.map((f) => [f.key, f]));
  // 관리자 신규 등록은 이미 생성된 Firebase Auth 계정과 정확히 연결할 수 있어야 한다.
  // UID는 관계·권한의 루트 키이므로 생성 중에만 입력을 허용하고 기존 레코드 편집에서는 계속 숨긴다.
  const fieldsIn = (keys: string[]) => keys.map((k) => byKey[k]).filter(Boolean) as Field[];
  const affiliationField = tab === 'user' && byKey.company_code
    ? { ...byKey.company_code, label: '소속', type: 'select' as const, required: true, note: roleGroup === 'provider' ? '공급사만 선택할 수 있습니다' : '바로 승인은 개인영업자입니다. 소속 회사는 나중에 바꿀 수 있습니다' }
    : null;
  const basicFields = tab === 'user'
    ? fieldsIn(creating ? ['uid', 'name', 'user_code'] : ['name', 'user_code']).map((field) => (
        field.key === 'uid'
          ? { ...field, label: '가입계정 UID', required: true, note: '회원가입을 마친 계정을 소속에 연결합니다' }
          : field.key === 'user_code'
            ? { ...field, label: '회원번호' }
            : field
      ))
    : fieldsIn(['name', 'alias', 'partner_type', 'business_number', 'contact']);
  const contractIdentityFields = tab === 'partner' && selectedPartnerType === '공급사'
    ? fieldsIn(['ceo', 'phone', 'address', 'rental_business_no', 'bank_name', 'bank_account', 'bank_holder'])
    : [];
  const accessFields = tab === 'user'
    ? [...(affiliationField ? [affiliationField] : []), ...fieldsIn(['role']).map((field) => ({ ...field, label: '권한' }))]
    : fieldsIn(['esign_contract_enabled']);
  const operationFields = tab === 'user'
    ? (roleGroup === 'sales' ? fieldsIn(['agent_payout_rate', 'is_team_manager']) : [])
    : fieldsIn(['fee_rate', 'sheet_url', 'sheet_tab', 'header_row', 'adapter_id', 'deposit_rule']);
  const canEdit = creating || editing;
  const readAsRows = mobile && !canEdit;
  const modeBanner = creating ? (
    <Message variant="info">{tab === 'user' ? '기존 가입회원 연결' : '신규 파트너사'} — 필수 항목을 입력한 뒤 저장하세요.</Message>
  ) : editing ? (
    <Message variant="warning">수정 중 · 저장해야 반영됩니다</Message>
  ) : null;
  const accountState = memberAccountState(form);
  const inactive = accountState === 'inactive';
  const pending = accountState === 'pending';
  // 하단바 = 편집 컨텍스트만(수정·삭제 / 취소·저장). 회원·파트너사는 서로 다른 데이터 축이다.
  const editActions = creating || editing ? (
    <PageActions cancel={{ onClick: cancelEdit, disabled: saving }} save={{ onClick: save, disabled: !dirty || saving, label: saving ? '저장 중…' : undefined }} />
  ) : sel ? (
    <PageActions
      edit={{ onClick: startEdit }}
      remove={tab === 'partner' ? { onClick: removeRec } : undefined}
      extra={tab === 'user' && !pending ? (
        <Btn
          size="sm"
          variant={inactive ? 'solid' : 'danger'}
          onClick={() => setMemberActive(inactive)}
          disabled={saving}
        >
          {inactive ? '사용재개' : '사용중지'}
        </Btn>
      ) : undefined}
    />
  ) : null;

  const accessTitle = tab === 'user' ? '소속·권한' : '계약·정책';
  const operationTitle = tab === 'user' ? '영업설정' : '소속·운영';
  const basicHint = tab === 'user' ? '이름과 회원번호는 목록·계약 당사자 표시에 쓰입니다.' : '영업채널·공급사의 회사정보를 관리합니다.';
  const accessHint = tab === 'user'
    ? '소속과 권한이 메뉴 접근 및 데이터 범위의 기준입니다.'
    : '프리패스 전자계약을 사용하는 공급사만 계약작성 회사 선택에 표시됩니다.';
  const autoplusForm = tab === 'partner' && isAutoplusPartner(form);
  const operationHint = tab === 'user'
    ? (roleGroup === 'sales'
      ? '영업지급율(0~1)은 월대여료 대비 영업자 지급 비율이며 정산 R2 기준입니다.'
      : '공급사 직원의 데이터 범위는 선택한 소속 공급사를 기준으로 정해집니다.')
    : autoplusForm
      ? '오토플러스 시트는 보증금 열이 없으므로 「국산 2개월치 · 수입 3개월치」 규칙이 필수입니다. 미설정하면 가격없음으로 동기화가 차단됩니다.'
      : '공급사 수수료율은 정산 기준이며, 구글시트 설정은 재고를 불러오는 연결 정보입니다.';

  const approveBar = tab === 'user' && pending ? (
    <Message variant="warning">
      승인대기 — 승인하면 이 계정이 앱을 사용할 수 있습니다.{' '}
      <Btn title={approveBusy ? '가입 승인 처리 중' : '가입 승인'} size="sm" onClick={() => doApprove(true)} disabled={approveBusy}>
        <ButtonLabel icon={<UserCheck size={ICON.md} aria-hidden />}>{approveBusy ? '처리 중…' : '가입 승인'}</ButtonLabel>
      </Btn>
    </Message>
  ) : tab === 'user' && strOf(form.status) === 'active' ? (
    <Btn title={approveBusy ? '승인 취소 처리 중' : '승인 취소 후 대기로 변경'} size="sm" variant="ghost" onClick={() => doApprove(false)} disabled={approveBusy}>
      <ButtonLabel icon={<UserRoundX size={ICON.md} aria-hidden />}>{approveBusy ? '처리 중…' : '승인 취소(대기로)'}</ButtonLabel>
    </Btn>
  ) : null;

  const roleSelectOptions = tab === 'user'
    ? {
        role: ROLES
          .filter((r) => r !== 'agent_manager' || roleKey === 'agent_manager')
          .map((r) => ({ value: r, label: ROLE_LABEL_RAW[r] })),
      }
    : undefined;
  const affiliationOptions = affiliationPartners
    .filter((row) => {
      const type = partnerTypeLabel(row.partner_type, row.partner_code || row._key);
      return roleGroup === 'provider' ? type === '공급사' : type === '영업채널';
    })
    .map((row) => ({
      value: String(row.partner_code || row._key || '').trim(),
      label: partnerCompanyDisplayName(row),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  if (roleGroup === 'sales') {
    const personal = { value: PERSONAL_AGENT_COMPANY, label: PERSONAL_AGENT_LABEL };
    const existing = affiliationOptions.findIndex((option) => option.value === PERSONAL_AGENT_COMPANY);
    if (existing >= 0) affiliationOptions[existing] = personal;
    else affiliationOptions.unshift(personal);
  }
  const currentCompanyCode = strOf(form.company_code).trim();
  if (currentCompanyCode && !affiliationOptions.some((option) => option.value === currentCompanyCode)) {
    affiliationOptions.unshift({ value: currentCompanyCode, label: strOf(form.company_name) || `${currentCompanyCode} · 소속 재선택 필요` });
  }

  const memberSelectOptions = tab === 'user'
    ? { ...(roleSelectOptions || {}), company_code: affiliationOptions }
    : undefined;
  const memberSection = (title: string | undefined, fields: Field[], hint?: string, selectOptions?: typeof memberSelectOptions) => {
    if (!fields.length) return null;
    if (readAsRows) {
      return <FormReadList header={title} footer={hint} fields={fields} form={form} selectOptions={selectOptions} />;
    }
    return (
      <FormCard title={title} hint={hint}>
        <FormGrid fields={fields} form={form} onChange={onChange} cols={2} disabled={!canEdit} selectOptions={selectOptions} />
      </FormCard>
    );
  };

  const basicRead = tab === 'user' ? null : (
    <>
      <DetailRow label="상호/이름" value={strOf(form.name)} />
      <DetailRow
        label="유형"
        value={(() => {
          const type = partnerTypeLabel(form.partner_type, form.partner_code || form._key);
          return <Badge tone={type === '공급사' ? 'blue' : type === '분류 필요' ? 'red' : 'gray'}>{type}</Badge>;
        })()}
      />
      <DetailRow label="사업자번호" value={businessRegistrationNumberOf(form, 'partner')} />
      <DetailRow label="연락처" value={strOf(form.contact)} />
    </>
  );
  const contractIdentityRead = tab === 'partner' && selectedPartnerType === '공급사' ? (
    <FormCard
      title="계약서 회사정보"
      hint="임대인 정보와 대여료 입금 안내에 사용하는 공급사 기준값입니다."
    >
      <DetailRow label="대표자" value={strOf(form.ceo)} />
      <DetailRow label="대표번호" value={strOf(form.phone)} />
      <DetailRow label="사업장 주소" value={strOf(form.address)} stacked={!!strOf(form.address)} />
      <DetailRow label="대여사업 등록번호" value={strOf(form.rental_business_no)} />
      <DetailRow label="입금계좌" value={[strOf(form.bank_name), strOf(form.bank_account), strOf(form.bank_holder)].filter(Boolean).join(' · ')} stacked />
    </FormCard>
  ) : null;

  const accessRead = tab === 'user' ? null : (
    <>
      <DetailRow
        label="프리패스 전자계약"
        value={<Badge tone={partnerContractEnabled ? 'green' : 'gray'} variant="quiet">{partnerContractEnabled ? '사용' : '미사용'}</Badge>}
      />
      <DetailRow
        label="계약서 회사정보"
        value={<Badge tone={contractIdentityReady ? 'green' : 'red'} variant="quiet">{contractIdentityReady ? '완성' : `${missingContractIdentity.length}개 확인`}</Badge>}
      />
      <DetailRow label="출고가능 차량" value={`${availableVehicleCount.toLocaleString('ko-KR')}대`} />
      <DetailRow label="계약정책" value={`${linkedPolicies.length.toLocaleString('ko-KR')}개 · 발송가능 ${contractReadyPolicyCount.toLocaleString('ko-KR')}개`} />
    </>
  );

  const operationRead = tab === 'user'
    ? null
    : <>
        <DetailRow label="소속 회원" value={`${affiliatedMembers.length.toLocaleString('ko-KR')}명`} />
        <DetailRow label="공급사 수수료율" value={ratePct(form.fee_rate)} />
        <DetailRow label="구글시트 URL" value={strOf(form.sheet_url)} stacked={!!strOf(form.sheet_url)} />
        <DetailRow label="시트 gid" value={strOf(form.sheet_tab)} />
        <DetailRow label="헤더 행" value={strOf(form.header_row)} />
        <DetailRow label="시트 어댑터" value={strOf(form.adapter_id) || (autoplusForm ? '오토플러스식 · 자동' : '일반 · 기본')} />
        <DetailRow label="보증금 계산규칙" value={depositRuleLabel(form.deposit_rule)} />
      </>;

  const paneHint = (text: string) => (
    <div style={{ fontSize: FS.micro, color: C.faint, marginTop: 8 }}>{text}</div>
  );
  const supplierContractTools = tab === 'partner' && selectedPartnerType === '공급사' && selectedPartnerCode ? (
    <div style={{ display: 'grid', gap: 8 }}>
      {!contractIdentityReady ? (
        <Message variant="warning">계약서 회사정보를 먼저 채워주세요: {missingContractIdentity.join(' · ')}</Message>
      ) : null}
      {/* 공급사별 정책 — 여기서 등록·수정·삭제(사장님 2026-08-19: 정책관리는 메뉴가 아니라 파트너사관리 안). 편집 화면(/policy)은 이 공급사 스코프로 열린다. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2 }}>
        {linkedPolicies.map((policy) => {
          const code = String(policy.policy_code || policy._key || '').trim();
          const ready = canIssueContract(policy, form).ok;
          const editingThis = policyEditor?.mode === 'edit' && policyEditor.code === code;
          // 좁은 패널이라 두 줄 — 위: 이름·코드·상태, 아래: 수정·삭제(오른쪽). 한 줄에 다 넣으면 삭제가 잘린다(2026-08-19 실측).
          return (
            <div key={code} style={{ padding: '6px 0', borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: FS.body, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {String(policy.policy_name || code)} <span style={{ color: C.faint, fontSize: FS.micro }}>{code}</span>
                </div>
                <Badge tone={ready ? 'green' : 'amber'} variant="quiet">{ready ? '발송가능' : '입력 부족'}</Badge>
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 2 }}>
                <Btn
                  size="sm"
                  variant={editingThis ? 'solid' : 'ghost'}
                  aria-pressed={editingThis}
                  onClick={() => setPolicyEditor(editingThis ? null : { mode: 'edit', code })}
                >
                  {editingThis ? '닫기' : '수정'}
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => void removePartnerPolicy(policy)}>삭제</Btn>
              </div>
              {editingThis ? (
                <PartnerPolicyEditor
                  providerCode={selectedPartnerCode}
                  providerName={partnerCompanyDisplayName(form) || selectedPartnerCode}
                  policy={policy}
                  onSaved={async () => { await refreshPolicies(); setPolicyEditor(null); }}
                  onCancel={() => setPolicyEditor(null)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Btn
          size="sm"
          variant={policyEditor?.mode === 'new' ? 'ghost' : 'solid'}
          aria-pressed={policyEditor?.mode === 'new'}
          onClick={() => setPolicyEditor(policyEditor?.mode === 'new' ? null : { mode: 'new' })}
        >
          {policyEditor?.mode === 'new' ? '등록 닫기' : '정책 추가'}
        </Btn>
      </div>
      {policyEditor?.mode === 'new' ? (
        <PartnerPolicyEditor
          providerCode={selectedPartnerCode}
          providerName={partnerCompanyDisplayName(form) || selectedPartnerCode}
          policy={null}
          onSaved={async () => { await refreshPolicies(); setPolicyEditor(null); }}
          onCancel={() => setPolicyEditor(null)}
        />
      ) : null}
      {!linkedPolicies.length ? (
        <Message variant="warning">연결된 계약정책이 없습니다. 정책을 추가해야 계약서를 만들 수 있습니다.</Message>
      ) : contractReadyPolicyCount === 0 && partnerContractEnabled ? (
        <Message variant="warning">계약서에 필요한 값이 모두 입력된 정책이 없습니다. 정책을 열어 빈 항목을 확인하세요.</Message>
      ) : null}
    </div>
  ) : null;
  const affiliatedMemberTools = tab === 'partner' && selectedPartnerCode ? (
    <FormCard
      title={`소속 회원 ${affiliatedMembers.length.toLocaleString('ko-KR')}명`}
      hint={partnerReferenceLoadError
        ? `연결 데이터 확인 실패: ${partnerReferenceLoadError} · 삭제와 유형 변경을 잠갔습니다.`
        : `회원 ${selectedPartnerReferences.members} · 정책 ${selectedPartnerReferences.policies} · 차량 ${selectedPartnerReferences.products} · 계약 ${selectedPartnerReferences.contracts} 연결. 회원을 누르면 권한과 소속을 바로 확인할 수 있습니다.`}
    >
      {partnerReferenceLoadError ? (
        <Message variant="warning">연결 현황을 모두 불러오지 못했습니다. 새로고침 후 다시 확인하세요.</Message>
      ) : null}
      {affiliatedMembers.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {affiliatedMembers.slice(0, 12).map((member) => {
            const uid = String(member.uid || member._key || '');
            return (
              <Btn key={uid} size="sm" variant="ghost" onClick={() => { void openAffiliatedMember(member); }}>
                {String(member.name || member.user_code || uid)} · {memberTypeLabel(member.role, member.company_code)}
              </Btn>
            );
          })}
          {affiliatedMembers.length > 12 ? (
            <span style={{ alignSelf: 'center', fontSize: FS.cap, color: C.faint }}>외 {affiliatedMembers.length - 12}명</span>
          ) : null}
        </div>
      ) : (
        <div style={{ fontSize: FS.body, color: C.faint }}>연결된 회원이 없습니다.</div>
      )}
    </FormCard>
  ) : null;

  // 4프레임 = 목록 1 + 업무 패널 3 (HANDOFF·정책/재고와 동일). 필드 그룹만 패널로 나눈다.
  const memberStatusRead = tab === 'user' && sel && !pending ? (
    <FormCard>
      <DetailRow
        label="상태"
        value={<Badge tone={inactive ? 'gray' : 'green'} variant="quiet">{inactive ? '비활성' : '활성'}</Badge>}
      />
    </FormCard>
  ) : null;
  const basicPane = (
    <>
      <PaneHead title="기본정보" />
      <PaneBody pad>
        {sel ? (
          <>
            {modeBanner}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: FS.cap, color: C.faint, marginBottom: 8 }}>
              <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.strong, color: C.mute }}>{strOf(form[idFieldOf(tab)])}</span>
            </div>
            {tab === 'user' ? (
              memberSection(undefined, basicFields, basicHint)
            ) : canEdit ? (
              <div style={{ display: 'grid', gap: 14 }}>
                <FormCard hint={basicHint}>
                  <FormGrid fields={basicFields} form={form} onChange={onChange} cols={2} />
                </FormCard>
                {contractIdentityFields.length ? (
                  <FormCard title="계약서 회사정보" hint="전자계약 사용 전 상호·대표자·사업자번호·대표번호·주소를 모두 확인하세요.">
                    <FormGrid fields={contractIdentityFields} form={form} onChange={onChange} cols={2} />
                  </FormCard>
                ) : null}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                <div>{basicRead}{paneHint(basicHint)}</div>
                {contractIdentityRead}
              </div>
            )}
          </>
        ) : (
          <CenterNote>{tab === 'user' ? '회원을' : '파트너사를'} 선택하거나 신규로 추가하세요.</CenterNote>
        )}
      </PaneBody>
    </>
  );

  const accessPane = (
    <>
      <PaneHead title={accessTitle} />
      <PaneBody pad>
        {sel ? (
          tab === 'user' ? (
            <div style={{ display: 'grid', gap: 14 }}>
              {approveBar}
              {memberStatusRead}
              {memberSection(undefined, accessFields, accessHint, memberSelectOptions)}
            </div>
          ) : (
            <>
              {selectedPartnerType !== '공급사' ? (
                <CenterNote>계약서와 계약정책은 공급사에서만 관리합니다.</CenterNote>
              ) : canEdit ? (
                <FormCard hint={accessHint}>
                  <FormGrid fields={accessFields} form={form} onChange={onChange} cols={2} />
                </FormCard>
              ) : (
                <>{accessRead}{paneHint(accessHint)}</>
              )}
              {supplierContractTools}
            </>
          )
        ) : (
          <CenterNote>목록에서 대상을 선택하면 {tab === 'user' ? '소속·권한' : '계약 사용 여부와 회사별 정책'}을 확인할 수 있습니다.</CenterNote>
        )}
      </PaneBody>
    </>
  );

  const operationPane = (
    <>
      <PaneHead title={operationTitle} />
      <PaneBody pad>
        {sel ? (
          tab === 'user' ? (
            operationFields.length
              ? memberSection(undefined, operationFields, operationHint)
              : <CenterNote>공급사 직원의 영업지급율은 없습니다. 데이터 범위는 소속 공급사로 정해집니다.</CenterNote>
          ) : (
            <>
              {canEdit ? (
                <FormCard hint={operationHint}>
                  <FormGrid
                    fields={operationFields}
                    form={form}
                    onChange={onChange}
                    cols={2}
                    selectOptions={{
                      deposit_rule: [
                        { value: '', label: '미설정 · 시트 보증금만 사용' },
                        { value: 'months_per_year', label: '기간 1년당 월대여료 1개월치' },
                        { value: 'rent_multiple', label: autoplusForm
                          ? '국산 2개월치 · 수입 3개월치 · 오토플러스'
                          : '국산 2개월치 · 수입 3개월치' },
                      ],
                    }}
                  />
                </FormCard>
              ) : (
                <>{operationRead}{paneHint(operationHint)}</>
              )}
              <div style={{ marginTop: 14 }}>{affiliatedMemberTools}</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <Btn title="깨진 컬럼 매핑과 헤더 서명만 초기화" size="sm" variant="ghost" onClick={resetSheetMapping} disabled={saving}>
                  <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>시트 매핑 초기화</ButtonLabel>
                </Btn>
              </div>
            </>
          )
        ) : (
          <CenterNote>목록에서 대상을 선택하면 {tab === 'user' ? '영업설정' : '업무 연동 설정'}을 확인할 수 있습니다.</CenterNote>
        )}
      </PaneBody>
    </>
  );

  // ── 파트너사 4패널(사장님 2026-08-19 「목록 · 기본정보 · 운영정책 · 수수료정책 — 각 패널 규격 맞추기」)
  //   규격: 패널 = PaneHead + PaneBody(pad), 안은 FormCard(제목·힌트) 묶음 · 읽기 = DetailRow, 편집 = 같은 카드 안 FormGrid.
  //   카드 제목·힌트는 두 모드가 같다 — 어디에 무엇이 있는지 모드가 바뀌어도 자리가 안 바뀐다.
  const partnerCard = (
    title: string, hint: string, fields: Field[], read: React.ReactNode,
    extra?: React.ReactNode, selectOptions?: Parameters<typeof FormGrid>[0]['selectOptions'],
  ) => (
    <FormCard title={title} hint={hint}>
      {canEdit && fields.length
        ? <FormGrid fields={fields} form={form} onChange={onChange} cols={2} selectOptions={selectOptions} />
        : read}
      {extra}
    </FormCard>
  );
  const partnerCompanyFields = fieldsIn(['name', 'alias', 'partner_type', 'business_number', 'corporate_registration_no', 'biz_category']);
  const partnerContactFields = fieldsIn(['contact_name', 'contact_phone', 'contact_email', 'contact'])
    .map((field) => (field.key === 'contact' ? { ...field, label: '기타 연락처(메모)' } : field));
  const partnerEsignFields = fieldsIn(['esign_contract_enabled']);
  // 사장님 2026-08-19 「여기는 시트 주소·홈페이지 주소만 — 연동은 우리가」: 탭 gid·헤더 행·어댑터·보증금 규칙은 화면에서 뺀다(원자는 남고 스크립트가 맞춘다).
  const partnerSheetFields = fieldsIn(['sheet_url', 'website']);
  const partnerFeeFields = fieldsIn(['fee_rate']);
  const partnerIsSupplier = selectedPartnerType === '공급사';
  const partnerTypeBadge = (() => {
    const type = partnerTypeLabel(form.partner_type, form.partner_code || form._key);
    return <Badge tone={type === '공급사' ? 'blue' : type === '분류 필요' ? 'red' : 'gray'}>{type}</Badge>;
  })();
  const partnerCode = strOf(form.partner_code || form._key);
  const partnerEmpty = (what: string) => <CenterNote>목록에서 파트너사를 선택하면 {what}을 확인할 수 있습니다.</CenterNote>;
  // 모드 배너(신규/수정 중)는 첫 패널(기본정보)에만 — 세 패널에 같은 문구를 세 번 띄우지 않는다.
  const partnerPaneBody = (children: React.ReactNode, what: string, withBanner = false) => (
    <PaneBody pad>
      {sel ? (
        <div style={{ display: 'grid', gap: 14 }}>
          {withBanner ? modeBanner : null}
          {children}
        </div>
      ) : partnerEmpty(what)}
    </PaneBody>
  );

  // 2 기본정보 — 회사 · 담당자 · 계약서 회사정보(공급사) · 소속 회원
  const partnerBasicPane = (
    <>
      <PaneHead title="기본정보" />
      {partnerPaneBody((
        <>
          {!creating && partnerCode ? (
            <div style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.strong, color: C.mute, fontSize: FS.cap }}>{partnerCode}</div>
          ) : null}
          {partnerCard('회사', '상호·유형·사업자등록번호 — 목록·계약서·정산의 신원 기준입니다.', partnerCompanyFields, (
            <>
              <DetailRow label="상호/이름" value={strOf(form.name)} />
              <DetailRow label="별칭" value={strOf(form.alias)} />
              <DetailRow label="유형" value={partnerTypeBadge} />
              <DetailRow label="사업자등록번호" value={businessRegistrationNumberOf(form, 'partner')} />
              <DetailRow label="법인등록번호" value={strOf(form.corporate_registration_no)} />
              <DetailRow label="업태 · 종목" value={strOf(form.biz_category)} />
            </>
          ))}
          {partnerCard('담당자', '프리패스가 연락할 사람 — 제공시트 「회사정보」 탭과 같은 항목입니다.', partnerContactFields, (
            <>
              <DetailRow label="담당자" value={strOf(form.contact_name)} />
              <DetailRow label="담당자 연락처" value={strOf(form.contact_phone)} />
              <DetailRow label="담당자 이메일" value={strOf(form.contact_email)} />
              <DetailRow label="기타 연락처(메모)" value={strOf(form.contact)} />
            </>
          ))}
          {partnerIsSupplier ? partnerCard('계약서 회사정보', '계약서 임대인 칸과 대여료 입금 안내에 그대로 실립니다 — 전자계약 전 모두 채우세요.', contractIdentityFields, (
            <>
              <DetailRow label="대표자" value={strOf(form.ceo)} />
              <DetailRow label="대표번호" value={strOf(form.phone)} />
              <DetailRow label="사업장 주소" value={strOf(form.address)} stacked={!!strOf(form.address)} />
              <DetailRow label="대여사업 등록번호" value={strOf(form.rental_business_no)} />
              <DetailRow label="입금계좌" value={[strOf(form.bank_name), strOf(form.bank_account), strOf(form.bank_holder)].filter(Boolean).join(' · ')} stacked />
            </>
          )) : null}
          {affiliatedMemberTools}
        </>
      ), '회사 정보', true)}
    </>
  );

  // 3 운영정책 — 전자계약 · 계약정책(등록·수정·삭제) · 재고 시트 연결. 공급사만.
  const partnerPolicyPane = (
    <>
      <PaneHead title="운영정책" />
      {partnerPaneBody(partnerIsSupplier ? (
        <>
          {partnerCard('전자계약', '프리패스 전자계약을 사용하는 공급사만 계약작성 회사 선택에 나옵니다.', partnerEsignFields, (
            <>
              <DetailRow
                label="프리패스 전자계약"
                value={<Badge tone={partnerContractEnabled ? 'green' : 'gray'} variant="quiet">{partnerContractEnabled ? '사용' : '미사용'}</Badge>}
              />
              <DetailRow
                label="계약서 회사정보"
                value={<Badge tone={contractIdentityReady ? 'green' : 'red'} variant="quiet">{contractIdentityReady ? '완성' : `${missingContractIdentity.length}개 확인`}</Badge>}
              />
              <DetailRow label="출고가능 차량" value={`${availableVehicleCount.toLocaleString('ko-KR')}대`} />
            </>
          ))}
          <FormCard
            title={`계약정책 ${linkedPolicies.length.toLocaleString('ko-KR')}개 · 발송가능 ${contractReadyPolicyCount.toLocaleString('ko-KR')}개`}
            hint="이 공급사의 정책을 여기서 등록·수정·삭제합니다. 시트 「운영정책」 탭 값이 들어오는 자리이고, 계약서는 이 값을 읽습니다."
          >
            {creating ? <Message variant="info">파트너사를 먼저 저장하면 정책을 등록할 수 있습니다.</Message> : supplierContractTools}
          </FormCard>
          {partnerCard('시트 · 홈페이지', '공급사 재고 시트 주소와 홈페이지 주소만 적습니다. 연동(탭·헤더·어댑터)은 프리패스가 맞춥니다.', partnerSheetFields, (
            <>
              <DetailRow label="구글시트 URL" value={strOf(form.sheet_url)} stacked={!!strOf(form.sheet_url)} />
              <DetailRow label="홈페이지 주소" value={strOf(form.website)} stacked={!!strOf(form.website)} />
            </>
          ))}
        </>
      ) : (
        <CenterNote>운영정책(전자계약 · 계약정책 · 재고 시트)은 공급사에서만 관리합니다.</CenterNote>
      ), '운영정책')}
    </>
  );

  // 4 수수료정책 — 공급사 수수료율(정산 R1) / 영업채널은 회원별 지급율(R2)
  // 영업채널 지급율 — 값을 따로 정한 사람만 줄로, 나머지는 「미설정 N명 · 기본 4%」 한 줄(개인 영업자는 100명이 넘는다).
  const channelPayoutRows = affiliatedMembers
    .filter((member) => memberRoleGroup(member.role) === 'sales')
    .map((member) => ({ key: String(member.uid || member._key || member.user_code || ''), name: String(member.name || member.user_code || member.uid || ''), rate: ratePct(member.agent_payout_rate) }));
  const channelPayoutSet = channelPayoutRows.filter((row) => row.rate);
  const channelPayoutUnset = channelPayoutRows.length - channelPayoutSet.length;
  const partnerFeePane = (
    <>
      <PaneHead title="수수료정책" />
      {partnerPaneBody(partnerIsSupplier ? (
        partnerCard('공급사 수수료율', '정산 R1(공급사→프리패스) = 월대여료 × 수수료율. 계약 생성 때 동결되며, 미설정이면 기본 10%로 잡힙니다(목록 「수수료 기본」 표시).', partnerFeeFields, (
          <>
            <DetailRow label="공급사 수수료율" value={ratePct(form.fee_rate) || <Badge tone="amber" variant="quiet">미설정 · 기본 10%</Badge>} />
            <DetailRow label="정산 기준" value="월대여료 × 수수료율 · 계약 생성 때 동결" stacked />
          </>
        ))
      ) : (
        <FormCard title="영업 지급율" hint="영업채널의 지급율(정산 R2)은 회원별로 정합니다 — 회원관리 › 영업설정. 여기서는 소속 영업자의 현재 값만 보입니다.">
          {channelPayoutRows.length ? (
            <>
              {channelPayoutSet.slice(0, 30).map((row) => <DetailRow key={row.key} label={row.name} value={row.rate} />)}
              {channelPayoutSet.length > 30 ? <DetailRow label="…" value={`외 ${channelPayoutSet.length - 30}명 설정됨`} /> : null}
              {channelPayoutUnset ? <DetailRow label={channelPayoutSet.length ? '그 밖의 영업자' : '소속 영업자'} value={<Badge tone="amber" variant="quiet">{channelPayoutUnset}명 미설정 · 기본 4%</Badge>} /> : null}
            </>
          ) : <div style={{ fontSize: FS.body, color: C.faint }}>소속 영업자가 없습니다.</div>}
        </FormCard>
      ), '수수료정책')}
    </>
  );

  const panes: WorkPane[] = tab === 'partner'
    ? [
      { key: 'basic', title: '기본정보', node: partnerBasicPane },
      { key: 'policy', title: '운영정책', node: partnerPolicyPane },
      { key: 'fee', title: '수수료정책', node: partnerFeePane },
    ]
    : [
      { key: 'basic', title: '기본정보', node: basicPane },
      { key: 'access', title: accessTitle, node: accessPane },
      { key: 'operation', title: operationTitle, node: operationPane },
    ];

  const fltCount = tab === 'user'
    ? (roleFlt !== 'all' ? 1 : 0) + (activeFlt !== 'all' ? 1 : 0)
    : (ptypeFlt !== 'all' ? 1 : 0);

  return (
    <>
      <WorkPage title={tab === 'partner' ? NAV_LABEL.partners : NAV_LABEL.members} listCount={shown.length} list={listEl} panes={panes} selected={!!sel} onBack={clearSel}
        contextTitle={sel ? (creating ? (tab === 'user' ? '가입회원 연결' : '신규 파트너사') : String(form.name || form.partner_code || form.user_code || '')) : undefined}
        actions={editActions}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '이름·코드·회사·연락처·역할…' },
          sort: { value: sort, onChange: (v) => setSort(v as MemSort | ''), options: MEM_SORTS, defaultValue: 'name' },
          filter: {
            count: fltCount,
            title: '조건 검색',
            onClear: () => { setRoleFlt('all'); setActiveFlt('all'); setPtypeFlt('all'); },
            body: (
              <>
                <FilterGroup title="목록" count={0} defaultOpen first={!mobile}>
                  <FilterChips
                    value={tab}
                    onChange={(next) => { void switchTab(next as Tab); }}
                    options={MEM_TABS}
                  />
                </FilterGroup>
                {tab === 'user' ? (
                  <>
                    <FilterGroup
                      title="역할"
                      count={roleFlt === 'all' ? 0 : 1}
                      defaultOpen
                      onClear={() => setRoleFlt('all')}
                    >
                      <FilterChips value={roleFlt} onChange={(value) => setRoleFlt(value as 'all' | 'sales' | 'provider')} options={MEM_ROLES} />
                    </FilterGroup>
                    <FilterGroup
                      title="상태"
                      count={activeFlt === 'all' ? 0 : 1}
                      defaultOpen
                      onClear={() => setActiveFlt('all')}
                    >
                      <FilterChips value={activeFlt} onChange={setActiveFlt} options={activeOptions} />
                    </FilterGroup>
                  </>
                ) : (
                  <FilterGroup
                    title="유형"
                    count={ptypeFlt === 'all' ? 0 : 1}
                    defaultOpen
                    onClear={() => setPtypeFlt('all')}
                  >
                    <FilterChips value={ptypeFlt} onChange={setPtypeFlt} options={MEM_PARTNER_TYPES} />
                  </FilterGroup>
                )}
              </>
            ),
          },
          hints: [
            tab === 'user' ? '회원' : '파트너사',
            ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
            ...(sort && sort !== 'name' ? [MEM_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...(roleFlt !== 'all' ? [memberTypeLabel(roleFlt === 'sales' ? 'agent' : 'provider')] : []),
            ...(activeFlt !== 'all' ? [activeFlt] : []),
            ...(ptypeFlt !== 'all' ? [ptypeFlt] : []),
          ],
          onClearHints: () => { setQ(''); setSort('name'); setRoleFlt('all'); setActiveFlt('all'); setPtypeFlt('all'); },
        }}
      />
    </>
  );
}
