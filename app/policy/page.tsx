'use client';
import { useEffect, useMemo, useState } from 'react';
import { getStore, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, type EntityRecord } from '@/lib/intake/entities';
import { newId } from '@/lib/domain/ids';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { PaneHead, PaneBody, Btn, FormGrid, FormReadList, FormCard, C, Loading, CenterNote, Page, FilterChips, FilterGroup, Message, PageActions, FeedRowSkeleton } from '@/components/ui';
import { PolicyCreateRow, PolicyListRow } from '@/components/list-rows';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { confirmDialog, toast } from '@/components/Toaster';
import { matchPolicyQuery } from '@/lib/domain/search';
import { haptic } from '@/lib/haptics';
import { useIsMobile } from '@/lib/use-mobile';
import { NAV_LABEL } from '@/lib/tabbar';
import { canIssueContract, CONTRACT_LAYER, type PolicyField } from '@/lib/domain/policy-tier';
import { applyPolicyDefaults } from '@/lib/domain/policy-defaults';
import { retainVisibleSelection } from '@/features/work-list-display';
import { providerNameMap } from '@/lib/domain/identity';

type PolSort = 'name' | 'code' | 'type';
type PolScope = 'all' | 'mine' | 'shared';
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

// 정책관리 = [목록 | 기본정책 | 영업정책 | 보험정책 | 계약정책] 5패널. 스키마 SSOT(ENTITIES.policy) + FormGrid.
// 공급사 = 자기 정책만 편집. 공용(provider_company_code 빈값)은 목록에 안 띄움(재고 Select에서만 연결).
// 필드 그룹 SSOT — 미지정 필드는 보험정책 패널이 흡수(누락 방지).
const G_BASIC = ['policy_code', 'policy_name', 'provider_company_code', 'policy_type', 'screening_criteria', 'credit_grade', 'basic_driver_age', 'driver_age_lowering', 'driver_age_upper_limit', 'license_period', 'age_lowering_cost'];
const G_TERMS = ['annual_mileage', 'mileage_upcharge_per_10000km', 'payment_method', 'rental_region', 'delivery_fee', 'deposit_installment', 'deposit_card_payment', 'insurance_included', 'personal_driver_scope', 'business_driver_scope', 'additional_driver_allowance_count', 'additional_driver_cost', 'maintenance_service', 'commission_clawback_condition'];
/**
 * 전자계약 패널 — **계약서를 우리가 쓰는 공급사만** 채운다.
 *
 * 목록을 여기 손으로 적지 않고 `CONTRACT_LAYER` 에서 뽑는다.
 * 두 벌로 두면 어긋난다 — 실제로 「초과 주행요금」이 계약 층에 정의돼 있는데
 * 화면에서는 계약조건 패널에 있었다(패널티인데 가격표 옆에 서 있었다).
 * 근거: `docs/POLICY-LAYERS.md` · SSOT: `lib/domain/policy-tier.ts`
 */
const G_ESIGN = ['contract_authoring', ...CONTRACT_LAYER.map((f) => f.key)];

/**
 * 패널 안의 «섹션» — 한 패널에 20칸이 한 덩어리로 쏟아지면 무엇을 정하는 자리인지 안 읽힌다.
 *
 * 가르는 기준은 **「이 값을 왜 보는가」**다. 돈·연령·패널티로 가르면 한 항목이 여러 곳에
 * 걸린다 — 연령 하향은 «연령이면서 돈»이고 초과 주행요금은 «돈이면서 패널티»다.
 *
 * ★운전자 범위와 추가운전자는 따로 둔다(2026-08-10 사장님)
 *   범위 = 계약 내내 적용되는 조건(약관 제5조, 범위 밖 사고는 보험 전액 제외)
 *   추가운전자 = 돈 내고 붙이는 옵션(상담에서 정한다)
 *   같은 섹션에 두면 «기본으로 되는 것»과 «돈 내야 되는 것»이 섞인다.
 */
type PolicySection = { title: string; keys: string[] };

const SEC_BASIC: PolicySection[] = [
  { title: '정책 신원', keys: ['policy_code', 'policy_name', 'provider_company_code', 'policy_type'] },
  { title: '심사 기준', keys: ['screening_criteria', 'credit_grade'] },
  { title: '운전 자격', keys: ['basic_driver_age', 'driver_age_upper_limit', 'license_period'] },
  // 연령을 내리는 것은 «돈 내고 푸는 조건»이라 자격과 나눈다.
  { title: '연령 하향(유상)', keys: ['driver_age_lowering', 'age_lowering_cost'] },
];

const SEC_TERMS: PolicySection[] = [
  { title: '주행 약정', keys: ['annual_mileage', 'mileage_upcharge_per_10000km'] },
  { title: '운전자 범위', keys: ['personal_driver_scope', 'business_driver_scope'] },
  { title: '추가운전자(유상)', keys: ['additional_driver_allowance_count', 'additional_driver_cost'] },
  { title: '납부 방식', keys: ['payment_method', 'deposit_installment', 'deposit_card_payment'] },
  { title: '상품 구성', keys: ['insurance_included', 'maintenance_service', 'delivery_fee', 'rental_region'] },
  { title: '내부 약정', keys: ['commission_clawback_condition'] },
];

const SEC_INS: PolicySection[] = [
  {
    title: '보상 한도',
    keys: ['injury_compensation_limit', 'property_compensation_limit', 'self_body_accident',
      'uninsured_damage', 'own_damage_compensation', 'annual_roadside_assistance'],
  },
  {
    title: '면책금 (손님 부담)',
    keys: ['injury_deductible', 'property_deductible', 'self_body_deductible',
      'uninsured_deductible', 'own_damage_repair_ratio', 'own_damage_min_deductible', 'own_damage_max_deductible'],
  },
];

const SEC_ESIGN: PolicySection[] = [
  { title: '계약서 작성 주체', keys: ['contract_authoring'] },
  { title: '위반 시 부담', keys: ['over_mileage_rate_domestic', 'over_mileage_rate_imported', 'late_fee_rate', 'impound_fee'] },
  { title: '중도해지 위약금', keys: ['early_termination_rate_under1y', 'early_termination_rate_over1y', 'penalty_condition'] },
  { title: '미납 제재', keys: ['engine_control_overdue_days', 'auto_terminate_overdue_days', 'deposit_overdue_rounds', 'claim_basis'] },
  { title: '사고 제재', keys: ['accident_termination_count'] },
  { title: '만기 통지기한', keys: ['renewal_notice_days', 'buyout_notice_days'] },
  { title: '반환·보관', keys: ['deposit_return_days', 'impound_keep_days'] },
  { title: '계약서 실명·표기', keys: ['insurer_name', 'designated_garage', 'self_damage_exclusions', 'replacement_car_policy', 'gps_installed'] },
];

function scopePolicies(all: EntityRecord[], role: Role): EntityRecord[] {
  if (role === 'admin') return all;
  if (role === 'provider') {
    const me = actor('provider').code;
    // 자기 전용만 관리. 공용 템플릿은 재고 연결용(편집은 admin).
    return all.filter((p) => String(p.provider_company_code || '') === me);
  }
  return [];
}

export default function PolicyMgmt() {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [providerAliases, setProviderAliases] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState('');
  const [ok, setOk] = useState<boolean | null>(null);
  const [sort, setSort] = useState<PolSort | ''>('');
  const [scope, setScope] = useState<PolScope>('all');
  /** 신규 작성 / 보기 → 수정 눌러야 편집 (재고·멤버와 동일) */
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = async (r?: Role) => {
    const role = r || getRole();
    const [all, partners] = await Promise.all([
      getStore().list('policy', co),
      getStore().list('partner', co).catch(() => []),
    ]);
    // 표시명은 별도 맵으로 보강한다. 행 데이터에 합치면 편집 저장 시 provider_name이
    // 정책 레코드에 의도치 않게 영속화되므로, 원본 policy는 건드리지 않는다.
    setProviderAliases(providerNameMap(partners));
    const mine = scopePolicies(all, role);
    setRows(mine);
    return mine;
  };
  const selectP = (p: EntityRecord) => {
    setSel(String(p.policy_code));
    setForm({ ...p });
    setDirty(false);
    setCreating(false);
    setEditing(false);
  };
  const clearSel = () => {
    setSel(null);
    setForm({});
    setDirty(false);
    setCreating(false);
    setEditing(false);
  };

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
      // 업무 목록 공통 규격 — 화면 진입은 목록부터, 사용자가 행을 선택해야 상세를 연다.
      clearSel();
    })();
    const on = () => {
      const r = getRole();
      if (r !== 'admin' && r !== 'provider') { setOk(false); setRows([]); clearSel(); return; }
      setOk(true);
      load(r).then(() => clearSel());
    };
    window.addEventListener('fp:role', on);
    return () => window.removeEventListener('fp:role', on);
    /* eslint-disable-next-line */
  }, []);

  // 메뉴에서 정책관리 재진입 → 목록
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === '/policy') clearSel();
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
    let patch = { ...form };
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

  const newP = () => {
    const c = newId('policy');
    const role = getRole();
    const base: EntityRecord = { policy_code: c };
    if (role === 'provider') base.provider_company_code = actor('provider').code;
    setSel(c);
    setForm(base);
    setDirty(true);
    setCreating(true);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (creating) { clearSel(); return; }
    const row = (rows || []).find((p) => String(p.policy_code) === sel);
    if (row) { setForm({ ...row }); setDirty(false); setEditing(false); }
    else clearSel();
  };
  const startEdit = () => { setEditing(true); haptic.tap(); };

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
  const listEl = (
    <>
      <PolicyCreateRow onClick={newP} />
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
  const modeBanner = creating ? (
    <Message variant="info">신규 정책 등록 — 필수 항목을 입력한 뒤 저장하세요.</Message>
  ) : editing ? (
    <Message variant="warning">수정 중 · 저장해야 반영됩니다</Message>
  ) : null;
  // 하단바 = 편집 컨텍스트만(수정·삭제 / 취소·저장). 등록은 상단 툴바(listTools.action).
  const dockActions = creating || editing ? (
    <PageActions cancel={{ onClick: cancelEdit }} save={{ onClick: save, disabled: !dirty }} />
  ) : sel ? (
    <PageActions edit={{ onClick: startEdit }} remove={{ onClick: removeP }} />
  ) : undefined;

  /**
   * 섹션으로 나눠 그린다 — 한 패널에 20칸이 한 덩어리면 무엇을 정하는 자리인지 안 읽힌다.
   * 어느 섹션에도 안 넣은 칸은 «기타»로 모아 둔다(누락 방지 — 조용히 사라지면 못 채운다).
   */
  const sectionPane = (title: string, secs: PolicySection[], all: typeof ENTITIES.policy.fields) => {
    const placed = new Set(secs.flatMap((s) => s.keys));
    const rest = all.filter((f) => !placed.has(f.key));
    const blocks = [
      ...secs
        .map((s) => ({ title: s.title, fields: all.filter((f) => s.keys.includes(f.key)) }))
        .filter((b) => b.fields.length),
      ...(rest.length ? [{ title: '기타', fields: rest }] : []),
    ];
    return blocks.map((b) => (
      <div key={b.title} style={{ marginBottom: 12 }}>
        <FormCard title={b.title}>
          <FormGrid fields={b.fields} form={form} onChange={onChange} cols={2} disabled={!canEdit} showNotes />
        </FormCard>
      </div>
    ));
  };

  const editPane = (title: string, fields: typeof ENTITIES.policy.fields, hint?: string, lead?: string, secs?: PolicySection[]) => (
    <>
      <PaneHead title={title} />
      <PaneBody pad>
        {sel ? (
          <>
            {modeBanner}
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
            {title === '계약정책' && canEdit && (
              <div style={{ marginBottom: 10 }}>
                <Btn title="프리패스 표준값 채우기" size="sm" variant="ghost" onClick={fillDefaults}>
                  프리패스 표준값 채우기
                </Btn>
              </div>
            )}
            {mobile && !canEdit ? (
              <FormReadList fields={fields} form={form} footer={hint} />
            ) : secs ? (
              /*
                섹션이 있으면 나눠 그린다. 칸마다 «무슨 뜻이고 어느 약관 조항에 걸리는지»는
                그대로 붙는다(재고·계약처럼 매일 만지는 화면은 조밀해야 하므로 거기선 끈다).
              */
              sectionPane(title, secs, fields)
            ) : (
              <FormCard hint={hint}>
                <FormGrid fields={fields} form={form} onChange={onChange} cols={2} disabled={!canEdit} showNotes />
              </FormCard>
            )}
          </>
        ) : (
          <CenterNote>정책을 선택하세요.</CenterNote>
        )}
      </PaneBody>
    </>
  );
  /*
   * 패널 안내 — 세 층(상품·영업·계약)을 화면 말로 옮긴 것.
   * 설계 근거: `docs/POLICY-LAYERS.md`
   */
  const panes: WorkPane[] = [
    {
      key: 'basic',
      title: '기본정책',
      node: editPane('기본정책', fieldsIn(G_BASIC), undefined, undefined, SEC_BASIC),
    },
    /*
     * 패널 이름은 세 층 그대로 부른다(2026-08-10 사장님).
     *   영업정책 = 상담에서 값을 «정하는» 가격표
     *   보험정책 = 사고 시 «보상되는» 범위
     *   계약정책 = 계약 내내 «적용되는» 규칙 — 계약서를 우리가 쓸 때만
     *
     * 패널 머리 설명은 뺐다 — 칸마다 이미 설명이 붙어 있어 같은 말을 두 번 하게 된다.
     * 계약정책만 남긴다. «지금 이 정책으로 보낼 수 있나»는 칸별 설명이 못 하는 말이다.
     */
    {
      key: 'terms',
      title: '영업정책',
      node: editPane('영업정책', fieldsIn(G_TERMS), undefined, undefined, SEC_TERMS),
    },
    {
      key: 'ins',
      title: '보험정책',
      node: editPane('보험정책', insFields, undefined, undefined, SEC_INS),
    },
    {
      key: 'esign',
      title: '계약정책',
      node: editPane('계약정책', fieldsIn(G_ESIGN), esignHint, undefined, SEC_ESIGN),
    },
  ];
  return (
    <>
      <WorkPage title={NAV_LABEL.policy} listCount={rows === null ? null : shown.length} list={rows === null ? <FeedRowSkeleton /> : listEl} panes={panes} selected={!!sel} onBack={clearSel}
        contextTitle={sel ? (creating ? '신규 정책' : String(form.policy_name || form.policy_code || '')) : undefined}
        actions={dockActions}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '정책명·코드·심사·지역…' },
          // 등록은 목록 맨 위 PolicyCreateRow 하나로 — 헤더 우측 버튼과 두 갈래로 두지 않는다.
          sort: { value: sort, onChange: (v) => setSort(v as PolSort | ''), options: POL_SORTS },
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
            ...(sort ? [POL_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...(scope !== 'all' ? [POL_SCOPE.find((o) => o.key === scope)?.label || scope] : []),
          ],
          onClearHints: () => { setQ(''); setSort(''); setScope('all'); },
        }}
      />
    </>
  );
}
