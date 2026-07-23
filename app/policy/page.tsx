'use client';
import { useEffect, useState } from 'react';
import { getStore, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, type EntityRecord } from '@/lib/intake/entities';
import { newId } from '@/lib/domain/ids';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { PaneHead, PaneBody, Btn, FormGrid, FormCard, C, Loading, CenterNote, Page, FilterChips, SectionLabel, Message, PageActions } from '@/components/ui';
import { PolicyListRow } from '@/components/list-rows';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { toast } from '@/components/Toaster';
import { matchPolicyQuery } from '@/lib/domain/search';
import { haptic } from '@/lib/haptics';
import { useIsMobile } from '@/lib/use-mobile';
import { NAV_LABEL } from '@/lib/tabbar';

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

// 정책관리 = [목록 | 기본·심사 | 계약조건 | 보험] 4패널. 스키마 SSOT(ENTITIES.policy) + FormGrid.
// 공급사 = 자기 정책만 편집. 공용(provider_company_code 빈값)은 목록에 안 띄움(재고 Select에서만 연결).
// 필드 그룹 SSOT — detailSections(심사/계약조건/보험)과 동일 골격. 미지정 필드는 보험 패널이 흡수(누락 방지).
const G_BASIC = ['policy_code', 'policy_name', 'provider_company_code', 'policy_type', 'screening_criteria', 'credit_grade', 'basic_driver_age', 'driver_age_lowering', 'driver_age_upper_limit', 'license_period', 'age_lowering_cost'];
const G_TERMS = ['annual_mileage', 'mileage_upcharge_per_10000km', 'payment_method', 'penalty_condition', 'rental_region', 'delivery_fee', 'deposit_installment', 'deposit_card_payment', 'insurance_included', 'personal_driver_scope', 'business_driver_scope', 'additional_driver_allowance_count', 'additional_driver_cost', 'maintenance_service', 'commission_clawback_condition'];

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
    const all = await getStore().list('policy', co);
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
      const all = await load(r);
      // 계약·재고와 동일 — 모바일=목록부터, 웹=첫행
      if (!mobile && all.length) selectP(all[0]);
      else clearSel();
    })();
    const on = () => {
      const r = getRole();
      if (r !== 'admin' && r !== 'provider') { setOk(false); setRows([]); clearSel(); return; }
      setOk(true);
      load(r).then((all) => { clearSel(); if (!mobile && all.length) selectP(all[0]); });
    };
    window.addEventListener('fp:role', on);
    return () => window.removeEventListener('fp:role', on);
    /* eslint-disable-next-line */
  }, [mobile]);

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
    await getStore().save('policy', co, [patch]);
    await getStore().update('policy', co, String(patch.policy_code), patch);
    setDirty(false);
    setCreating(false);
    setEditing(false);
    await load(role);
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
    if (typeof window !== 'undefined' && !window.confirm(`정책 「${form.policy_name || form.policy_code}」을(를) 삭제할까요?\n휴지통에서 복구할 수 있습니다.`)) return;
    await getStore().remove('policy', co, String(form.policy_code), '정책관리 삭제');
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
    haptic.tap();
  };

  const cancelEdit = () => {
    if (creating) { clearSel(); return; }
    const row = (rows || []).find((p) => String(p.policy_code) === sel);
    if (row) { setForm({ ...row }); setDirty(false); setEditing(false); }
    else clearSel();
  };
  const startEdit = () => { setEditing(true); haptic.tap(); };

  if (ok === false) {
    return (
      <Page title={NAV_LABEL.policy}>
        <CenterNote>공급사·관리자만 정책을 관리할 수 있습니다</CenterNote>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <Btn href="/settings" size="sm">설정에서 역할 변경</Btn>
        </div>
      </Page>
    );
  }
  if (ok !== true) return <Loading />;

  const shown = (rows || [])
    .filter((p) => matchPolicyQuery(p, q))
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
    });
  const listEl = shown.length === 0
    ? <CenterNote>{q || scope !== 'all' ? '검색 결과 없음' : '정책 없음 — 등록하거나 공용 정책은 재고에서 연결'}</CenterNote>
    : <div>{shown.map((p) => {
        const on = String(p.policy_code) === sel;
        return (
          <PolicyListRow key={String(p.policy_code)} selected={on} onClick={() => { haptic.tap(); selectP(p); }} p={p} />
        );
      })}</div>;

  const grouped = new Set([...G_BASIC, ...G_TERMS]);
  const fieldsIn = (keys: string[]) => {
    let keys2 = keys;
    // 공급사는 귀속코드 필드 숨김(자동 스탬프)
    if (getRole() === 'provider') keys2 = keys.filter((k) => k !== 'provider_company_code');
    return ENTITIES.policy.fields.filter((f) => keys2.includes(f.key));
  };
  const insFields = ENTITIES.policy.fields.filter((f) => !grouped.has(f.key));

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

  const editPane = (title: string, fields: typeof ENTITIES.policy.fields, hint?: string) => (
    <>
      <PaneHead title={title} />
      <PaneBody pad>
        {sel ? (
          <>
            {modeBanner}
            <FormCard hint={hint}>
              <FormGrid fields={fields} form={form} onChange={onChange} cols={2} disabled={!canEdit} />
            </FormCard>
          </>
        ) : (
          <CenterNote>정책을 선택하세요.</CenterNote>
        )}
      </PaneBody>
    </>
  );
  const panes: WorkPane[] = [
    { key: 'basic', title: '기본·심사', node: editPane('기본·심사', fieldsIn(G_BASIC), '정책 신원·심사 기준') },
    { key: 'terms', title: '계약조건', node: editPane('계약조건', fieldsIn(G_TERMS), '운행·납부·특약') },
    { key: 'ins', title: '보험', node: editPane('보험', insFields, '보험·부가 조건') },
  ];
  return (
    <>
      <WorkPage title={NAV_LABEL.policy} listCount={shown.length} list={rows === null ? <Loading /> : listEl} panes={panes} selected={!!sel} onBack={clearSel}
        contextTitle={sel ? (creating ? '신규 정책' : String(form.policy_name || form.policy_code || '')) : undefined}
        actions={dockActions}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '정책명·코드·심사·지역…' },
          action: { label: '등록', onClick: newP },
          sort: { value: sort, onChange: (v) => setSort(v as PolSort | ''), options: POL_SORTS },
          filter: {
            count: scope === 'all' ? 0 : 1,
            title: '정책 필터',
            onClear: () => setScope('all'),
            body: (
              <>
                <SectionLabel mt={0}>귀속</SectionLabel>
                <FilterChips value={scope} onChange={setScope} options={POL_SCOPE} />
              </>
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
