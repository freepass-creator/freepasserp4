'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, rangeErrors, type EntityRecord } from '@/lib/intake/entities';
import { newId } from '@/lib/domain/ids';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import {
  PaneHead, PaneBody, Btn, ButtonLabel, FormGrid, FormReadList, FormCard, C, Loading, CenterNote, Page,
  FilterChips, FilterGroup, Message, PageActions, FeedRowSkeleton, PillTabs, DetailRow, ListGroup, Badge,
  NUM, FS, FW, ICON,
} from '@/components/ui';
import { PolicyCreateRow, PolicyListRow } from '@/components/list-rows';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { confirmDialog, toast } from '@/components/Toaster';
import { matchPolicyQuery } from '@/lib/domain/search';
import { haptic } from '@/lib/haptics';
import { useIsMobile } from '@/lib/use-mobile';
import { NAV_LABEL } from '@/lib/tabbar';
import { canIssueContract, CONTRACT_LAYER, type PolicyField } from '@/lib/domain/policy-tier';
import { FREEPASS_POLICY_PACK, POLICY_DEFAULTS, applyPolicyDefaults } from '@/lib/domain/policy-defaults';
import { retainVisibleSelection } from '@/features/work-list-display';
import { providerNameMap } from '@/lib/domain/identity';
import { partnerTypeLabel } from '@/lib/domain/partner';
import { businessRegistrationNumberOf, normalizeBusinessRegistrationNumber } from '@/lib/domain/business-identity';
import { parseDepositRule } from '@/lib/domain/sheet-import';
import { isAutoplusPartner } from '@/lib/domain/sheet-autoplus';
import { readAllPartnersPrivate, writePartnerPrivate } from '@/lib/domain/private-fields';
import { RotateCcw } from 'lucide-react';
import {
  ESIGN_POLICY_SELECTION_SESSION_KEY,
  type EsignPolicySelection,
} from '@/lib/domain/esign-policy-return';

type PolSort = 'name' | 'code' | 'type';
type PolScope = 'all' | 'mine' | 'shared';
type PolicySection = 'basic' | 'terms' | 'ins' | 'esign';
const POL_SORTS: { value: PolSort; label: string }[] = [
  { value: 'name', label: '이름순' },
  { value: 'code', label: '코드순' },
  { value: 'type', label: '유형순' },
];
const POL_SCOPE: { key: PolScope; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'mine', label: '전용' },
  { key: 'shared', label: '공용' },
];

// 정책관리 = [목록 | 기본정보 | 운영정책 | 수수료정책]. 메뉴 표기는 파트너사 관리.
// 기본·수수료 = 연결된 파트너사 레코드. 운영정책 = 상품시트 + 기존 정책 4단(심사·계약조건·보험·전자계약).
// 공급사 = 자기 정책만 편집. 공용(provider_company_code 빈값)은 목록에 안 띄움(재고 Select에서만 연결).
// 필드 그룹 SSOT — detailSections(심사/계약조건/보험)과 동일 골격. 미지정 필드는 보험 패널이 흡수(누락 방지).
const G_BASIC = ['policy_code', 'policy_name', 'provider_company_code', 'policy_type', 'screening_criteria', 'credit_grade', 'basic_driver_age', 'driver_age_lowering', 'driver_age_upper_limit', 'license_period', 'age_lowering_cost'];
const G_TERMS = ['annual_mileage', 'mileage_upcharge_per_10000km', 'payment_method', 'payment_timing', 'payment_due_date', 'rental_region', 'delivery_fee', 'deposit_installment', 'deposit_card_payment', 'insurance_included', 'personal_driver_scope', 'business_driver_scope', 'additional_driver_allowance_count', 'additional_driver_cost', 'maintenance_service', 'commission_clawback_condition'];
/**
 * 전자계약 패널 — **계약서를 우리가 쓰는 공급사만** 채운다.
 *
 * 목록을 여기 손으로 적지 않고 `CONTRACT_LAYER` 에서 뽑는다.
 * 두 벌로 두면 어긋난다 — 실제로 「초과 주행요금」이 계약 층에 정의돼 있는데
 * 화면에서는 계약조건 패널에 있었다(패널티인데 가격표 옆에 서 있었다).
 * 근거: `docs/POLICY-LAYERS.md` · SSOT: `lib/domain/policy-tier.ts`
 */
const G_ESIGN = ['contract_authoring', ...CONTRACT_LAYER.map((f) => f.key).filter((key) => !['insurer_name', 'payment_due_date'].includes(key))];

function scopePolicies(all: EntityRecord[], role: Role): EntityRecord[] {
  if (role === 'admin') return all;
  if (role === 'provider') {
    const me = actor('provider').code;
    // 자기 전용만 관리. 공용 템플릿은 재고 연결용(편집은 admin).
    return all.filter((p) => String(p.provider_company_code || '') === me);
  }
  return [];
}

const strOf = (value: unknown) => String(value ?? '');
const ratePct = (value: unknown) => {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return '';
  return `${Math.round(n * 100)}%`;
};
const depositRuleLabel = (value: unknown) => {
  const rule = String(value ?? '');
  if (rule === 'months_per_year') return '기간 1년당 월대여료 1개월치';
  if (rule === 'rent_multiple') return '국산 2개월치 · 수입 3개월치';
  return '미설정 · 시트 보증금만 사용';
};
function partnerOf(code: unknown, list: EntityRecord[]) {
  const key = String(code || '').trim();
  if (!key) return null;
  return list.find((row) => String(row.partner_code || row._key || '') === key) || null;
}

async function enrichPartners(list: EntityRecord[]): Promise<EntityRecord[]> {
  try {
    const priv = await readAllPartnersPrivate();
    if (!priv || !Object.keys(priv).length) return list;
    return list.map((row) => {
      const extra = priv[String(row.partner_code || row._key || '')];
      return extra ? { ...row, ...extra } : row;
    });
  } catch {
    return list;
  }
}

export default function PolicyMgmt() {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [launchKey, setLaunchKey] = useState<string | null>(null);
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [partners, setPartners] = useState<EntityRecord[]>([]);
  const [partnerForm, setPartnerForm] = useState<EntityRecord>({});
  const [providerAliases, setProviderAliases] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState('');
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
    section: PolicySection | '';
    edit: boolean;
    returnToEsign: boolean;
  } | null>(null);

  const load = async (r?: Role) => {
    const role = r || getRole();
    const [all, partnerRows] = await Promise.all([
      getStore().list('policy', co),
      getStore().list('partner', co).catch(() => [] as EntityRecord[]),
    ]);
    const enriched = await enrichPartners(partnerRows);
    // 표시명은 별도 맵으로 보강한다. 행 데이터에 합치면 편집 저장 시 provider_name이
    // 정책 레코드에 의도치 않게 영속화되므로, 원본 policy는 건드리지 않는다.
    setPartners(enriched);
    setProviderAliases(providerNameMap(enriched));
    const mine = scopePolicies(all, role);
    setRows(mine);
    return { mine, partners: enriched };
  };
  const bindPartner = (policy: EntityRecord, list: EntityRecord[]) => {
    const row = partnerOf(policy.provider_company_code, list);
    setPartnerForm(row ? { ...row } : {});
  };
  const selectP = (p: EntityRecord, partnerList = partners) => {
    setSel(String(p.policy_code));
    // 비어 있는 칸도 화면·계약에서 같은 답을 내도록 프리패스 표준을 유효값으로 보여 준다.
    // 공급사가 직접 정한 값은 applyPolicyDefaults가 절대 덮지 않는다.
    setForm(applyPolicyDefaults(p).next as EntityRecord);
    bindPartner(p, partnerList);
    setDirty(false);
    setCreating(false);
    setEditing(false);
    setSection('basic');
  };
  const clearSel = () => {
    setSel(null);
    setForm({});
    setPartnerForm({});
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
    bindPartner(base, partners);
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
      section: String(params.get('section') || '') as PolicySection | '',
      edit: params.get('edit') === '1',
      returnToEsign: params.get('return') === 'esign',
    });
  }, [launchKey]);

  useEffect(() => {
    (async () => {
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

  // 메뉴에서 파트너사 관리 재진입 → 목록
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
    if (k === 'provider_company_code') bindPartner({ provider_company_code: v }, partners);
  };
  const onPartnerChange = (k: string, v: string) => {
    if (getRole() === 'provider') {
      const me = actor('provider').code;
      if (!me || String(partnerForm.partner_code || partnerForm._key || '') !== me) return;
    }
    if (getRole() !== 'admin' && k === 'fee_rate') return;
    setPartnerForm((f) => ({ ...f, [k]: v }));
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
    const partnerCode = String(partnerForm.partner_code || partnerForm._key || '').trim();
    if (partnerCode) {
      if (role === 'provider' && actor('provider').code !== partnerCode) {
        toast('다른 파트너사 정보는 수정할 수 없습니다', 'error');
        return;
      }
      const badRange = rangeErrors(ENTITIES.partner.fields, partnerForm);
      if (badRange.length) { toast(badRange[0], 'error'); return; }
    }
    try {
      await getStore().save('policy', co, [patch]);
      await getStore().update('policy', co, String(patch.policy_code), patch);
    } catch (e) {
      toast(`저장 실패: ${String((e as Error)?.message || e)}`, 'error');
      return;
    }
    if (partnerCode) {
      let mainPartner: EntityRecord = {
        ...partnerForm,
        deposit_rule: parseDepositRule(partnerForm.deposit_rule) || null,
      };
      const biz = normalizeBusinessRegistrationNumber(partnerForm.business_number);
      if (biz) mainPartner = { ...mainPartner, business_number: biz };
      if (role === 'admin') {
        const moved = await writePartnerPrivate(partnerCode, { fee_rate: mainPartner.fee_rate });
        if (moved) mainPartner = { ...mainPartner, fee_rate: null };
      }
      try {
        await getStore().save('partner', co, [mainPartner]);
        await getStore().update('partner', co, partnerCode, mainPartner);
      } catch (e) {
        toast(`파트너사 저장 실패: ${String((e as Error)?.message || e)}`, 'error');
        return;
      }
    }
    const loaded = await load(role);
    setDirty(false);
    setCreating(false);
    setEditing(false);
    setSel(String(patch.policy_code));
    setForm(patch);
    bindPartner(patch, loaded.partners);
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
      await getStore().remove('policy', co, String(form.policy_code), `${NAV_LABEL.policy} 삭제`);
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
    if (row) {
      setForm(applyPolicyDefaults(row).next as EntityRecord);
      bindPartner(row, partners);
      setDirty(false);
      setEditing(false);
    }
    else clearSel();
  };
  const startEdit = () => { setEditing(true); haptic.tap(); };

  const resetSheetMapping = async () => {
    const code = String(partnerForm.partner_code || partnerForm._key || '').trim();
    if (!code || !sel) return;
    if (getRole() === 'provider' && actor('provider').code !== code) return;
    if (!await confirmDialog({
      title: '시트 컬럼 매핑 초기화',
      message: `${String(partnerForm.name || code)}의 저장된 컬럼 매핑과 헤더 서명을 지울까요?\n구글시트 원본은 변경되지 않으며, 다음 불러오기에서 헤더를 다시 판독합니다.`,
      danger: true,
      okLabel: '매핑 초기화',
    })) return;
    try {
      await getStore().update('partner', co, code, {
        mapping_profile: null,
        mapping_header_signature: null,
      });
      const loaded = await load();
      const row = partnerOf(code, loaded.partners);
      if (row) setPartnerForm({ ...row });
      toast('시트 매핑을 초기화했습니다. 재고 화면에서 데이터 검증을 다시 실행하세요.', 'ok');
    } catch (error) {
      toast(`매핑 초기화 실패: ${String((error as Error).message || error)}`, 'error');
    }
  };

  const shown = useMemo(() => (rows || [])
    .filter((p) => matchPolicyQuery({
      ...p,
      provider_name: providerAliases[String(p.provider_company_code || '').trim()] || p.provider_name,
    }, q))
    .filter((p) => {
      if (scope === 'all') return true;
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
    }), [rows, q, scope, sort, providerAliases]);

  const policySelectOptions = useMemo(() => ({
    provider_company_code: Object.entries(providerAliases)
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko')),
  }), [providerAliases]);

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
        <CenterNote>공급사·관리자만 파트너사를 관리할 수 있습니다</CenterNote>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <Btn title="홈으로" href="/" size="sm">홈으로</Btn>
        </div>
      </Page>
    );
  }
  if (ok !== true) return <Loading />;

  // 등록 진입점은 목록 맨 위 행 하나로(재고·회원과 동일). 헤더 우측 버튼과 두 갈래로 두지 않는다.
  const listEl = (
    <>
      <PolicyCreateRow onClick={() => newP()} />
      {shown.length === 0
        ? <CenterNote>{q || scope !== 'all' ? '검색 결과 없음.' : '등록된 정책이 없습니다. 공용 정책은 재고에서 연결합니다.'}</CenterNote>
        : <div>{shown.map((p) => {
            const on = String(p.policy_code) === sel;
            return (
              <PolicyListRow
                key={String(p.policy_code)}
                selected={on}
                onClick={() => selectP(p)}
                p={p}
                providerName={providerAliases[String(p.provider_company_code || '').trim()]}
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

  const esignGate = canIssueContract(form);
  const esignHint = esignGate.layer !== 'contract'
    ? '상품만 공급하는 정책입니다 — 계약서는 공급사가 직접 작성합니다. 우리가 계약서까지 쓰려면 「정책 단계」를 «계약»으로 두고 아래를 채우세요.'
    : esignGate.ok
      ? '전자계약 발송 가능 — 아래 값이 계약서와 약관에 그대로 실립니다.'
      : `전자계약 발송 불가 — ${esignGate.missing.length}개 항목이 비어 있습니다: ${esignGate.missing.map((m: PolicyField) => m.label).join(' · ')}`;

  const canEdit = creating || editing;
  const admin = getRole() === 'admin';
  const partnerCode = String(partnerForm.partner_code || partnerForm._key || '');
  const autoplusForm = !!partnerCode && isAutoplusPartner(partnerForm);
  const partnerFieldsIn = (keys: string[]) => ENTITIES.partner.fields.filter((field) => keys.includes(field.key));
  const partnerGrid = (
    keys: string[],
    cols: number,
    extra?: { showNotes?: boolean; selectOptions?: Record<string, { value: string; label: string }[]> },
  ) => (
    <FormGrid
      fields={partnerFieldsIn(keys)}
      form={partnerForm}
      onChange={onPartnerChange}
      cols={cols}
      disabled={!canEdit}
      showNotes={extra?.showNotes}
      selectOptions={extra?.selectOptions}
    />
  );
  const partnerDepositSelect = {
    deposit_rule: [
      { value: '', label: '미설정 · 시트 보증금만 사용' },
      { value: 'months_per_year', label: '기간 1년당 월대여료 1개월치' },
      { value: 'rent_multiple', label: autoplusForm
        ? '국산 2개월치 · 수입 3개월치 · 오토플러스'
        : '국산 2개월치 · 수입 3개월치' },
    ],
  };
  const partnerTypeTone = (() => {
    const type = partnerTypeLabel(partnerForm.partner_type, partnerForm.partner_code || partnerForm._key);
    return <Badge tone={type === '공급사' ? 'blue' : type === '분류 필요' ? 'red' : 'gray'}>{type}</Badge>;
  })();
  const policyDefaultState = applyPolicyDefaults(form);
  // 공급사가 확인할 빈칸을 채워도 프리패스가 제공한 확정 기본값 개수는 달라지지 않는다.
  const decidedDefaultCount = POLICY_DEFAULTS.filter((item) => item.value !== null).length;
  const pendingDefaultLabels = policyDefaultState.pending.map((item) => item.label);
  const modeBanner = creating ? (
    <Message variant="info">
      프리패스 기본정책 {decidedDefaultCount}개 자동 입력 · {FREEPASS_POLICY_PACK}
    </Message>
  ) : editing ? (
    <Message variant="warning">수정 중 · 저장해야 반영됩니다</Message>
  ) : null;
  // 하단바 = 편집 컨텍스트만(수정·삭제 / 취소·저장). 등록은 상단 툴바(listTools.action).
  const dockActions = creating || editing ? (
    <PageActions cancel={{ onClick: cancelEdit }} save={{ onClick: save, disabled: !dirty }} />
  ) : sel ? (
    <PageActions edit={{ onClick: startEdit }} remove={{ onClick: removeP }} />
  ) : undefined;

  const editPane = (title: string, fields: typeof ENTITIES.policy.fields, hint?: string, lead?: string) => (
    <PaneBody pad>
        {sel ? (
          <>
            {modeBanner}
            {launchRequest?.returnToEsign ? (
              <Message variant="info">저장하거나 취소하면 작성 중인 전자계약으로 돌아갑니다.</Message>
            ) : null}
            {canEdit && pendingDefaultLabels.length > 0 ? (
              <Message variant="warning">
                공급사 확인 필요 {pendingDefaultLabels.length}개 · {pendingDefaultLabels.slice(0, 4).join(' · ')}
                {pendingDefaultLabels.length > 4 ? ` 외 ${pendingDefaultLabels.length - 4}개` : ''}
                {' '}— 계약회사별 실제 보험증권·탁송 조건을 확인해 입력하세요.
              </Message>
            ) : null}
            {/*
              «이 패널이 무엇이고 누가 쓰는가»를 먼저 말한다.
              정책은 한 번 정해 두고 계속 쓰는 값이라 이 화면에 자주 오지 않는다.
              다음에 왔을 때 「여기가 뭐였더라」가 되면 아예 안 채우고, 안 채운 칸은
              계약서에서 빈칸이 되어 약관 조문이 공중에 뜬다.
            */}
            {lead && (
              <p style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: 1.6, color: C.mute }}>{lead}</p>
            )}
            {/*
              표준값 채우기는 «전자계약 패널에서만». 빈칸을 하나씩 채우는 것은 오래 걸리고,
              그러다 안 채운 칸이 남으면 계약서가 빈칸으로 나간다.
              값은 지금 나가는 계약서에서 뽑은 것이라 «새로 정하는 것»이 아니다.
            */}
            {title === '전자계약' && canEdit && (
              <div style={{ marginBottom: 10 }}>
                <Btn title="프리패스 표준값 채우기" size="sm" variant="ghost" onClick={fillDefaults}>
                  프리패스 표준값 채우기
                </Btn>
              </div>
            )}
            {mobile && !canEdit ? (
              <FormReadList fields={fields} form={form} selectOptions={policySelectOptions} footer={hint} />
            ) : (
              <FormCard hint={hint}>
                {/*
                  정책은 «한 번 정해 두고 계속 쓰는» 값이라 자주 오지 않는다.
                  그래서 칸마다 «무슨 뜻이고 어느 약관 조항에 걸리는지»를 그 자리에서 읽게 한다.
                  (재고·계약처럼 매일 만지는 화면은 조밀해야 하므로 거기선 끈다.)
                */}
                <FormGrid fields={fields} form={form} onChange={onChange} cols={2} disabled={!canEdit} showNotes selectOptions={policySelectOptions} />
              </FormCard>
            )}
          </>
        ) : (
          <CenterNote>목록에서 파트너사를 선택하세요.</CenterNote>
        )}
      </PaneBody>
  );
  /*
   * 패널 안내 — 세 층(상품·영업·계약)을 화면 말로 옮긴 것.
   * 설계 근거: `docs/POLICY-LAYERS.md`
   */
  const sectionPanes: WorkPane[] = [
    {
      key: 'basic',
      title: '기본·심사',
      node: editPane('기본·심사', fieldsIn(G_BASIC), '정책 신원·심사 기준',
        '심사기준·신용등급은 내부용 — 손님에게 안 나갑니다.'),
    },
    {
      key: 'terms',
      title: '계약조건',
      node: editPane('계약조건', fieldsIn(G_TERMS), '운행·납부·특약',
        '영업 상담용 가격표. 여기서 정해진 결과만 계약서에 실립니다.'),
    },
    {
      key: 'ins',
      title: '보험',
      node: editPane('보험', insFields, '보험·부가 조건',
        '계약서 보험 항목 · 약관 제11조에 그대로 실립니다.'),
    },
    {
      key: 'esign',
      title: '전자계약',
      node: editPane('전자계약', fieldsIn(G_ESIGN), esignHint,
        '계약서를 우리가 쓰는 공급사만 채웁니다. 비면 약관 조문이 못 걸립니다.'),
    },
  ];
  const activeSection = sectionPanes.find((pane) => pane.key === section) || sectionPanes[0];
  const basicInfoPane = (
    <>
      <PaneHead title="기본정보" />
      <PaneBody pad>
        {sel ? (
          partnerCode ? (
            <>
              {modeBanner}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: FS.cap, color: C.faint }}>
                <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.strong, color: C.mute }}>{partnerCode}</span>
              </div>
              {canEdit ? (
                <FormCard hint="전자계약 임대인 표시 · 가입 시 소속 매칭">
                  {partnerGrid(['name', 'alias'], 2)}
                  <div style={{ marginTop: 10 }}>{partnerGrid(['partner_type', 'business_number', 'rental_business_no', 'phone'], 2)}</div>
                  <div style={{ marginTop: 10 }}>{partnerGrid(['address'], 1)}</div>
                  <div style={{ marginTop: 10 }}>{partnerGrid(['ceo', 'contact'], 2)}</div>
                </FormCard>
              ) : (
                <ListGroup footer="전자계약 임대인 표시 · 가입 시 소속 매칭">
                  <DetailRow label="상호/이름" value={strOf(partnerForm.name)} />
                  <DetailRow label="별칭" value={strOf(partnerForm.alias)} />
                  <DetailRow label="유형" value={partnerTypeTone} />
                  <DetailRow label="사업자번호" value={businessRegistrationNumberOf(partnerForm, 'partner')} />
                  <DetailRow label="자동차대여사업 등록번호" value={strOf(partnerForm.rental_business_no)} />
                  <DetailRow label="대표번호" value={strOf(partnerForm.phone)} />
                  <DetailRow label="사업장 주소" value={strOf(partnerForm.address)} stacked={!!strOf(partnerForm.address)} />
                  <DetailRow label="대표자" value={strOf(partnerForm.ceo)} />
                  <DetailRow label="실무자" value={strOf(partnerForm.contact)} />
                </ListGroup>
              )}
            </>
          ) : (
            <CenterNote>연결된 파트너사가 없습니다. 운영정책에서 계약회사를 지정하세요.</CenterNote>
          )
        ) : (
          <CenterNote>목록에서 파트너사를 선택하세요.</CenterNote>
        )}
      </PaneBody>
    </>
  );
  const operationPane = (
    <>
      <PaneHead title="운영정책" />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {sel && partnerCode ? (
          <div style={{
            padding: 12,
            borderBottom: `1px solid ${C.line}`,
            flex: '0 0 auto',
          }}>
            {canEdit ? (
              <FormCard hint={autoplusForm
                ? '오토플러스 시트는 보증금 열이 없으므로 「국산 2개월치 · 수입 3개월치」 규칙이 필수입니다.'
                : '상품시트 주소와 gid·헤더·어댑터·보증금 규칙은 재고 가져오기 때 적용됩니다.'}
              >
                {partnerGrid(['sheet_url'], 1, { showNotes: true })}
                <div style={{ marginTop: 10 }}>
                  {partnerGrid(['deposit_rule', 'adapter_id', 'sheet_tab', 'header_row'], 2, { showNotes: true, selectOptions: partnerDepositSelect })}
                </div>
              </FormCard>
            ) : (
              <>
                <DetailRow label="구글시트 URL" value={strOf(partnerForm.sheet_url)} stacked={!!strOf(partnerForm.sheet_url)} />
                <DetailRow label="시트 gid" value={strOf(partnerForm.sheet_tab)} />
                <DetailRow label="헤더 행" value={strOf(partnerForm.header_row)} />
                <DetailRow label="시트 어댑터" value={strOf(partnerForm.adapter_id) || (autoplusForm ? '오토플러스식 · 자동' : '일반 · 기본')} />
                <DetailRow label="보증금 계산규칙" value={depositRuleLabel(partnerForm.deposit_rule)} />
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <Btn title="깨진 컬럼 매핑과 헤더 서명만 초기화" size="sm" variant="ghost" onClick={resetSheetMapping}>
                <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>시트 매핑 초기화</ButtonLabel>
              </Btn>
            </div>
          </div>
        ) : null}
        <div className="fp-policy-tabs">
          <PillTabs
            size="sm"
            value={section}
            onChange={setSection}
            tabs={sectionPanes.map((pane) => ({ key: pane.key as PolicySection, label: pane.title }))}
          />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeSection.node}
        </div>
      </div>
    </>
  );
  const feePane = (
    <>
      <PaneHead title="수수료정책" />
      <PaneBody pad>
        {sel ? (
          partnerCode ? (
            canEdit ? (
              <FormCard hint="공급사 수수료율(0~1)은 정산 R1 기준입니다. 계좌는 전자계약 대여료 입금용입니다.">
                {admin ? partnerGrid(['fee_rate'], 1, { showNotes: true }) : (
                  <DetailRow label="공급사 수수료율" value={ratePct(partnerForm.fee_rate)} />
                )}
                <div style={{ marginTop: 10 }}>{partnerGrid(['bank_name', 'bank_holder'], 2)}</div>
                <div style={{ marginTop: 10 }}>{partnerGrid(['bank_account'], 1)}</div>
              </FormCard>
            ) : (
              <>
                <DetailRow label="공급사 수수료율" value={ratePct(partnerForm.fee_rate)} />
                <DetailRow label="입금은행" value={strOf(partnerForm.bank_name)} />
                <DetailRow label="예금주" value={strOf(partnerForm.bank_holder)} />
                <DetailRow label="입금계좌번호" value={strOf(partnerForm.bank_account)} stacked={!!strOf(partnerForm.bank_account)} />
              </>
            )
          ) : (
            <CenterNote>연결된 파트너사가 없습니다.</CenterNote>
          )
        ) : (
          <CenterNote>목록에서 파트너사를 선택하세요.</CenterNote>
        )}
      </PaneBody>
    </>
  );
  const panes: WorkPane[] = [
    { key: 'company', title: '기본', node: basicInfoPane },
    { key: 'operation', title: '운영', node: operationPane },
    { key: 'fee', title: '수수료', node: feePane },
  ];
  return (
    <>
      <WorkPage title={NAV_LABEL.policy}
        statusCount={rows === null ? null : rows.length}
        listCount={rows === null ? null : shown.length} list={rows === null ? <FeedRowSkeleton /> : listEl} panes={panes} selected={!!sel} onBack={clearSel}
        paneRatio={1}
        contextTitle={sel ? (creating ? '신규' : String(partnerForm.name || form.policy_name || form.policy_code || '')) : undefined}
        actions={dockActions}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '정책명·코드·심사·지역…' },
          // 등록은 목록 맨 위 PolicyCreateRow 하나로 — 헤더 우측 버튼과 두 갈래로 두지 않는다.
          sort: { value: sort, onChange: (v) => setSort(v as PolSort | ''), options: POL_SORTS, defaultValue: 'name' },
          filter: {
            count: scope === 'all' ? 0 : 1,
            title: '조건 검색',
            onClear: () => setScope('all'),
            body: (
              <FilterGroup
                title="귀속"
                count={scope === 'all' ? 0 : 1}
                defaultOpen
                first={!mobile}
                onClear={() => setScope('all')}
              >
                <FilterChips value={scope} onChange={setScope} options={POL_SCOPE} />
              </FilterGroup>
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
