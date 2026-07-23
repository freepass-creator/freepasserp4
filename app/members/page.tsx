'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, ROLES, ROLE_LABEL_RAW, type EntityRecord, type Field } from '@/lib/intake/entities';
import { isGuest } from '@/lib/auth-session';
import { getRole } from '@/lib/domain/deal';
import { approveUser } from '@/lib/firebase/auth';
import { newId } from '@/lib/domain/ids';
import { PaneHead, PaneBody, Btn, Badge, FormGrid, FormCard, PillTabs, C, R, NUM, Loading, CenterNote, ListRow, ACTOR_TONE, FilterChips, SectionLabel, Message, PageActions, FW, FS } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { toast } from '@/components/Toaster';
import { matchMemberQuery } from '@/lib/domain/search';
import { haptic } from '@/lib/haptics';
import { NAV_LABEL } from '@/lib/tabbar';

// 사용자·파트너 관리(관리자) — 역할·활성·영업지급율(user) / 유형·공급사수수료율(partner). 여기 율이 정산 R1/R2 SSOT.
type Tab = 'user' | 'partner';
type MemSort = 'name' | 'role' | 'code';
type MemActive = 'all' | 'active' | 'inactive';
const MEM_SORTS: { value: MemSort; label: string }[] = [
  { value: 'name', label: '이름순' },
  { value: 'role', label: '역할순' },
  { value: 'code', label: '코드순' },
];
const MEM_ACTIVE: { key: MemActive; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '활성' },
  { key: 'inactive', label: '비활성' },
];
// 역할 칩·라벨 = ROLES/ROLE_LABEL_RAW SSOT 파생(로컬 라벨 복붙 금지 — 화면마다 달라진다).
const MEM_ROLES: { key: string; label: string }[] = [
  { key: 'all', label: '전체' },
  ...ROLES.map((r) => ({ key: r, label: ROLE_LABEL_RAW[r] })),
];
const MEM_PARTNER_TYPES: { key: string; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: '공급사', label: '공급사' },
  { key: '채널', label: '채널' },
];
const ROLE_LABEL: Record<string, string> = ROLE_LABEL_RAW;
// status(가입승인)는 폼에서 제외 — v4 오버레이가 아니라 approveUser 로 "최상위"에 기록해야 게이트가 인식. 아래 승인 버튼 전용.
const USER_KEYS = ['name', 'role', 'company_code', 'company_name', 'agent_channel_code', 'user_code', 'agent_payout_rate', 'is_team_manager', 'is_active'];
const PARTNER_KEYS = ['name', 'partner_type', 'fee_rate', 'contact', 'sheet_url', 'sheet_tab', 'header_row', 'adapter_id']; // partner_code=자연키(헤더 표시·편집불가)
const idFieldOf = (t: Tab) => (t === 'user' ? 'uid' : 'partner_code');

export default function Members() {
  const co = getCompanyId();
  const router = useRouter();
  const [ok, setOk] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('user');
  const [rows, setRows] = useState<EntityRecord[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<MemSort | ''>('');
  const [roleFlt, setRoleFlt] = useState('all');
  const [activeFlt, setActiveFlt] = useState<MemActive>('all');
  const [ptypeFlt, setPtypeFlt] = useState('all');
  /** 신규 작성 / 보기 → 수정 눌러야 편집 (재고·정책과 동일) */
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = async (t: Tab) => { const all = await getStore().list(t, co); setRows(all); return all; };
  // 회원·파트너 = 관리자 전용(요율·역할을 바꾸는 화면).
  // 둘러보기는 세션이 없어 getRole()이 localStorage 값을 읽는다 → fp4_role 조작으로 통과 가능하므로 함께 차단.
  // ※ 화면 게이트는 방어의 일부일 뿐 — 실제 강제는 RTDB 규칙에서 해야 한다(현재 v4 오버레이 규칙 미비, 별도 과제).
  useEffect(() => { (async () => { await seedIfEmpty(co); if (isGuest() || getRole() !== 'admin') { router.replace('/'); return; } await load('user'); setOk(true); })(); /* eslint-disable-next-line */ }, []);

  const switchTab = async (t: Tab) => {
    if (t === tab) return;
    if (dirty && typeof window !== 'undefined' && !window.confirm('수정 중인 내용이 있습니다. 저장하지 않고 이동할까요?')) return;
    setTab(t); setSel(null); setForm({}); setDirty(false); setCreating(false); setEditing(false); setQ('');
    setRoleFlt('all'); setActiveFlt('all'); setPtypeFlt('all'); setSort('');
    await load(t);
  };
  const select = (r: EntityRecord) => {
    setSel(String(r._key));
    setForm({ ...r });
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
  const onChange = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  // 가입 승인/해제 — approveUser 가 "최상위" users/{uid}/status 에 기록(게이트가 읽는 곳). v4 폼저장으로는 승인 안 됨.
  const doApprove = async (active: boolean) => {
    const uid = String(form.uid || form._key || '');
    if (!uid) { toast('uid 없음 — 승인 불가', 'error'); return; }
    try {
      haptic.select();
      await approveUser(uid, active);
      setForm((f) => ({ ...f, status: active ? 'active' : 'pending' }));
      toast(active ? '가입 승인 완료' : '승인 취소(대기)', 'ok');
      await load(tab);
    } catch (e) { toast(String((e as Error)?.message || e), 'error'); }
  };
  const newRec = () => {
    // 식별코드 = 실무 표준(usr_/sup_). uid=user_code 동일값(단일 안정 ID) → 관계 어느 필드로 걸어도 일치.
    if (tab === 'user') { const c = newId('user'); setForm({ uid: c, user_code: c, role: 'agent', is_active: '예' }); }
    else { const c = newId('partner'); setForm({ partner_code: c, partner_type: '공급사' }); }
    setSel('new');
    setDirty(true);
    setCreating(true);
    setEditing(true);
    haptic.tap();
  };
  const cancelEdit = () => {
    if (creating) { clearSel(); return; }
    const row = rows.find((r) => String(r._key) === sel);
    if (row) { setForm({ ...row }); setDirty(false); setEditing(false); }
    else clearSel();
  };
  const startEdit = () => { setEditing(true); haptic.tap(); };
  const save = async () => {
    const id = idFieldOf(tab); if (!String(form[id] || '').trim()) { toast('식별자는 필수입니다', 'error'); return; }
    await getStore().save(tab, co, [form]); await getStore().update(tab, co, String(form[id]), form);
    setDirty(false);
    setCreating(false);
    setEditing(false);
    await load(tab);
    setSel(String(form._key || form[id]));
    haptic.success();
    toast('저장되었습니다', 'ok');
  };
  const removeRec = async () => {
    if (!sel || creating) { clearSel(); return; }
    const id = idFieldOf(tab);
    const key = String(form._key || form[id] || '');
    if (!key) return;
    const label = String(form.name || key);
    if (typeof window !== 'undefined' && !window.confirm(`「${label}」을(를) 삭제할까요?\n휴지통에서 복구할 수 있습니다.`)) return;
    await getStore().remove(tab, co, key, '회원·파트너 삭제');
    clearSel();
    await load(tab);
    haptic.success();
    toast('삭제되었습니다', 'ok');
  };

  if (ok === null) return <Loading />;

  const shown = rows
    .filter((r) => matchMemberQuery(r, q))
    .filter((r) => {
      if (tab === 'user') {
        if (roleFlt !== 'all' && String(r.role || '') !== roleFlt) return false;
        if (activeFlt === 'active' && r.is_active === '아니오') return false;
        if (activeFlt === 'inactive' && r.is_active !== '아니오') return false;
      } else if (ptypeFlt !== 'all' && String(r.partner_type || '') !== ptypeFlt) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
      if (!sort) return 0;
      if (sort === 'code') {
        const ak = tab === 'user' ? String(a.user_code || a.uid || '') : String(a.partner_code || '');
        const bk = tab === 'user' ? String(b.user_code || b.uid || '') : String(b.partner_code || '');
        return ak.localeCompare(bk, 'ko');
      }
      if (sort === 'role') {
        const ak = tab === 'user' ? String(a.role || '') : String(a.partner_type || '');
        const bk = tab === 'user' ? String(b.role || '') : String(b.partner_type || '');
        return ak.localeCompare(bk, 'ko') || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
  const listEl = shown.length === 0
    ? <CenterNote>{q || roleFlt !== 'all' || activeFlt !== 'all' || ptypeFlt !== 'all' ? '검색 결과 없음' : '없음 — 신규로 추가'}</CenterNote>
    : <div>{shown.map((r) => {
        const on = String(r._key) === sel;
        const pending = tab === 'user' && String(r.status || '') === 'pending';
        const sub = tab === 'user' ? `${ROLE_LABEL[String(r.role)] || String(r.role || '')} · ${r.is_active === '아니오' ? '비활성' : '활성'}` : `${String(r.partner_type || '')} · 수수료 ${r.fee_rate != null ? `${Math.round(Number(r.fee_rate) * 100)}%` : '기본'}`;
        return (
          <ListRow key={String(r._key)} selected={on} onClick={() => { haptic.tap(); select(r); }}
            main={String(r.name || r.user_code || r.partner_code || '—')}
            sub={sub}
            // 승인 대기는 역할보다 먼저 보여야 한다 — 관리자가 목록에서 바로 찾도록.
            right={tab === 'user'
              ? (pending
                ? <Badge tone="amber" variant="solid">승인대기</Badge>
                : <Badge tone={ACTOR_TONE[String(r.role)] || (String(r.role).startsWith('agent') ? 'blue' : 'gray')}>{ROLE_LABEL[String(r.role)] || ''}</Badge>)
              : undefined}
          />
        );
      })}</div>;

  const byKey = Object.fromEntries(ENTITIES[tab].fields.map((f) => [f.key, f]));
  const fields = (tab === 'user' ? USER_KEYS : PARTNER_KEYS).map((k) => byKey[k]).filter(Boolean) as Field[];
  const canEdit = creating || editing;
  const modeBanner = creating ? (
    <Message variant="info">신규 {tab === 'user' ? '사용자' : '파트너'} — 필수 항목을 입력한 뒤 저장하세요.</Message>
  ) : editing ? (
    <Message variant="warning">수정 중 · 저장해야 반영됩니다</Message>
  ) : null;
  // 목록·보기=신규·수정·삭제. 신규/수정=취소·저장.
  const editActions = !sel || (!creating && !editing) ? (
    <PageActions
      primary={{ label: '신규', onClick: newRec }}
      edit={sel && !creating && !editing ? { onClick: startEdit } : undefined}
      remove={sel && !creating && !editing ? { onClick: removeRec } : undefined}
    />
  ) : (
    <PageActions cancel={{ onClick: cancelEdit }} save={{ onClick: save, disabled: !dirty }} />
  );
  const editPane = (
    <>
      <PaneHead title={tab === 'user' ? '사용자' : '파트너'} />
      <PaneBody pad>
        {sel ? (
          <>
            {modeBanner}
            {tab === 'user' && String(form.status || '') === 'pending' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: C.selected, borderRadius: R, marginBottom: 8 }}>
                <Badge tone="amber" variant="solid">승인대기</Badge>
                <span style={{ fontSize: FS.sub, color: C.mute, flex: 1, minWidth: 0 }}>승인하면 이 사용자가 앱을 사용할 수 있습니다.</span>
                <Btn size="sm" onClick={() => doApprove(true)}>가입 승인</Btn>
              </div>
            )}
            {tab === 'user' && String(form.status || '') === 'active' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <Btn size="sm" variant="ghost" onClick={() => doApprove(false)}>승인 취소(대기로)</Btn>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: FS.cap, color: C.faint }}>
              <span style={{ fontFamily: NUM, fontWeight: FW.strong, color: C.mute }}>{String(form[idFieldOf(tab)] || '')}</span>
            </div>
            <FormCard
              hint={tab === 'user'
                ? '영업지급율(0~1) = 월대여료 대비 영업자 지급 비율. 정산 R2 기준(기본 0.04).'
                : '공급사 수수료율(0~1) = 정산 R1. 구글시트 URL을 넣으면 재고·시트 연동에서 관리자가 일괄 가져오기 가능.'}
            >
              <FormGrid fields={fields} form={form} onChange={onChange} cols={2} disabled={!canEdit} />
            </FormCard>
          </>
        ) : (
          <CenterNote>{tab === 'user' ? '사용자' : '파트너'}를 선택하거나 신규로 추가하세요.</CenterNote>
        )}
      </PaneBody>
    </>
  );

  const panes: WorkPane[] = [{ key: 'edit', title: '편집', node: editPane }];

  const fltCount = tab === 'user'
    ? (roleFlt !== 'all' ? 1 : 0) + (activeFlt !== 'all' ? 1 : 0)
    : (ptypeFlt !== 'all' ? 1 : 0);

  const dockActions = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <PillTabs tabs={[{ key: 'user', label: '사용자' }, { key: 'partner', label: '파트너' }]} value={tab} onChange={switchTab} size="sm" />
      {editActions}
    </div>
  );

  return (
    <>
      <WorkPage title={NAV_LABEL.members} listCount={shown.length} list={listEl} panes={panes} selected={!!sel} onBack={clearSel}
        contextTitle={sel ? (creating ? '신규' : String(form.name || form.partner_code || form.user_code || '')) : undefined}
        actions={dockActions}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '이름·코드·회사·연락처·역할…' },
          sort: { value: sort, onChange: (v) => setSort(v as MemSort | ''), options: MEM_SORTS },
          filter: {
            count: fltCount,
            title: tab === 'user' ? '사용자 필터' : '파트너 필터',
            onClear: () => { setRoleFlt('all'); setActiveFlt('all'); setPtypeFlt('all'); },
            body: tab === 'user' ? (
              <>
                <SectionLabel mt={0}>역할</SectionLabel>
                <FilterChips value={roleFlt} onChange={setRoleFlt} options={MEM_ROLES} />
                <SectionLabel>활성</SectionLabel>
                <FilterChips value={activeFlt} onChange={setActiveFlt} options={MEM_ACTIVE} />
              </>
            ) : (
              <>
                <SectionLabel mt={0}>유형</SectionLabel>
                <FilterChips value={ptypeFlt} onChange={setPtypeFlt} options={MEM_PARTNER_TYPES} />
              </>
            ),
          },
          hints: [
            ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
            ...(sort ? [MEM_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...(roleFlt !== 'all' ? [roleFlt] : []),
            ...(activeFlt !== 'all' ? [activeFlt] : []),
            ...(ptypeFlt !== 'all' ? [ptypeFlt] : []),
          ],
          onClearHints: () => { setQ(''); setSort(''); setRoleFlt('all'); setActiveFlt('all'); setPtypeFlt('all'); },
        }}
      />
    </>
  );
}
