'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, ROLE_LABEL_RAW, type EntityRecord, type Field } from '@/lib/intake/entities';
import { isAdminUiAllowed } from '@/lib/auth-gate';
import { approveUser, backfillPersonalAgentChannels, adminUpdateUserIdentity } from '@/lib/firebase/auth';
import { readAllPartnersPrivate, readAllUsersPrivate, writePartnerPrivate } from '@/lib/domain/private-fields';
import { migrateSensitiveToPrivate } from '@/lib/firebase/migrate-private';
import { newId } from '@/lib/domain/ids';
import { PaneHead, PaneBody, Btn, Badge, FormGrid, FormCard, PillTabs, C, R, NUM, Loading, CenterNote, ListRow, ACTOR_TONE, FilterChips, FilterGroup, Message, PageActions, FW, FS } from '@/components/ui';
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
  filterMembers,
  pendingMemberCount,
  type MemberActiveFilter as MemActive,
  type MemberSort as MemSort,
  type MemberTab as Tab,
} from '@/features/members/member-filter';
import { MembersList } from '@/features/members/MembersList';

// 사용자·파트너 관리(관리자) — 역할·활성·영업지급율(user) / 유형·공급사수수료율(partner). 여기 율이 정산 R1/R2 SSOT.
const ROLE_LABEL: Record<string, string> = ROLE_LABEL_RAW;
// status(가입승인)는 폼에서 제외 — v4 오버레이가 아니라 approveUser 로 "최상위"에 기록해야 게이트가 인식. 아래 승인 버튼 전용.
const USER_KEYS = ['name', 'role', 'company_code', 'company_name', 'agent_channel_code', 'user_code', 'agent_payout_rate', 'is_team_manager', 'is_active'];
const PARTNER_KEYS = ['name', 'partner_type', 'fee_rate', 'contact', 'sheet_url', 'sheet_tab', 'header_row', 'adapter_id']; // partner_code=자연키(헤더 표시·편집불가)
const idFieldOf = (t: Tab) => (t === 'user' ? 'uid' : 'partner_code');

export default function Members() {
  const co = getCompanyId();
  const router = useRouter();
  const mobile = useIsMobile();
  const [ok, setOk] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('user');
  const [rows, setRows] = useState<EntityRecord[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<MemSort | ''>('');
  const [roleFlt, setRoleFlt] = useState('all');
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
  const load = async (t: Tab) => { const all = await enrichPrivate(t, await getStore().list(t, co)); setRows(all); return all; };
  // 회원·파트너 = 관리자 전용(요율·역할을 바꾸는 화면).
  // 둘러보기는 세션이 없어 getRole()이 localStorage 값을 읽는다 → fp4_role 조작으로 통과 가능하므로 함께 차단.
  // ※ 화면 게이트는 방어의 일부일 뿐 — 실제 강제는 RTDB 규칙에서 해야 한다(현재 v4 오버레이 규칙 미비, 별도 과제).
  useEffect(() => { (async () => { await seedIfEmpty(co); if (!isAdminUiAllowed()) { router.replace('/'); return; } await load('user'); setOk(true); })(); /* eslint-disable-next-line */ }, []);

  const switchTab = async (t: Tab) => {
    if (t === tab) return;
    if (dirty && !await confirmDialog({ title: '수정 취소', message: '수정 중인 내용이 있습니다. 저장하지 않고 이동할까요?', danger: true, okLabel: '이동' })) return;
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
    if (approveBusy) return;
    setApproveBusy(true);
    try {
      haptic.select();
      await approveUser(uid, active);
      setForm((f) => ({ ...f, status: active ? 'active' : 'pending' }));
      toast(active ? '가입 승인 완료' : '승인 취소(대기)', 'ok');
      await load(tab);
    } catch (e) { toast(String((e as Error)?.message || e), 'error'); }
    finally { setApproveBusy(false); }
  };
  /** 규칙 게시 전 — SP999/빈 채널 개인 영업자를 user_code 채널로 고유화. */
  const doBackfillChannels = async (dry: boolean) => {
    try {
      haptic.select();
      const r = await backfillPersonalAgentChannels({ dryRun: dry });
      const n = r.updated.length;
      toast(
        dry
          ? `미리보기: ${n}명 대상 (스캔 ${r.scanned} · 건너뜀 ${r.skipped})`
          : `채널 백필 ${n}명 완료 (스캔 ${r.scanned} · 건너뜀 ${r.skipped})`,
        n ? 'ok' : 'info',
      );
      if (!dry && n) await load(tab);
    } catch (e) { toast(String((e as Error)?.message || e), 'error'); }
  };
  /** 민감정보(_private) 분리 마이그레이션 — 공급사 fee_rate·회원 email 을 private 노드로 복사(+실행 시 본노드 제거). dryRun 기본. */
  const doMigratePrivate = async (dry: boolean) => {
    if (!dry && !await confirmDialog({ title: '민감정보 이관', message: '민감정보를 private 노드로 이관하고 본노드에서 제거합니다.\n규칙(database.rules.json)이 먼저 게시되어 있어야 합니다. 진행할까요?', danger: true, okLabel: '이관 실행' })) return;
    try {
      haptic.select();
      const r = await migrateSensitiveToPrivate({ dryRun: dry });
      toast(
        `${dry ? '미리보기' : '실행 완료'} · 공급사 ${r.partners.moved}/${r.partners.scanned}(fee_rate) · 회원 ${r.users.moved}/${r.users.scanned}(email)`
          + (r.errors.length ? ` · 오류 ${r.errors.length}` : ''),
        r.errors.length ? 'error' : (dry ? 'info' : 'ok'),
      );
      if (r.errors.length) console.warn('[migratePrivate] errors', r.errors);
      console.info('[migratePrivate] report', r);
      if (!dry) await load(tab);
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
    if (saving) return;
    setSaving(true);
    try {
      // 공급사 수수료율(상업기밀)은 private 노드로 라우팅. 이관 성공 시 본노드 쓰기에서 제외(공개 read 차단).
      //  실패(규칙 미게시·no-db)면 본노드에 그대로 남긴다(유실·머니율 누락 방지) — 폴백이 기존 동작 보존.
      let mainForm: EntityRecord = form;
      if (tab === 'partner') {
        const code = String(form.partner_code || form._key || '').trim();
        const moved = await writePartnerPrivate(code, { fee_rate: form.fee_rate });
        // 이관 성공 시 본노드(v4)에서 fee_rate를 null로 제거 — 단순 제외(delete)는 merge라 옛값이 잔존해
        //  base/private divergence + 마이그레이션 revert를 유발. null로 명시 삭제. (resolveRates·마이그레이션 모두 private-first)
        if (moved) mainForm = { ...form, fee_rate: null };
      }
      await getStore().save(tab, co, [mainForm]); await getStore().update(tab, co, String(form[id]), mainForm);
      // 신원 게이트 필드(role/company_code/agent_channel_code)는 세션(initAuth)·RLS·approveUser 가 읽는 "최상위" users/{uid} 에 직접 반영.
      //  v4 오버레이에만 쓰면 강등·재배정이 조용히 무효(desync) → approveUser 와 동일 노드로 SSOT 정합. status 는 approveUser 전용이라 제외.
      if (tab === 'user') {
        const uid = String(form.uid || form._key || '').trim();
        if (uid) await adminUpdateUserIdentity(uid, {
          role: form.role != null ? String(form.role) : undefined,
          company_code: form.company_code != null ? String(form.company_code) : undefined,
          agent_channel_code: form.agent_channel_code != null ? String(form.agent_channel_code) : undefined,
        });
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
    const id = idFieldOf(tab);
    const key = String(form._key || form[id] || '');
    if (!key) return;
    const label = String(form.name || key);
    if (!await confirmDialog({ title: '구성원 삭제', message: `「${label}」을(를) 삭제할까요?\n휴지통에서 복구할 수 있습니다.`, danger: true, okLabel: '삭제' })) return;
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

  if (ok === null) return <Loading />;

  const shown = filterMembers({
    rows, tab, query: q, sort, role: roleFlt, active: activeFlt, partnerType: ptypeFlt,
  });
  const listEl = (
    <MembersList
      tab={tab}
      rows={shown}
      selected={sel}
      filtered={!!(q || roleFlt !== 'all' || activeFlt !== 'all' || ptypeFlt !== 'all')}
      onTab={(next) => { void switchTab(next); }}
      onSelect={select}
    />
  );

  // 승인대기 카운트 + 대기 전용 필터칩(관리자가 신규 가입 처리대상을 한눈에)
  const pendingCount = pendingMemberCount(rows, tab);
  const activeOptions: { key: MemActive; label: string }[] = tab === 'user'
    ? [...MEM_ACTIVE, { key: 'pending', label: pendingCount ? `승인대기 ${pendingCount}` : '승인대기' }]
    : MEM_ACTIVE;

  const byKey = Object.fromEntries(ENTITIES[tab].fields.map((f) => [f.key, f]));
  const fields = (tab === 'user' ? USER_KEYS : PARTNER_KEYS).map((k) => byKey[k]).filter(Boolean) as Field[];
  const canEdit = creating || editing;
  const modeBanner = creating ? (
    <Message variant="info">신규 {tab === 'user' ? '사용자' : '파트너'} — 필수 항목을 입력한 뒤 저장하세요.</Message>
  ) : editing ? (
    <Message variant="warning">수정 중 · 저장해야 반영됩니다</Message>
  ) : null;
  // 하단바 = 편집 컨텍스트만(수정·삭제 / 취소·저장). PillTabs는 목록 상단(320px 독 넘침 방지).
  const editActions = creating || editing ? (
    <PageActions cancel={{ onClick: cancelEdit, disabled: saving }} save={{ onClick: save, disabled: !dirty || saving, label: saving ? '저장 중…' : undefined }} />
  ) : sel ? (
    <PageActions edit={{ onClick: startEdit }} remove={{ onClick: removeRec }} />
  ) : null;
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
                <Btn size="sm" onClick={() => doApprove(true)} disabled={approveBusy}>{approveBusy ? '처리 중…' : '가입 승인'}</Btn>
              </div>
            )}
            {tab === 'user' && String(form.status || '') === 'active' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <Btn size="sm" variant="ghost" onClick={() => doApprove(false)} disabled={approveBusy}>{approveBusy ? '처리 중…' : '승인 취소(대기로)'}</Btn>
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
          <>
            <CenterNote>{tab === 'user' ? '사용자' : '파트너'}를 선택하거나 신규로 추가하세요.</CenterNote>
            {tab === 'user' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: 'center' }}>
                <Btn size="sm" variant="ghost" onClick={() => doBackfillChannels(true)}>개인채널 백필 미리보기</Btn>
                <Btn size="sm" variant="ghost" onClick={() => doBackfillChannels(false)}>개인채널 백필 실행</Btn>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: 'center' }}>
              <Btn size="sm" variant="ghost" onClick={() => doMigratePrivate(true)}>민감정보 분리 미리보기</Btn>
              <Btn size="sm" variant="ghost" onClick={() => doMigratePrivate(false)}>민감정보 분리 실행</Btn>
            </div>
          </>
        )}
      </PaneBody>
    </>
  );

  const panes: WorkPane[] = [{ key: 'edit', title: '편집', node: editPane }];

  const fltCount = tab === 'user'
    ? (roleFlt !== 'all' ? 1 : 0) + (activeFlt !== 'all' ? 1 : 0)
    : (ptypeFlt !== 'all' ? 1 : 0);

  const dockActions = editActions;

  return (
    <>
      <WorkPage title={NAV_LABEL.members} listCount={shown.length} list={listEl} panes={panes} selected={!!sel} onBack={clearSel}
        contextTitle={sel ? (creating ? '신규' : String(form.name || form.partner_code || form.user_code || '')) : undefined}
        actions={dockActions}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '이름·코드·회사·연락처·역할…' },
          action: { label: '신규', onClick: newRec },
          sort: { value: sort, onChange: (v) => setSort(v as MemSort | ''), options: MEM_SORTS },
          filter: {
            count: fltCount,
            title: '조건 검색',
            onClear: () => { setRoleFlt('all'); setActiveFlt('all'); setPtypeFlt('all'); },
            body: tab === 'user' ? (
              <>
                <FilterGroup
                  title="역할"
                  count={roleFlt === 'all' ? 0 : 1}
                  defaultOpen
                  first={!mobile}
                  onClear={() => setRoleFlt('all')}
                >
                  <FilterChips value={roleFlt} onChange={setRoleFlt} options={MEM_ROLES} />
                </FilterGroup>
                <FilterGroup
                  title="활성"
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
                first={!mobile}
                onClear={() => setPtypeFlt('all')}
              >
                <FilterChips value={ptypeFlt} onChange={setPtypeFlt} options={MEM_PARTNER_TYPES} />
              </FilterGroup>
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
