'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, ROLE_LABEL_RAW, ROLES, rangeErrors, type EntityRecord, type Field } from '@/lib/intake/entities';
import { isAdminUiAllowed } from '@/lib/auth-gate';
import { approveUser, backfillPersonalAgentChannels, adminUpdateUserIdentity } from '@/lib/firebase/auth';
import { readAllPartnersPrivate, readAllUsersPrivate, writePartnerPrivate, writeUserPrivate } from '@/lib/domain/private-fields';
import { migrateSensitiveToPrivate } from '@/lib/firebase/migrate-private';
import { newId } from '@/lib/domain/ids';
import {
  ACTOR_TONE, PaneHead, PaneBody, Btn, Badge, DetailRow, FormGrid, FormCard, ListGroup,
  ButtonLabel, C, R, NUM, Loading, CenterNote, FilterChips, FilterGroup, Message, PageActions, FW, FS, ICON,
} from '@/components/ui';
import { Eye, Play, RotateCcw, ShieldCheck, UserCheck, UserRoundX } from 'lucide-react';
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
  pendingMemberCount,
  type MemberActiveFilter as MemActive,
  type MemberSort as MemSort,
  type MemberTab as Tab,
} from '@/features/members/member-filter';
import { MembersList } from '@/features/members/MembersList';
import { retainVisibleSelection } from '@/features/work-list-display';
import { partnerTypeLabel } from '@/lib/domain/partner';
import { businessRegistrationNumberOf, normalizeBusinessRegistrationNumber } from '@/lib/domain/business-identity';
import { parseDepositRule } from '@/lib/domain/sheet-import';
import { isAutoplusPartner } from '@/lib/domain/sheet-autoplus';
// 사용자·파트너 관리(관리자) — 역할·활성·영업지급율(user) / 유형·공급사수수료율(partner). 여기 율이 정산 R1/R2 SSOT.
// status(가입승인)는 폼에서 제외 — v4 오버레이가 아니라 approveUser 로 "최상위"에 기록해야 게이트가 인식. 아래 승인 버튼 전용.
const idFieldOf = (t: Tab) => (t === 'user' ? 'uid' : 'partner_code');
const ratePct = (value: unknown) => {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return '';
  return `${Math.round(n * 100)}%`;
};
const strOf = (value: unknown) => String(value ?? '');
const depositRuleLabel = (value: unknown) => {
  const rule = String(value ?? '');
  if (rule === 'months_per_year') return '기간 1년당 월대여료 1개월치';
  if (rule === 'rent_multiple') return '국산 2개월치 · 수입 3개월치';
  return '미설정 · 시트 보증금만 사용';
};

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
  const [sort, setSort] = useState<MemSort | ''>('name');
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
  useEffect(() => { (async () => { if (!isAdminUiAllowed()) { router.replace('/'); return; } await seedIfEmpty(co); await load('user'); setOk(true); })(); /* eslint-disable-next-line */ }, []);

  const switchTab = async (t: Tab) => {
    if (t === tab) return;
    if (dirty && !await confirmDialog({ title: '수정 취소', message: '수정 중인 내용이 있습니다. 저장하지 않고 이동할까요?', danger: true, okLabel: '이동' })) return;
    setTab(t); setSel(null); setForm({}); setDirty(false); setCreating(false); setEditing(false); setQ('');
    setRoleFlt('all'); setActiveFlt('all'); setPtypeFlt('all'); setSort('name');
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
    if (!dry && !await confirmDialog({
      title: '개인채널 백필',
      message: '대상 회원의 영업채널 값을 일괄 변경합니다. 먼저 미리보기 결과를 확인했나요?',
      danger: true,
      okLabel: '백필 실행',
    })) return;
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
        // 이메일(PII)도 같은 계약이다. 이 화면은 private 을 «병합해» 폼을 채우므로 그대로 저장하면
        // 이관해 둔 이메일이 본노드로 되돌아온다 — 회원 한 명 고칠 때마다 조용히 다시 새는 셈이다.
        const uid = String(form.uid || form._key || '').trim();
        const movedEmail = await writeUserPrivate(uid, { email: (mainForm as EntityRecord).email });
        // 실패(규칙 미게시·no-db)면 본노드에 그대로 둔다 — 폴백 계약(유실 방지)이 먼저다.
        if (movedEmail) mainForm = { ...mainForm, email: null };
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
          name: form.name != null ? String(form.name) : undefined,
          company_name: form.company_name != null ? String(form.company_name) : undefined,
          user_code: form.user_code != null ? String(form.user_code) : undefined,
          agent_payout_rate: form.agent_payout_rate != null ? String(form.agent_payout_rate) : undefined,
          is_team_manager: form.is_team_manager != null ? String(form.is_team_manager) : undefined,
          is_active: form.is_active != null ? String(form.is_active) : undefined,
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
    ? [...MEM_ACTIVE, { key: 'pending', label: pendingCount ? `승인대기 ${pendingCount}` : '승인대기' }]
    : MEM_ACTIVE;

  const byKey = Object.fromEntries(ENTITIES[tab].fields.map((f) => [f.key, f]));
  // 관리자 신규 등록은 이미 생성된 Firebase Auth 계정과 정확히 연결할 수 있어야 한다.
  // UID는 관계·권한의 루트 키이므로 생성 중에만 입력을 허용하고 기존 레코드 편집에서는 계속 숨긴다.
  const fieldsIn = (keys: string[]) => keys.map((k) => byKey[k]).filter(Boolean) as Field[];
  const basicFields = fieldsIn(creating
    ? ['uid', 'name', 'user_code', 'company_code', 'company_name']
    : ['name', 'user_code', 'company_code', 'company_name']);
  const accessFields = fieldsIn(['role', 'is_active']);
  const operationFields = fieldsIn(['agent_channel_code', 'agent_payout_rate', 'is_team_manager']);
  const canEdit = creating || editing;
  const modeBanner = creating ? (
    <Message variant="info">신규 {tab === 'user' ? '계정' : '회사'} — 필수 항목을 입력한 뒤 저장하세요.</Message>
  ) : editing ? (
    <Message variant="warning">수정 중 · 저장해야 반영됩니다</Message>
  ) : null;
  // 하단바 = 편집 컨텍스트만(수정·삭제 / 취소·저장). 계정·회사는 필터「목록」(역할과 다른 축).
  const editActions = creating || editing ? (
    <PageActions cancel={{ onClick: cancelEdit, disabled: saving }} save={{ onClick: save, disabled: !dirty || saving, label: saving ? '저장 중…' : undefined }} />
  ) : sel ? (
    <PageActions edit={{ onClick: startEdit }} remove={{ onClick: removeRec }} />
  ) : null;

  const roleKey = strOf(form.role);
  const accountState = memberAccountState(form);
  const inactive = accountState === 'inactive';
  const pending = accountState === 'pending';
  const autoplusForm = tab === 'partner' && isAutoplusPartner(form);
  const userBasicHint = '계정 식별정보와 소속 회사를 관리합니다.';
  const userAccessHint = '역할과 활성 상태는 메뉴 접근 및 데이터 범위의 기준입니다.';
  const userOperationHint = '영업지급율(0~1)은 월대여료 대비 영업자 지급 비율이며 정산 R2 기준입니다.';
  const feeHint = '공급사 수수료율(0~1)은 정산 R1 계산 기준입니다. 계좌는 전자계약 대여료 입금용입니다.';
  const partnerOpHint = autoplusForm
    ? '오토플러스 시트는 보증금 열이 없으므로 「국산 2개월치 · 수입 3개월치」 규칙이 필수입니다. 미설정하면 가격없음으로 동기화가 차단됩니다.'
    : '상품시트 주소와 gid·헤더·어댑터·보증금 규칙은 재고 가져오기 때 적용됩니다.';
  const partnerDepositSelect = {
    deposit_rule: [
      { value: '', label: '미설정 · 시트 보증금만 사용' },
      { value: 'months_per_year', label: '기간 1년당 월대여료 1개월치' },
      { value: 'rent_multiple', label: autoplusForm
        ? '국산 2개월치 · 수입 3개월치 · 오토플러스'
        : '국산 2개월치 · 수입 3개월치' },
    ],
  };
  const grid = (keys: string[], cols: number, extra?: { showNotes?: boolean; selectOptions?: Record<string, { value: string; label: string }[]> }) => (
    <FormGrid
      fields={fieldsIn(keys)}
      form={form}
      onChange={onChange}
      cols={cols}
      showNotes={extra?.showNotes}
      selectOptions={extra?.selectOptions}
    />
  );

  const approveBar = tab === 'user' && pending ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: C.selected, borderRadius: R, marginBottom: 8 }}>
      <Badge tone="amber" variant="solid">승인대기</Badge>
      <span style={{ fontSize: FS.sub, color: C.mute, flex: 1, minWidth: 0 }}>승인하면 이 계정이 앱을 사용할 수 있습니다.</span>
      <Btn title={approveBusy ? '가입 승인 처리 중' : '가입 승인'} size="sm" onClick={() => doApprove(true)} disabled={approveBusy}>
        <ButtonLabel icon={<UserCheck size={ICON.md} aria-hidden />}>{approveBusy ? '처리 중…' : '가입 승인'}</ButtonLabel>
      </Btn>
    </div>
  ) : tab === 'user' && strOf(form.status) === 'active' ? (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
      <Btn title={approveBusy ? '승인 취소 처리 중' : '승인 취소 후 대기로 변경'} size="sm" variant="ghost" onClick={() => doApprove(false)} disabled={approveBusy}>
        <ButtonLabel icon={<UserRoundX size={ICON.md} aria-hidden />}>{approveBusy ? '처리 중…' : '승인 취소(대기로)'}</ButtonLabel>
      </Btn>
    </div>
  ) : null;

  const roleSelectOptions = tab === 'user'
    ? {
        role: ROLES
          .filter((r) => r !== 'agent_manager' || roleKey === 'agent_manager')
          .map((r) => ({ value: r, label: ROLE_LABEL_RAW[r] })),
      }
    : undefined;

  const userBasicRead = (
    <>
      <DetailRow label="이름" value={strOf(form.name)} />
      <DetailRow label="회원번호" value={strOf(form.user_code)} />
      <DetailRow label="회사명" value={strOf(form.company_name)} />
      <DetailRow label="회사코드" value={strOf(form.company_code)} />
    </>
  );
  const userAccessRead = (
    <>
      <DetailRow
        label="역할"
        value={roleKey
          ? <Badge tone={ACTOR_TONE[roleKey] || (roleKey.startsWith('agent') ? 'blue' : 'gray')}>{ROLE_LABEL_RAW[roleKey as keyof typeof ROLE_LABEL_RAW] || roleKey}</Badge>
          : ''}
      />
      <DetailRow
        label="상태"
        value={pending
          ? <Badge tone="amber" variant="solid">승인대기</Badge>
          : <Badge tone={inactive ? 'gray' : 'green'} variant="quiet">{inactive ? '비활성' : '활성'}</Badge>}
      />
    </>
  );
  const userOperationRead = (
    <>
      <DetailRow label="영업채널" value={strOf(form.agent_channel_code)} />
      <DetailRow label="영업지급율" value={ratePct(form.agent_payout_rate)} />
      <DetailRow label="팀매니저" value={strOf(form.is_team_manager)} />
    </>
  );
  const partnerTypeTone = (() => {
    const type = partnerTypeLabel(form.partner_type, form.partner_code || form._key);
    return <Badge tone={type === '공급사' ? 'blue' : type === '분류 필요' ? 'red' : 'gray'}>{type}</Badge>;
  })();
  const partnerCompanyRead = (
    <ListGroup footer="전자계약 임대인 표시 · 가입 시 소속 매칭">
      <DetailRow label="상호/이름" value={strOf(form.name)} />
      <DetailRow label="별칭" value={strOf(form.alias)} />
      <DetailRow label="유형" value={partnerTypeTone} />
      <DetailRow label="사업자번호" value={businessRegistrationNumberOf(form, 'partner')} />
      <DetailRow label="자동차대여사업 등록번호" value={strOf(form.rental_business_no)} />
      <DetailRow label="대표번호" value={strOf(form.phone)} />
      <DetailRow label="사업장 주소" value={strOf(form.address)} stacked={!!strOf(form.address)} />
      <DetailRow label="대표자" value={strOf(form.ceo)} />
      <DetailRow label="실무자" value={strOf(form.contact)} />
    </ListGroup>
  );
  const partnerOpRead = (
    <>
      <DetailRow label="구글시트 URL" value={strOf(form.sheet_url)} stacked={!!strOf(form.sheet_url)} />
      <DetailRow label="시트 gid" value={strOf(form.sheet_tab)} />
      <DetailRow label="헤더 행" value={strOf(form.header_row)} />
      <DetailRow label="시트 어댑터" value={strOf(form.adapter_id) || (autoplusForm ? '오토플러스식 · 자동' : '일반 · 기본')} />
      <DetailRow label="보증금 계산규칙" value={depositRuleLabel(form.deposit_rule)} />
    </>
  );
  const partnerFeeRead = (
    <>
      <DetailRow label="공급사 수수료율" value={ratePct(form.fee_rate)} />
      <DetailRow label="입금은행" value={strOf(form.bank_name)} />
      <DetailRow label="예금주" value={strOf(form.bank_holder)} />
      <DetailRow label="입금계좌번호" value={strOf(form.bank_account)} stacked={!!strOf(form.bank_account)} />
    </>
  );

  const paneHint = (text: string) => (
    <div style={{ fontSize: FS.micro, color: C.faint, marginTop: 8 }}>{text}</div>
  );

  const partnerBasicBody = canEdit ? (
    <FormCard hint="전자계약 임대인 표시 · 가입 시 소속 매칭">
      {grid(['name', 'alias'], 2)}
      <div style={{ marginTop: 10 }}>{grid(['partner_type', 'business_number', 'rental_business_no', 'phone'], 2)}</div>
      <div style={{ marginTop: 10 }}>{grid(['address'], 1)}</div>
      <div style={{ marginTop: 10 }}>{grid(['ceo', 'contact'], 2)}</div>
    </FormCard>
  ) : partnerCompanyRead;

  // 4프레임 = 목록 1 + 업무 패널 3. 파트너 = 기본정보 · 운영정책 · 수수료정책.
  const basicPane = (
    <>
      <PaneHead title="기본정보" />
      <PaneBody pad>
        {sel ? (
          <>
            {modeBanner}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: FS.cap, color: C.faint }}>
              <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.strong, color: C.mute }}>{strOf(form[idFieldOf(tab)])}</span>
            </div>
            {tab === 'partner' ? partnerBasicBody : (
              canEdit ? (
                <FormCard hint={userBasicHint}>
                  <FormGrid fields={basicFields} form={form} onChange={onChange} cols={2} />
                </FormCard>
              ) : (
                <>{userBasicRead}{paneHint(userBasicHint)}</>
              )
            )}
          </>
        ) : (
          <CenterNote>{tab === 'user' ? '계정을' : '회사를'} 선택하거나 신규로 추가하세요.</CenterNote>
        )}
      </PaneBody>
    </>
  );

  const accessPane = (
    <>
      <PaneHead title="소속·권한" />
      <PaneBody pad>
        {sel ? (
          <>
            {approveBar}
            {canEdit ? (
              <FormCard hint={userAccessHint}>
                <FormGrid fields={accessFields} form={form} onChange={onChange} cols={2} selectOptions={roleSelectOptions} />
              </FormCard>
            ) : (
              <>{userAccessRead}{paneHint(userAccessHint)}</>
            )}
          </>
        ) : (
          <CenterNote>목록에서 대상을 선택하면 권한을 확인할 수 있습니다.</CenterNote>
        )}
      </PaneBody>
    </>
  );

  const adminTools = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      {tab === 'user' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          <Btn title="개인채널 백필 미리보기" size="sm" variant="ghost" onClick={() => doBackfillChannels(true)}>
            <ButtonLabel icon={<Eye size={ICON.md} aria-hidden />}>개인채널 백필 미리보기</ButtonLabel>
          </Btn>
          <Btn title="개인채널 백필 실행" size="sm" variant="ghost" onClick={() => doBackfillChannels(false)}>
            <ButtonLabel icon={<Play size={ICON.md} aria-hidden />}>개인채널 백필 실행</ButtonLabel>
          </Btn>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        <Btn title="민감정보 분리 미리보기" size="sm" variant="ghost" onClick={() => doMigratePrivate(true)}>
          <ButtonLabel icon={<Eye size={ICON.md} aria-hidden />}>민감정보 분리 미리보기</ButtonLabel>
        </Btn>
        <Btn title="민감정보 분리 실행" size="sm" variant="ghost" onClick={() => doMigratePrivate(false)}>
          <ButtonLabel icon={<ShieldCheck size={ICON.md} aria-hidden />}>민감정보 분리 실행</ButtonLabel>
        </Btn>
      </div>
    </div>
  );

  const userOperationPane = (
    <>
      <PaneHead title="영업설정" />
      <PaneBody pad>
        {sel ? (
          canEdit ? (
            <FormCard hint={userOperationHint}>
              <FormGrid fields={operationFields} form={form} onChange={onChange} cols={2} />
            </FormCard>
          ) : (
            <>{userOperationRead}{paneHint(userOperationHint)}</>
          )
        ) : (
          <>
            <CenterNote>목록에서 대상을 선택하면 업무 연동 설정을 확인할 수 있습니다.</CenterNote>
            {adminTools}
          </>
        )}
      </PaneBody>
    </>
  );

  const partnerOperationPane = (
    <>
      <PaneHead title="운영정책" />
      <PaneBody pad>
        {sel ? (
          <>
            {canEdit ? (
              <FormCard hint={partnerOpHint}>
                {grid(['sheet_url'], 1, { showNotes: true })}
                <div style={{ marginTop: 10 }}>
                  {grid(['deposit_rule', 'adapter_id', 'sheet_tab', 'header_row'], 2, { showNotes: true, selectOptions: partnerDepositSelect })}
                </div>
              </FormCard>
            ) : (
              <>{partnerOpRead}{paneHint(partnerOpHint)}</>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn title="깨진 컬럼 매핑과 헤더 서명만 초기화" size="sm" variant="ghost" onClick={resetSheetMapping} disabled={saving}>
                <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>시트 매핑 초기화</ButtonLabel>
              </Btn>
            </div>
          </>
        ) : (
          <CenterNote>목록에서 회사를 선택하면 운영정책을 확인할 수 있습니다.</CenterNote>
        )}
      </PaneBody>
    </>
  );

  const partnerFeePane = (
    <>
      <PaneHead title="수수료정책" />
      <PaneBody pad>
        {sel ? (
          canEdit ? (
            <FormCard hint={feeHint}>
              {grid(['fee_rate'], 1, { showNotes: true })}
              <div style={{ marginTop: 10 }}>{grid(['bank_name', 'bank_holder'], 2)}</div>
              <div style={{ marginTop: 10 }}>{grid(['bank_account'], 1)}</div>
            </FormCard>
          ) : (
            <>
              {partnerFeeRead}
              {paneHint(feeHint)}
            </>
          )
        ) : (
          <>
            <CenterNote>목록에서 회사를 선택하면 수수료정책을 확인할 수 있습니다.</CenterNote>
            {adminTools}
          </>
        )}
      </PaneBody>
    </>
  );

  const panes: WorkPane[] = tab === 'user'
    ? [
      { key: 'basic', title: '기본', node: basicPane },
      { key: 'access', title: '권한', node: accessPane },
      { key: 'operation', title: '영업', node: userOperationPane },
    ]
    : [
      { key: 'basic', title: '기본', node: basicPane },
      { key: 'operation', title: '운영', node: partnerOperationPane },
      { key: 'fee', title: '수수료', node: partnerFeePane },
    ];

  const fltCount = tab === 'user'
    ? (roleFlt !== 'all' ? 1 : 0) + (activeFlt !== 'all' ? 1 : 0)
    : (ptypeFlt !== 'all' ? 1 : 0);

  return (
    <>
      <WorkPage title={NAV_LABEL.members}
        statusCount={rows.length}
        listCount={shown.length} list={listEl} panes={panes} selected={!!sel} onBack={clearSel}
        contextTitle={sel ? (creating ? '신규' : String(form.name || form.partner_code || form.user_code || '')) : undefined}
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
                      <FilterChips value={roleFlt} onChange={setRoleFlt} options={MEM_ROLES} />
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
            tab === 'user' ? '계정' : '회사',
            ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
            ...(sort && sort !== 'name' ? [MEM_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...(roleFlt !== 'all' ? [ROLE_LABEL_RAW[roleFlt as keyof typeof ROLE_LABEL_RAW] || roleFlt] : []),
            ...(activeFlt !== 'all' ? [activeFlt] : []),
            ...(ptypeFlt !== 'all' ? [ptypeFlt] : []),
          ],
          onClearHints: () => { setQ(''); setSort('name'); setRoleFlt('all'); setActiveFlt('all'); setPtypeFlt('all'); },
        }}
      />
    </>
  );
}
