'use client';
import { useEffect, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { getProgress, CONTRACT_STATES, isContractInProgress } from '@/lib/domain/contract';
import { createSettlement } from '@/lib/domain/settlement-engine';
import { downloadSettlementsExcel } from '@/lib/excel-export';
import { getRole, actor, ensureRoomForContract, type Role } from '@/lib/domain/deal';
import { man } from '@/lib/format';
import { PaneHead, PaneBody, Badge, Btn, Input, won, C, R, NUM, Loading, CenterNote, SETTLEMENT_STATUS_TONE, FilterChips, SectionLabel, PageActions } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { ContractPanel } from '@/components/ContractPanel';
import { ContractDocs } from '@/components/ContractDocs';
import { matchContractQuery } from '@/lib/domain/search';
import { haptic } from '@/lib/haptics';
import { ContractListRow } from '@/components/list-rows';
import { NAV_LABEL } from '@/lib/tabbar';

type ContSort = 'date' | 'status' | 'progress' | 'name';
type ContFilter = '진행' | 'all' | (typeof CONTRACT_STATES)[number];
const CONT_SORTS: { value: ContSort; label: string }[] = [
  { value: 'status', label: '상태순' },
  { value: 'progress', label: '진행순' },
  { value: 'name', label: '계약자순' },
  { value: 'date', label: '최근순' },
];
const CONT_FILTERS: { key: ContFilter; label: string }[] = [
  { key: '진행', label: '진행' },
  { key: 'all', label: '전체' },
  ...CONTRACT_STATES.map((s) => ({ key: s, label: s })),
];

// 계약 = [목록 | 계약진행상황 | 첨부서류 | 정산상태] 4프레임.
// 진행상황은 문의(/chat) ContractPanel과 동일 SSOT. 발송·단계는 패널 안.

// R1/R2 금액 편집 원자 — 편한 입력(타이핑 중 저장 안 함)·blur 시 커밋. 부모가 key로 정산 전환 시 재초기화.
function AmtInput({ val, onCommit }: { val: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(val ? val.toLocaleString() : '');
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex' }}
      onBlur={() => { const n = Number(draft.replace(/[^\d]/g, '')) || 0; if (n !== val) onCommit(n); }}>
      <Input value={draft} onChange={setDraft} placeholder="0" inputMode="numeric" size="sm" full
        style={{ fontFamily: NUM, textAlign: 'right', background: C.warnBg }} />
    </div>
  );
}

export default function ContractsSettlement() {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [selC, setSelC] = useState<EntityRecord | null>(null);
  const [selS, setSelS] = useState<EntityRecord | null>(null);
  const [selProduct, setSelProduct] = useState<EntityRecord | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [setts, setSetts] = useState<EntityRecord[]>([]);
  const [role, setRoleS] = useState<Role>('agent');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<ContSort | ''>('');
  const [flt, setFlt] = useState<ContFilter>('진행');

  const load = async (r: Role): Promise<EntityRecord[]> => {
    setRoleS(r);
    const [all, allS] = await Promise.all([getStore().list('contract', co), getStore().list('settlement', co)]);
    const me = actor(r);
    const mine = r === 'admin' ? [...all] : r === 'provider' ? all.filter((c) => String(c.provider_company_code) === me.code) : all.filter((c) => String(c.agent_code) === me.code);
    mine.sort((a, b) => String(b.contract_date || '').localeCompare(String(a.contract_date || '')));
    const mineS = r === 'admin' ? allS : r === 'provider' ? allS.filter((s) => String(s.provider_company_code) === me.code) : allS.filter((s) => String(s.agent_code) === me.code);
    setRows(mine); setSetts(mineS); return mine;
  };
  const selectContract = async (c: EntityRecord) => {
    setSel(String(c.contract_code)); setSelC(c);
    const [settsList, prod, room] = await Promise.all([
      getStore().list('settlement', co),
      getStore().get('product', co, String(c.product_code)),
      ensureRoomForContract(c),
    ]);
    let s = settsList.find((x) => String(x.contract_code) === String(c.contract_code));
    if (!s && c.contract_status === '계약완료') {
      await createSettlement(c);
      const again = await getStore().list('settlement', co);
      s = again.find((x) => String(x.contract_code) === String(c.contract_code));
    }
    setSelS(s || null);
    setSelProduct(prod || null);
    setRoomId(room);
  };
  const clearSel = () => { setSel(null); setSelC(null); setSelS(null); setSelProduct(null); setRoomId(null); };
  const reloadSel = async () => {
    if (!sel) return;
    const all = await load(getRole());
    const c = all.find((x) => String(x.contract_code) === sel);
    if (c) {
      setSelC(c);
      const settsList = await getStore().list('settlement', co);
      let s = settsList.find((x) => String(x.contract_code) === sel);
      if (!s && c.contract_status === '계약완료') {
        await createSettlement(c);
        const again = await getStore().list('settlement', co);
        s = again.find((x) => String(x.contract_code) === sel);
      }
      setSelS(s || null);
    }
  };

  useEffect(() => { (async () => {
    await seedIfEmpty(co); const all = await load(getRole());
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('c') : null;
    const first = all.find((c) => isContractInProgress(c)) || all[0];
    const target = wanted ? all.find((x) => String(x.contract_code) === wanted) : (!mobile ? first : undefined);
    if (target) selectContract(target);
  })(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const on = (e: Event) => { const r = (e as CustomEvent).detail as Role; (async () => { const all = await load(r); clearSel(); if (!mobile && all.length) selectContract(all.find((c) => isContractInProgress(c)) || all[0]); })(); }; window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); /* eslint-disable-next-line */ }, [mobile]);

  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === '/contract') clearSel();
    };
    window.addEventListener('fp:work-list', on);
    return () => window.removeEventListener('fp:work-list', on);
  }, []);

  const shown = (rows || [])
    .filter((c) => matchContractQuery(c, q))
    .filter((c) => {
      if (flt === '진행') return isContractInProgress(c);
      if (flt === 'all') return true;
      return String(c.contract_status || '') === flt;
    })
    .slice()
    .sort((a, b) => {
      if (!sort) return 0;
      if (sort === 'name') return String(a.customer_name || '').localeCompare(String(b.customer_name || ''), 'ko');
      if (sort === 'progress') return getProgress(b).done - getProgress(a).done || String(b.contract_date || '').localeCompare(String(a.contract_date || ''));
      if (sort === 'status') {
        const ai = CONTRACT_STATES.indexOf(String(a.contract_status || '') as typeof CONTRACT_STATES[number]);
        const bi = CONTRACT_STATES.indexOf(String(b.contract_status || '') as typeof CONTRACT_STATES[number]);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      }
      return String(b.contract_date || '').localeCompare(String(a.contract_date || ''));
    });
  const listEl = shown.length === 0
    ? <CenterNote>{q || flt !== '진행' ? '검색 결과 없음' : '진행 중인 계약이 없습니다.'}</CenterNote>
    : <div>{shown.map((c) => (
      <ContractListRow
        key={String(c.contract_code)}
        c={c}
        selected={String(c.contract_code) === sel}
        onClick={() => { haptic.tap(); selectContract(c); }}
      />
    ))}</div>;

  const kv = (k: string, v: React.ReactNode, strong?: boolean) => (
    <div style={{ display: 'flex', padding: '8px 14px', borderTop: `1px solid ${C.line2}`, fontSize: 12.5 }}>
      <span style={{ width: 110, flex: '0 0 110px', color: C.mute }}>{k}</span>
      <span style={{ fontWeight: strong ? 800 : 600, color: strong ? C.brand : C.ink, fontFamily: NUM }}>{v}</span>
    </div>
  );

  const setStatus = async (to: string) => {
    if (!selS || role !== 'admin') return;
    await getStore().update('settlement', co, String(selS.settlement_code), { settlement_status: to });
    const allS = await getStore().list('settlement', co); const me = actor(role);
    setSetts(role === 'admin' ? allS : role === 'provider' ? allS.filter((s) => String(s.provider_company_code) === me.code) : allS.filter((s) => String(s.agent_code) === me.code));
    setSelS(allS.find((x) => String(x.settlement_code) === String(selS.settlement_code)) || null);
  };
  const setAmount = async (field: 'fee_amount' | 'agent_payout', value: number) => {
    if (!selS) return;
    const fee = field === 'fee_amount' ? value : Number(selS.fee_amount) || 0;
    const payout = field === 'agent_payout' ? value : Number(selS.agent_payout) || 0;
    await getStore().update('settlement', co, String(selS.settlement_code), { [field]: value, net_amount: fee - payout });
    const allS = await getStore().list('settlement', co); const me = actor(role);
    setSetts(role === 'admin' ? allS : role === 'provider' ? allS.filter((s) => String(s.provider_company_code) === me.code) : allS.filter((s) => String(s.agent_code) === me.code));
    setSelS(allS.find((x) => String(x.settlement_code) === String(selS.settlement_code)) || null);
  };
  const amtRow = (label: string, field: 'fee_amount' | 'agent_payout', val: number, code: string) => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '7px 14px', borderTop: `1px solid ${C.line2}`, fontSize: 12.5 }}>
      <span style={{ width: 120, flex: '0 0 120px', color: C.mute }}>{label}</span>
      {role === 'admin'
        ? <AmtInput key={`${code}-${field}`} val={val} onCommit={(n) => setAmount(field, n)} />
        : <span style={{ fontWeight: 800, color: C.brand, fontFamily: NUM }}>{won(val)}원</span>}
    </div>
  );
  const detailSettle = () => {
    if (!selS) return <CenterNote>{selC?.contract_status === '계약완료' ? '정산 생성 중…' : '계약 완료 시 정산이 자동 생성됩니다.'}</CenterNote>;
    const s = selS; const st = String(s.settlement_status); const cb = Number(s.clawback_amount) || 0;
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px' }}>
          <span style={{ fontSize: 13, fontWeight: 800, fontFamily: NUM }}>{String(s.settlement_code)}</span>
          <Badge tone={SETTLEMENT_STATUS_TONE[st] || 'gray'}>{st}</Badge>
          <span style={{ flex: 1 }} />
          {role === 'admin' && st === '정산대기' && <Btn variant="ghost" size="sm" onClick={() => setStatus('정산보류')}>보류</Btn>}
          {role === 'admin' && st === '정산대기' && <Btn size="sm" onClick={() => setStatus('정산완료')}>정산 확정</Btn>}
          {role === 'admin' && st === '정산보류' && <Btn size="sm" onClick={() => setStatus('정산대기')}>대기로</Btn>}
          {role === 'admin' && st === '환수대기' && <Btn size="sm" onClick={() => setStatus('환수결정')}>환수 확정</Btn>}
        </div>
        <div style={{ margin: '0 14px', border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden' }}>
          {amtRow('공급사 청구 (R1)', 'fee_amount', Number(s.fee_amount) || 0, String(s.settlement_code))}
          {amtRow('영업자 지급 (R2)', 'agent_payout', Number(s.agent_payout) || 0, String(s.settlement_code))}
          {role === 'admin' && kv('순수익 (R1−R2)', `${won((Number(s.fee_amount) || 0) - (Number(s.agent_payout) || 0))}원`, true)}
          {cb > 0 ? kv('환수액', `${won(cb)}원`) : null}
        </div>
        <div style={{ padding: '10px 14px', fontSize: 11.5, color: C.faint, lineHeight: 1.6 }}>공급사에서 <b>받은 금액(R1)</b>·영업자에 <b>준 금액(R2)</b>을 실측 기록(관리자 편집, 율=기본값). 순수익=R1−R2. 중도취소 시 환수(경과비례).</div>
      </div>
    );
  };

  const progressBody = sel && roomId
    ? <ContractPanel
        product={selProduct}
        roomId={roomId}
        linkedCode={sel}
        agentCode={selC ? String(selC.agent_code || '') : undefined}
        onChange={reloadSel}
      />
    : <CenterNote>계약을 선택하세요.</CenterNote>;

  const docsBody = sel
    ? <ContractDocs contractCode={sel} roomId={roomId || undefined} />
    : <CenterNote>계약을 선택하세요.</CenterNote>;

  // 웹·모바일 공통 3패널(+목록 = 4프레임).
  const panes: WorkPane[] = [
    { key: 'progress', title: '진행', node: <><PaneHead title="계약 진행상황" /><PaneBody>{progressBody}</PaneBody></> },
    { key: 'docs', title: '서류', node: <><PaneHead title="첨부 서류" /><PaneBody>{docsBody}</PaneBody></> },
    { key: 'settle', title: '정산', node: <><PaneHead title="정산상태" /><PaneBody>{detailSettle()}</PaneBody></> },
  ];

  const agg = (pred: (s: EntityRecord) => boolean, f: (s: EntityRecord) => unknown) => setts.filter(pred).reduce((n, s) => n + (Number(f(s)) || 0), 0);
  const cells: [string, number, string][] = [
    ['대기', agg((s) => String(s.settlement_status) === '정산대기', (s) => s.fee_amount), C.warn],
    ['완료', agg((s) => String(s.settlement_status) === '정산완료', (s) => s.fee_amount), C.ok],
    ['환수', agg((s) => String(s.settlement_status).includes('환수'), (s) => s.clawback_amount), C.danger],
    ...(role === 'admin' ? [['순수익', agg((s) => String(s.settlement_status) === '정산완료', (s) => s.net_amount), C.brand] as [string, number, string]] : []),
  ];
  const summaryBar = setts.length ? (
    <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`, background: C.head, position: 'sticky', top: 0, zIndex: 2 }}>
      {cells.map(([label, val, color], i) => (
        <div key={label} style={{ flex: 1, padding: '7px 8px', borderLeft: i ? `1px solid ${C.line2}` : 'none', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: C.mute, fontWeight: 700 }}>{label}</div>
          <div style={{ fontSize: 13, fontWeight: 800, color, fontFamily: NUM }}>{man(val)}</div>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <>
      <WorkPage title={NAV_LABEL.contract || '계약'} statusLabel="계약진행중"
        statusCount={rows?.filter((c) => isContractInProgress(c)).length ?? 0}
        listCount={shown.length}
        list={rows === null ? <Loading /> : <>{summaryBar}{listEl}</>} panes={panes} selected={!!sel} onBack={clearSel}
        contextTitle={selC ? String(selC.customer_name || selC.vehicle_name || selC.car_number || selC.contract_code || '') : undefined}
        actions={setts.length ? <PageActions extra={<Btn variant="ghost" size="sm" onClick={() => downloadSettlementsExcel(setts, new Date().toISOString().slice(0, 10), role === 'admin')}>정산 엑셀</Btn>} /> : undefined}
        search={{ value: q, onChange: setQ, placeholder: '계약·차번·계약자·전화·영업·공급…' }}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '계약·차번·계약자·전화·영업…' },
          sort: { value: sort, onChange: (v) => setSort(v as ContSort | ''), options: CONT_SORTS },
          filter: {
            count: flt === '진행' ? 0 : 1,
            title: '계약 필터',
            onClear: () => setFlt('진행'),
            body: (
              <>
                <SectionLabel mt={0}>계약상태</SectionLabel>
                <FilterChips value={flt} onChange={setFlt} options={CONT_FILTERS} />
              </>
            ),
          },
          hints: [
            ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
            ...(sort ? [CONT_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...(flt !== '진행' ? [flt === 'all' ? '전체' : flt] : []),
          ],
          onClearHints: () => { setQ(''); setSort(''); setFlt('진행'); },
        }}
      />
    </>
  );
}
